import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { build, createServer, type HotPayload, type ViteDevServer } from 'vite';
import { svgSpritemap, type SvgSpritemapOptions } from './index';
import { HMR_EVENT } from './hmrClient';

const RED =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#f00"/></svg>';
const BLUE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20" fill="#00f"/></svg>';

const servers: ViteDevServer[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
  roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});

function createProject(icons: Record<string, string> = { 'arrow.svg': RED }): string {
  // Vite resolves the root to its real path; on macOS the temp dir is a symlink,
  // and the mismatch makes it emit entries with `../..` in their names.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'svg-spritemap-')));
  roots.push(root);

  fs.mkdirSync(path.join(root, 'icons'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });

  for (const [name, content] of Object.entries(icons)) {
    fs.mkdirSync(path.dirname(path.join(root, 'icons', name)), { recursive: true });
    fs.writeFileSync(path.join(root, 'icons', name), content);
  }

  fs.writeFileSync(path.join(root, 'src', 'main.js'), 'console.log(1);\n');
  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<!doctype html><html><body><script type="module" src="/src/main.js"></script></body></html>',
  );

  return root;
}

async function buildProject(root: string, options: Partial<SvgSpritemapOptions> = {}, ssr = false) {
  const result = await build({
    root,
    logLevel: 'silent',
    configFile: false,
    build: {
      write: false,
      ssr: ssr ? path.join(root, 'src', 'main.js') : undefined,
    },
    plugins: [svgSpritemap({ pattern: 'icons/**/*.svg', ...options })],
  });

  const output = Array.isArray(result) ? result[0]!.output : (result as never)['output'];

  return output as { fileName: string; type: string; source?: string }[];
}

async function startServer(root: string, options: Partial<SvgSpritemapOptions> = {}) {
  const server = await createServer({
    root,
    logLevel: 'silent',
    configFile: false,
    server: { port: 0 },
    plugins: [svgSpritemap({ pattern: 'icons/**/*.svg', ...options })],
  });

  servers.push(server);
  await server.listen();

  const url = server.resolvedUrls!.local[0]!.replace(/\/$/, '');

  return { server, url };
}

/** chokidar needs a moment to notice a change; poll instead of guessing a delay. */
async function waitFor<T>(label: string, check: () => T | Promise<T>, timeout = 5000): Promise<T> {
  const deadline = Date.now() + timeout;
  let last: unknown;

  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) {
        return result;
      }
    } catch (error) {
      last = error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  throw new Error(`timed out waiting for ${label}${last ? `: ${String(last)}` : ''}`);
}

/** Collects only the messages this plugin sends, ignoring Vite's own traffic. */
function spyOnSpriteEvents(server: ViteDevServer): string[] {
  const events: string[] = [];
  const hot = server.hot ?? server.ws;
  const original = hot.send.bind(hot) as (payload: HotPayload) => void;

  hot.send = ((payload: HotPayload) => {
    if (payload.type === 'custom' && payload.event === HMR_EVENT) {
      events.push(payload.event);
    } else if (payload.type === 'full-reload' && payload.path === '*') {
      events.push(payload.type);
    }

    original(payload);
  }) as typeof hot.send;

  return events;
}

describe('build', () => {
  test('should emit the sprite as an asset', async () => {
    const output = await buildProject(createProject());
    const sprite = output.find(file => file.fileName === 'spritemap.svg');

    expect(sprite?.type).toBe('asset');
    expect(sprite?.source).toContain('id="arrow"');
  });

  test('should resolve [hash] from the contents', async () => {
    const first = await buildProject(createProject(), { filename: 'sprite-[hash].svg' });
    const second = await buildProject(createProject({ 'arrow.svg': BLUE }), {
      filename: 'sprite-[hash].svg',
    });

    const nameOf = (output: Awaited<ReturnType<typeof buildProject>>) =>
      output.find(file => file.fileName.endsWith('.svg'))!.fileName;

    expect(nameOf(first)).toMatch(/^sprite-[0-9a-f]{8}\.svg$/);
    expect(nameOf(first)).not.toBe(nameOf(second));
  });

  test('should not emit anything on an SSR pass', async () => {
    const output = await buildProject(createProject(), {}, true);

    expect(output.filter(file => file.fileName.endsWith('.svg'))).toHaveLength(0);
  });

  test('should write the generated module before bundling', async () => {
    const root = createProject({ 'arrow.svg': RED, 'nested/close.svg': BLUE });

    await buildProject(root, { types: true, symbolId: '[dir]-[name]' });

    const generated = fs.readFileSync(path.join(root, 'src', 'spritemap-icons.ts'), 'utf-8');

    expect(generated).toContain('"arrow"');
    expect(generated).toContain('"nested-close"');
    expect(generated).toContain('export const spritemapUrl = "/spritemap.svg";');
  });

  test('should point the generated module at the hashed url', async () => {
    const root = createProject();

    const output = await buildProject(root, { types: true, filename: 'sprite-[hash].svg' });
    const fileName = output.find(file => file.fileName.endsWith('.svg'))!.fileName;
    const generated = fs.readFileSync(path.join(root, 'src', 'spritemap-icons.ts'), 'utf-8');

    expect(generated).toContain(`export const spritemapUrl = "/${fileName}";`);
  });
});

