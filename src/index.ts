import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import chokidar, { type FSWatcher } from 'chokidar';
import picomatch from 'picomatch';
import type { Config as SVGOConfig } from 'svgo';

import { getSpriteContent, type Sprite } from './getSpriteContent';
import { createHmrClient, HMR_EVENT } from './hmrClient';
import { writeTypes } from './writeTypes';

export interface SvgSpritemapOptions {
  pattern: string;
  filename?: string;
  svgo?: SVGOConfig | boolean;
  currentColor?: boolean;
  hmr?: boolean;
  types?: boolean | string;
  symbolId?: string | ((file: string, name: string) => string);
  view?: boolean;
}

const PLUGIN_NAME = 'vite-plugin-svg-spritemap';
const CLIENT_MODULE_ID = `virtual:${PLUGIN_NAME}/client`;
const DEFAULT_TYPES_PATH = 'src/spritemap-icons.ts';

function svgSpritemap({
  pattern,
  filename = 'spritemap.svg',
  svgo = true,
  currentColor = false,
  hmr = true,
  types = false,
  symbolId,
  view = false,
}: SvgSpritemapOptions): Plugin[] {
  let config: ResolvedConfig;
  let watcher: FSWatcher | undefined;
  let typesPath: string | undefined;

  const spriteOptions = { pattern, svgo, currentColor, symbolId, view };

  function resolveConfig(resolved: ResolvedConfig) {
    config = resolved;
    typesPath = types
      ? path.resolve(config.root, types === true ? DEFAULT_TYPES_PATH : types)
      : undefined;
  }

  function generate(): Sprite {
    return getSpriteContent({ ...spriteOptions, root: config.root });
  }

  /**
   * `[hash]` is resolved from the sprite contents on build. The dev server keeps
   * a stable name instead, so that references in source do not go stale on edit.
   */
  function resolveFilename(content?: string): string {
    if (!filename.includes('[hash]')) {
      return filename;
    }

    const hash =
      content === undefined
        ? 'dev'
        : createHash('sha256').update(content).digest('hex').slice(0, 8);

    return filename.replaceAll('[hash]', hash);
  }

  function build(hashed: boolean): Sprite & { fileName: string } {
    const sprite = generate();
    const fileName = resolveFilename(hashed ? sprite.content : undefined);

    if (typesPath) {
      writeTypes(typesPath, sprite.symbolIds, config.base + fileName);
    }

    return { ...sprite, fileName };
  }

  let bundled: (Sprite & { fileName: string }) | undefined;

  return [
    {
      name: `${PLUGIN_NAME}:build`,
      apply: 'build',
      async configResolved(_config) {
        resolveConfig(_config);
      },
      // The generated module is imported by application code, so it has to
      // exist before the bundler starts resolving imports.
      buildStart() {
        // An SSR pass runs over the same sources; the client build already
        // produced the sprite and the generated module.
        if (config.build.ssr) {
          return;
        }

        bundled = build(true);
      },
      generateBundle() {
        if (config.build.ssr) {
          return;
        }

        const sprite = bundled ?? build(true);

        this.emitFile({
          type: 'asset',
          fileName: sprite.fileName,
          source: sprite.content,
        });
      },
    },
    {
      name: `${PLUGIN_NAME}:serve`,
      apply: 'serve',
      async configResolved(_config) {
        resolveConfig(_config);
      },
      resolveId(id) {
        return id === CLIENT_MODULE_ID ? CLIENT_MODULE_ID : undefined;
      },
      load(id) {
        return id === CLIENT_MODULE_ID ? createHmrClient('/' + resolveFilename()) : undefined;
      },
      transformIndexHtml() {
        if (!hmr) {
          return [];
        }
        return [
          {
            tag: 'script',
            attrs: { type: 'module', src: `/@id/${CLIENT_MODULE_ID}` },
            injectTo: 'head-prepend',
          },
        ];
      },
      configureServer(server) {
        // `server.hot` replaced `server.ws` in Vite 5.1, but the plugin still
        // supports Vite 5.0.
        const hot = server.hot ?? server.ws;
        const devFileName = resolveFilename();

        // Rebuilding on every request would re-read and re-optimize every icon.
        let cached: Sprite | undefined;

        function getSprite(): Sprite {
          cached ??= build(false);
          return cached;
        }

        function notifyClients() {
          if (hmr) {
            hot.send({ type: 'custom', event: HMR_EVENT, data: { timestamp: Date.now() } });
          } else {
            hot.send({ type: 'full-reload', path: '*' });
          }
        }

        // chokidar dropped glob support in v4, so watch the static base
        // directory of the pattern and match the events ourselves.
        const baseDir = picomatch.scan(pattern).base || '.';
        const isMatch = picomatch(pattern);

        function onWatchEvent(file: string) {
          if (!isMatch(file.split(path.sep).join('/'))) {
            return;
          }

          cached = undefined;

          if (typesPath) {
            getSprite();
          }

          notifyClients();
        }

        if (typesPath) {
          getSprite();
        }

        watcher = chokidar
          .watch(baseDir, {
            cwd: config.root,
            ignoreInitial: true,
            ignored: file => file.includes('node_modules') || file.includes('.git'),
          })
          .on('add', onWatchEvent)
          .on('change', onWatchEvent)
          .on('unlink', onWatchEvent);

        return () => {
          server.middlewares.use(async (req, res, next) => {
            // The HMR client appends a cache-busting query, so match on the path only.
            const requestPath = req.originalUrl?.split('?')[0];

            if (!requestPath?.endsWith('/' + devFileName)) {
              return next();
            }

            res.writeHead(200, {
              'Content-Type': 'image/svg+xml, charset=utf-8',
              'Cache-Control': 'no-cache',
            });
            res.end(getSprite().content);
          });
        };
      },
      async closeBundle() {
        await watcher?.close();
      },
    },
  ];
}

export { svgSpritemap, svgSpritemap as default };
