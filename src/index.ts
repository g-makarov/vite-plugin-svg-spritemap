import fs from 'fs-extra';
import path from 'path';
import type { Plugin, ResolvedConfig } from 'vite';
import chokidar, { FSWatcher } from 'chokidar';
import { getSpriteContent } from './getSpriteContent';
import type { Config as SVGOConfig } from 'svgo';

export interface SvgSpritemapOptions {
  pattern: string;
  prefix?: string;
  filename?: string;
  svgo?: SVGOConfig | boolean;
  currentColor?: boolean;
  emit?: boolean;
}

const PLUGIN_NAME = 'vite-plugin-svg-spritemap';

export function svgSpritemap({
  pattern,
  prefix,
  filename = 'spritemap.svg',
  svgo = true,
  currentColor = false,
  emit = false,
}: SvgSpritemapOptions): Plugin[] {
  let config: ResolvedConfig;
  let watcher: FSWatcher;

  return [
    {
      name: `${PLUGIN_NAME}:build`,
      apply: 'build',
      async configResolved(_config) {
        config = _config;
      },
      writeBundle() {
        const sprite = getSpriteContent({ pattern, prefix, svgo, currentColor });
        const filePath = path.resolve(config.root, config.build.outDir, filename);
        fs.ensureFileSync(filePath);
        fs.writeFileSync(filePath, sprite);

        if (emit) {
          this.emitFile({
            type: 'asset',
            fileName: filename,
            source: sprite,
          });
        }
      },
    },
    {
      name: `${PLUGIN_NAME}:serve`,
      apply: 'serve',
      async configResolved(_config) {
        config = _config;
      },
      configureServer(server) {
        function reloadPage() {
          server.ws.send({ type: 'full-reload', path: '*' });
        }

        watcher = chokidar
          .watch(pattern, {
            cwd: config.root,
            ignoreInitial: true,
          })
          .on('add', reloadPage)
          .on('change', reloadPage)
          .on('unlink', reloadPage);

        return () => {
          server.middlewares.use(async (req, res, next) => {
            if (!req.originalUrl?.endsWith('/' + filename)) {
              return next();
            }
            const sprite = getSpriteContent({ pattern, prefix, svgo, currentColor });
            res.writeHead(200, {
              'Content-Type': 'image/svg+xml, charset=utf-8',
              'Cache-Control': 'no-cache',
            });
            res.end(sprite);
          });
        };
      },
      async closeBundle() {
        await watcher.close();
      },
    },
  ];
}