describe('dev server', () => {
  test('should serve the sprite', async () => {
    const { url } = await startServer(createProject());
    const response = await fetch(`${url}/spritemap.svg`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/svg+xml');
    expect(await response.text()).toContain('id="arrow"');
  });

  test('should serve the cache-busted url the HMR client requests', async () => {
    const { url } = await startServer(createProject());
    const response = await fetch(`${url}/spritemap.svg?t=123`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('id="arrow"');
  });

  test('should inject the HMR client into the page', async () => {
    const { url } = await startServer(createProject());
    const html = await (await fetch(`${url}/`)).text();

    expect(html).toContain('virtual:vite-plugin-svg-spritemap/client');
  });

  test('should not inject anything when hmr is off', async () => {
    const { url } = await startServer(createProject(), { hmr: false });
    const html = await (await fetch(`${url}/`)).text();

    expect(html).not.toContain('virtual:vite-plugin-svg-spritemap');
  });

  test('should rebuild the sprite when an icon changes', async () => {
    const root = createProject();
    const { url } = await startServer(root);
    const sprite = () => fetch(`${url}/spritemap.svg`).then(response => response.text());

    expect(await sprite()).toContain('viewBox="0 0 10 10"');

    fs.writeFileSync(path.join(root, 'icons', 'arrow.svg'), BLUE);

    await waitFor('the changed icon', async () => (await sprite()).includes('viewBox="0 0 20 20"'));
  }, 15000);

  test('should pick up an added icon and drop a removed one', async () => {
    const root = createProject();
    const { url } = await startServer(root);
    const sprite = () => fetch(`${url}/spritemap.svg`).then(response => response.text());

    fs.writeFileSync(path.join(root, 'icons', 'extra.svg'), BLUE);
    await waitFor('the added icon', async () => (await sprite()).includes('id="extra"'));

    // Give chokidar a beat to finish registering the new file: removing it in the
    // same tick can make it drop the unlink event.
    await new Promise(resolve => setTimeout(resolve, 300));

    fs.rmSync(path.join(root, 'icons', 'extra.svg'));
    await waitFor('the removed icon', async () => !(await sprite()).includes('id="extra"'), 10000);
  }, 15000);

  test('should send an HMR event instead of reloading', async () => {
    const root = createProject();
    const { server } = await startServer(root);

    const events = spyOnSpriteEvents(server);

    fs.writeFileSync(path.join(root, 'icons', 'arrow.svg'), BLUE);

    await waitFor('the hmr event', () => events.includes(HMR_EVENT));
    expect(events).not.toContain('full-reload');
  });

  test('should fall back to a full reload when hmr is off', async () => {
    const root = createProject();
    const { server } = await startServer(root, { hmr: false });

    const events = spyOnSpriteEvents(server);

    fs.writeFileSync(path.join(root, 'icons', 'arrow.svg'), BLUE);

    await waitFor('the full reload', () => events.includes('full-reload'));
  });

  test('should ignore files that do not match the pattern', async () => {
    const root = createProject();
    const { server } = await startServer(root);

    // The fixture is written moments before the watcher starts, and macOS can
    // still deliver an event for it. Let that settle before measuring.
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Vite has its own watcher and talks on the same channel, so only count ours.
    const events = spyOnSpriteEvents(server);

    fs.writeFileSync(path.join(root, 'icons', 'notes.txt'), 'not an icon');
    await new Promise(resolve => setTimeout(resolve, 1500));

    expect(events).toEqual([]);
  }, 15000);

  test('should keep the generated module in sync', async () => {
    const root = createProject();
    const generated = path.join(root, 'src', 'spritemap-icons.ts');

    await startServer(root, { types: true });

    await waitFor('the generated module', () => fs.existsSync(generated));
    expect(fs.readFileSync(generated, 'utf-8')).toContain('"arrow"');

    fs.writeFileSync(path.join(root, 'icons', 'extra.svg'), BLUE);

    await waitFor('the module to list the new icon', () =>
      fs.readFileSync(generated, 'utf-8').includes('"extra"'),
    );
  });

  test('should leave the generated module untouched when the names did not change', async () => {
    const root = createProject();
    const generated = path.join(root, 'src', 'spritemap-icons.ts');

    await startServer(root, { types: true });
    await waitFor('the generated module', () => fs.existsSync(generated));

    const before = fs.statSync(generated).mtimeMs;

    fs.writeFileSync(path.join(root, 'icons', 'arrow.svg'), BLUE);
    await new Promise(resolve => setTimeout(resolve, 800));

    expect(fs.statSync(generated).mtimeMs).toBe(before);
  });
});
