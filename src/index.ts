import path from 'path';
import { Plugin, ResolvedConfig } from 'vite';
import chokidar from 'chokidar';
import fs from 'fs-extra';
import { getSpriteContent } from './utils';

interface SvgSpritemapOptions {
  pattern: string;
  prefix?: string;
  filename?: string;
}

const PLUGIN_NAME = 'vite-plugin-svg-spritemap';

export function svgSpritemap({
  pattern,
  prefix = 'sprite',
  filename = 'spritemap.svg',
}: SvgSpritemapOptions): Plugin[] {
  let config: ResolvedConfig;
  let watcher: chokidar.FSWatcher;

  return [
    {
      name: `${PLUGIN_NAME}:build`,
      apply: 'build',
      configResolved(_config) {
        config = _config;
      },
      writeBundle() {
        const sprite = getSpriteContent(pattern, prefix);
        const filePath = path.resolve(config.root, config.build.outDir, filename);
        fs.ensureFileSync(filePath);
        fs.writeFileSync(filePath, sprite);
      },
    },
    {
      name: `${PLUGIN_NAME}:serve`,
      apply: 'serve',
      configResolved(_config) {
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
            if (req.url !== `/${filename}`) {
              return next();
            }
            const sprite = getSpriteContent(pattern, prefix);
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
