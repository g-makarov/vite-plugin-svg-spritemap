# Changelog

## 2.0.1

### Fixed

- The sprite 404'd in dev under frameworks that wrap Vite with a request handler of
  their own, Astro among them. The middleware was registered from a post hook, which
  put it behind that handler; it now runs ahead of it.
- An Astro production build emitted no sprite at all. Astro runs every build pass as an
  SSR pass, and the plugin skips those; it now only skips the ones that do not own the
  output assets (`build.ssrEmitAssets`).

## 2.0.0

A rewrite of the plugin internals around three long-standing defects: the dev server
watcher had not fired since chokidar 4, `emit` never reached Rollup, and icons sharing
a name or an internal id silently overwrote each other.

### Breaking

- **ESM only.** The CommonJS build is gone. Vite itself has been ESM-only since v5.
- **Requires Vite 5–8 and Node 20.19+.** `peerDependencies` previously claimed Vite 2–7;
  the new range is tested against every version it names.
- **Removed `emit`.** The sprite is always emitted as a Rollup asset now, so plugins that
  post-process the output — compression, for instance — see it without opting in.
  Delete the option.
- **Removed `prefix`.** Use `symbolId` instead, which covers the same ground:

  ```diff
  - svgSpritemap({ pattern: 'src/icons/*.svg', prefix: 'icon' })
  + svgSpritemap({ pattern: 'src/icons/*.svg', symbolId: 'icon-[name]' })
  ```

- **Ids declared inside icons are namespaced.** A gradient with `id="a"` becomes
  `id="arrow-a"`. References inside the icon are rewritten with it. If you were
  targeting a generated id from outside the sprite, it has changed.
- **Duplicate symbol ids are skipped with a warning** instead of producing a document
  with two identical ids. Set `symbolId` to `'[dir]-[name]'` when using a recursive glob.

### Fixed

- The dev server watcher never fired. chokidar dropped glob support in v4, and the
  plugin was still handing it a glob, so nothing reloaded on an icon change.
- A malformed or half-written `.svg` crashed the dev server. Such files are now skipped,
  with a warning for the ones that are genuinely broken.
- `emit: true` did nothing: `emitFile` ran in `writeBundle`, after Rollup had already
  generated the bundle.
- A user-supplied `svgo` config object was mutated on every call. In dev that meant the
  `plugins` array grew on every request to the sprite.
- The glob was resolved against the process working directory instead of the Vite root,
  so the sprite came out empty whenever the two differed.
- An SSR build emitted the sprite into the server output and rewrote the generated
  module with the wrong URL.
- `closeBundle` threw when the dev server had not been started.

### Added

- `types` generates a module with the icon names, a `IconName` union, the resolved
  sprite URL and an `iconHref()` helper. Off by default.
- `symbolId` controls how ids are derived, as a template (`[name]`, `[dir]`) or a function.
- `view` emits `<view>` elements so icons work in `<img>` and CSS `background-image`.
- `filename` accepts `[hash]` for long-term caching.
- `hmr` (on by default) swaps icons in place instead of reloading the page.

### Changed

- The dev server caches the generated sprite and rebuilds it on watcher events, instead
  of re-reading and re-optimizing every icon on every request.
- Built with tsdown; dependencies updated (SVGO 4, chokidar 5). `fs-extra` and
  `fast-glob` were dropped.
