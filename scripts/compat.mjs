// Checks the built plugin against whatever Vite version is installed.
// vitest requires Vite 6+, so the `peerDependencies` range down to Vite 5 can
// only be covered from a plain script.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { build, createServer } from 'vite';
import { svgSpritemap } from '../dist/index.js';

const require = createRequire(import.meta.url);
const viteVersion = require('vite/package.json').version;

const RED =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
const BLUE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20"/></svg>';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'svg-spritemap-compat-')));

fs.mkdirSync(path.join(root, 'icons'), { recursive: true });
fs.mkdirSync(path.join(root, 'src'), { recursive: true });
fs.writeFileSync(path.join(root, 'icons', 'arrow.svg'), RED);
fs.writeFileSync(path.join(root, 'src', 'main.js'), 'console.log(1);\n');
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><html><body><script type="module" src="/src/main.js"></script></body></html>',
);

const results = [];

function check(name, ok) {
  results.push([name, Boolean(ok)]);
}

async function waitFor(check, timeout = 10000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (await check()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return false;
}

// --- build -------------------------------------------------------------------
await build({
  root,
  logLevel: 'silent',
  configFile: false,
  build: { outDir: 'dist' },
  plugins: [svgSpritemap({ pattern: 'icons/**/*.svg', types: true, view: true })],
});

const sprite = fs.readFileSync(path.join(root, 'dist', 'spritemap.svg'), 'utf-8');
const generated = fs.readFileSync(path.join(root, 'src', 'spritemap-icons.ts'), 'utf-8');

check('build writes the sprite', sprite.includes('id="arrow"'));
check('build emits views', sprite.includes('<view id="arrow-view"'));
check('build writes the generated module', generated.includes('"arrow"'));
check('generated module carries the url', generated.includes('export const spritemapUrl'));

// --- dev ---------------------------------------------------------------------
const server = await createServer({
  root,
  logLevel: 'silent',
  configFile: false,
  server: { port: 0 },
  plugins: [svgSpritemap({ pattern: 'icons/**/*.svg' })],
});

await server.listen();

const url = server.resolvedUrls.local[0].replace(/\/$/, '');
const fetchSprite = () => fetch(`${url}/spritemap.svg`).then(response => response.text());

check('dev serves the sprite', (await fetchSprite()).includes('id="arrow"'));
check(
  'dev serves the cache-busted url',
  (await fetch(`${url}/spritemap.svg?t=1`).then(response => response.text())).includes(
    'id="arrow"',
  ),
);
check(
  'dev injects the hmr client',
  (await fetch(`${url}/`).then(response => response.text())).includes(
    'virtual:vite-plugin-svg-spritemap/client',
  ),
);

const hot = server.hot ?? server.ws;
const send = hot.send.bind(hot);
let notified = false;

hot.send = (...args) => {
  const payload = args[0];
  if (payload?.type === 'custom' && payload.event === 'vite-plugin-svg-spritemap:update') {
    notified = true;
  }
  return send(...args);
};

fs.writeFileSync(path.join(root, 'icons', 'arrow.svg'), BLUE);

check(
  'dev rebuilds on change',
  await waitFor(async () => (await fetchSprite()).includes('viewBox="0 0 20 20"')),
);
check('dev sends the hmr event', await waitFor(() => notified));

await server.close();
fs.rmSync(root, { recursive: true, force: true });

// --- report ------------------------------------------------------------------
const failed = results.filter(([, ok]) => !ok);

for (const [name, ok] of results) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
}

if (failed.length > 0) {
  console.error(`\n${failed.length} check(s) failed on vite ${viteVersion}`);
  process.exit(1);
}

console.log(
  `\nall ${results.length} checks passed on vite ${viteVersion}, node ${process.version}`,
);
