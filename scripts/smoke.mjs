// Runs the built plugin against the test fixtures on a bare production install.
// Verifies that dist/ loads and that the whole dependency chain (tinyglobby,
// svgo, node-html-parser, picomatch, chokidar) works on this Node version.
import { svgSpritemap } from '../dist/index.js';

const plugins = svgSpritemap({ pattern: 'src/assets/*.svg', currentColor: true, view: true });

const buildPlugin = plugins.find(plugin => plugin.name.endsWith(':build'));
if (!buildPlugin) {
  throw new Error('build plugin is missing');
}

await buildPlugin.configResolved({ root: process.cwd(), base: '/', build: { outDir: 'dist' } });
buildPlugin.buildStart.call({});

const emitted = [];
buildPlugin.generateBundle.call({ emitFile: file => emitted.push(file) });

const sprite = emitted[0];

const assertions = [
  ['one asset emitted', emitted.length === 1],
  ['emitted as an asset', sprite?.type === 'asset'],
  ['named spritemap.svg', sprite?.fileName === 'spritemap.svg'],
  ['symbol from close.svg', sprite?.source.includes('id="close"')],
  ['symbol from close-with-defs.svg', sprite?.source.includes('id="close-with-defs"')],
  ['defs hoisted to top level', sprite?.source.includes('<defs>')],
  ['defs ids namespaced', sprite?.source.includes('id="close-with-defs-')],
  ['currentColor applied', sprite?.source.includes('currentColor')],
  ['views generated', sprite?.source.includes('<view id="close-view"')],
];

const failed = assertions.filter(([, ok]) => !ok);
if (failed.length > 0) {
  throw new Error(`smoke test failed: ${failed.map(([name]) => name).join(', ')}`);
}

console.log(`smoke test passed on node ${process.version}`);
