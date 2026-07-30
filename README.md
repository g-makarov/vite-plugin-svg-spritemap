# vite-plugin-svg-spritemap

[![CI](https://github.com/g-makarov/vite-plugin-svg-spritemap/actions/workflows/ci.yml/badge.svg)](https://github.com/g-makarov/vite-plugin-svg-spritemap/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/vite-plugin-svg-spritemap.svg?style=flat-square)](https://www.npmjs.com/package/vite-plugin-svg-spritemap)
[![npm downloads](https://img.shields.io/npm/dm/vite-plugin-svg-spritemap.svg?style=flat-square)](https://www.npmjs.com/package/vite-plugin-svg-spritemap)

A [Vite](https://vite.dev/) plugin that bundles a directory of `.svg` files into a single spritemap of `<symbol>` elements.

- Optionally generates a TypeScript union of the icon names, so a typo is a build error
- Optimizes icons with [SVGO](https://github.com/svg/svgo)
- Hoists `<defs>` to the top level and namespaces their ids, so gradients, patterns and
  masks keep working and never collide
- Optional `<view>` output for `<img>` and CSS `background-image`
- Content hashing for long-term caching
- HMR: editing an icon swaps it in place, without reloading the page

## Requirements

Vite 5–8, Node 20.19+. ESM only.

## Installation

```bash
npm install -D vite-plugin-svg-spritemap
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { svgSpritemap } from 'vite-plugin-svg-spritemap';

export default defineConfig({
  plugins: [svgSpritemap({ pattern: 'src/icons/*.svg' })],
});
```

Each file becomes a `<symbol>` whose id is the filename without extension — `src/icons/arrow.svg` → `#arrow`.

```html
<svg>
  <use href="/spritemap.svg#arrow"></use>
</svg>
```

The sprite is written to the build output directory and served at the same path in dev. Use the deprecated `xlink:href` instead of `href` if you need to support legacy browsers.

### React

```tsx
export const Icon = ({ name }: { name: string }) => (
  <svg>
    <use href={`/spritemap.svg#${name}`} />
  </svg>
);
```

Turn on [`types`](#typed-icon-names) to make `name` a union of the actual icon names
instead of `string`.

## Options

| Option         | Type                               | Default         | Description                                                                                              |
| -------------- | ---------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------- |
| `pattern`      | `string`                           | —               | Glob of the SVG files to include. Required.                                                              |
| `filename`     | `string`                           | `spritemap.svg` | Output filename. Supports `[hash]`.                                                                      |
| `symbolId`     | `string \| (file, name) => string` | `[name]`        | Template for the symbol ids. Tokens: `[name]`, `[dir]`. A function gets the file path and the base name. |
| `svgo`         | `SVGOConfig \| boolean`            | `true`          | SVGO optimization. Pass a config object to customize it.                                                 |
| `currentColor` | `boolean`                          | `false`         | Replace colors with `currentColor` so icons inherit CSS `color`.                                         |
| `view`         | `boolean`                          | `false`         | Also emit `<view>` elements, so icons work in `<img>` and CSS `background-image`.                        |
| `hmr`          | `boolean`                          | `true`          | Update icons in place in dev. Set to `false` to reload the whole page instead.                           |
| `types`        | `boolean \| string`                | `false`         | Generate a module with the icon names. `true` writes `src/spritemap-icons.ts`; pass a path to change it. |

The sprite is emitted as a Rollup asset, so other plugins — compression, for
instance — see it like any other build output.

### Duplicate names

Ids have to be unique within the sprite. With a recursive glob, `icons/ui/close.svg`
and `icons/nav/close.svg` both want `#close`; the plugin keeps the first and warns
about the second. Set `symbolId` to tell them apart:

```ts
svgSpritemap({ pattern: 'src/icons/**/*.svg', symbolId: '[dir]-[name]' });
// → #ui-close, #nav-close
```

A literal prefix is just part of the template — `symbolId: 'icon-[name]'` gives `#icon-arrow`.

Ids declared inside an icon (gradients, masks, clip paths) are namespaced
automatically, so two icons that both define `id="a"` no longer overwrite each other.

### Long-term caching

Put `[hash]` in `filename` and the name changes only when the icons do:

```ts
svgSpritemap({ pattern: 'src/icons/*.svg', filename: 'sprite-[hash].svg', types: true });
```

The generated module exports the resolved URL, so nothing has to be hardcoded:

```ts
import { iconHref, spritemapUrl } from './spritemap-icons';

spritemapUrl; // '/sprite-a1b2c3d4.svg'
iconHref('arrow'); // '/sprite-a1b2c3d4.svg#arrow'
```

The dev server keeps a stable `[hash]` of `dev`, so references do not go stale on edit.

### Icons in `<img>` and CSS

A `<symbol>` is never rendered, which is why an `<img>` pointing at one comes out blank.
Turn `view` on and each icon also gets a `<view>` framing it, addressable with a
`-view` suffix:

```html
<img src="/spritemap.svg#arrow-view" width="24" height="24" />
```

```css
.icon {
  background-image: url('/spritemap.svg#arrow-view');
}
```

Icons used this way cannot inherit `currentColor` — the browser renders them as an
independent document.

## Typed icon names

Turn `types` on and the plugin writes a module listing every symbol in the sprite:

```ts
svgSpritemap({ pattern: 'src/icons/*.svg', types: true });
```

```ts
// src/spritemap-icons.ts — generated, do not edit
export const spritemapUrl = '/spritemap.svg';

export const iconNames = ['arrow', 'close'] as const;

export type IconName = (typeof iconNames)[number];

export function iconHref(name: IconName): string {
  return `${spritemapUrl}#${name}`;
}
```

Use the type wherever an icon name is accepted, and a typo stops being a silently
blank icon:

```tsx
import { iconHref, type IconName } from './spritemap-icons';

export const Icon = ({ name }: { name: IconName }) => (
  <svg>
    <use href={iconHref(name)} />
  </svg>
);

<Icon name="arow" />;
// Type '"arow"' is not assignable to type '"arrow" | "close"'. Did you mean '"arrow"'?
```

The `iconNames` array is a real runtime value, which is handy for rendering every icon
at once in a gallery or a Storybook story.

The file is rewritten whenever an icon is added or removed, in dev and on build. It is
generated output — add it to `.gitignore` if you would rather not commit it.

## HMR

In dev the plugin injects a small client script that listens for sprite changes and
repoints every `<use>` at the rebuilt sprite. Editing, adding or removing an icon
updates the page without a reload, so application state survives.

The references are rewritten to `/spritemap.svg?t=<timestamp>#icon` — the query is what
forces the browser to re-resolve an external SVG document. Nothing is injected in
production builds.

`<img>` references are updated the same way. CSS `background-image` is not — set
`hmr: false` if your icons live in stylesheets and you want a reload instead.

If your app renders `<use>` elements into a shadow root, they are out of reach of the
client script; `hmr: false` covers that too.

## Upgrading from 1.x

See the [changelog](./CHANGELOG.md). The short version: the package is ESM only, needs
Vite 5+, `emit` is gone (the sprite is always a Rollup asset), and `prefix` is replaced
by `symbolId: 'prefix-[name]'`.

## License

MIT

---

If this plugin is useful to you, you can [buy me a coffee](https://www.buymeacoffee.com/gmakarov).
