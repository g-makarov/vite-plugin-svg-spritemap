import { globSync } from 'tinyglobby';
import fs from 'node:fs';
import { optimize } from 'svgo';
import type { Config as SVGOConfig } from 'svgo';
import path from 'node:path';
import { HTMLElement, parse } from 'node-html-parser';
import picomatch from 'picomatch';
import type { SvgSpritemapOptions } from './index';

interface GetSpriteContentOptions extends Pick<
  SvgSpritemapOptions,
  'pattern' | 'svgo' | 'currentColor' | 'symbolId' | 'view'
> {
  /** Directory the glob is resolved against. Defaults to the current directory. */
  root?: string;
}

export interface Sprite {
  content: string;
  /** Ids of the symbols that made it into the sprite, in document order. */
  symbolIds: string[];
}

const DEFAULT_SYMBOL_ID = '[name]';

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function tidy(id: string): string {
  return id.replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}

function resolveSymbolId(
  file: string,
  base: string,
  symbolId: NonNullable<GetSpriteContentOptions['symbolId']>,
): string {
  const name = path.basename(file, '.svg');

  let id: string;

  if (typeof symbolId === 'function') {
    id = symbolId(toPosix(file), name);
  } else {
    const relativeDir = toPosix(path.relative(base, path.dirname(file)));
    const dir = relativeDir === '' || relativeDir === '.' ? '' : relativeDir.replace(/\//g, '-');

    id = symbolId.replaceAll('[dir]', dir).replaceAll('[name]', name);
  }

  return tidy(id);
}

/**
 * Namespaces every id in a single icon so that gradients, masks and clip paths
 * coming from different files cannot overwrite each other once they share the
 * sprite's `<defs>`.
 */
function isolateIds(markup: string, namespace: string): string {
  const ids = new Set(
    [...markup.matchAll(/\bid="([^"]*)"/g)].map(match => match[1]).filter(Boolean),
  );

  let result = markup;

  for (const id of ids) {
    const escaped = id!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const next = `${namespace}-${id}`;

    result = result
      .replace(new RegExp(`\\bid="${escaped}"`, 'g'), `id="${next}"`)
      .replace(new RegExp(`url\\(#${escaped}\\)`, 'g'), `url(#${next})`)
      .replace(new RegExp(`href="#${escaped}"`, 'g'), `href="#${next}"`);
  }

  return result;
}

function parseViewBox(viewBox: string | undefined): { width: number; height: number } | undefined {
  if (!viewBox) {
    return undefined;
  }

  const parts = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);

  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part))) {
    return undefined;
  }

  const [, , width, height] = parts as [number, number, number, number];

  return width > 0 && height > 0 ? { width, height } : undefined;
}

export function getSpriteContent({
  pattern,
  svgo,
  currentColor,
  symbolId = DEFAULT_SYMBOL_ID,
  view = false,
  root = process.cwd(),
}: GetSpriteContentOptions): Sprite {
  // The glob belongs to the project, which is not necessarily the directory the
  // process was started from.
  const svgFiles = globSync(pattern, { cwd: root, expandDirectories: false });
  const base = picomatch.scan(pattern).base || '.';

  const symbols: string[] = [];
  const symbolIds: string[] = [];
  const definitions: string[] = [];
  const views: string[] = [];
  const seen = new Map<string, string>();

  let viewOffset = 0;

  // Never touch the caller's object: this runs on every dev server request, and
  // pushing into their `plugins` array would grow it without bound.
  const svgoConfig: SVGOConfig = typeof svgo === 'object' ? { ...svgo } : {};

  if (currentColor) {
    svgoConfig.plugins = [
      ...(svgoConfig.plugins ?? []),
      { name: 'convertColors', params: { currentColor: true } },
    ];
  }

  svgFiles.forEach(file => {
    const code = fs.readFileSync(path.resolve(root, file), 'utf-8');

    // The dev server watcher can pick a file up before its contents are
    // flushed to disk. Skip it — the following change event rebuilds the sprite.
    if (!code.trim()) {
      return;
    }

    let result: string;

    try {
      result = svgo ? optimize(code, svgoConfig).data : code;
    } catch (error) {
      console.warn(`[vite-plugin-svg-spritemap] skipped ${file}: ${(error as Error).message}`);
      return;
    }

    const id = resolveSymbolId(file, base, symbolId);
    const previous = seen.get(id);

    if (previous !== undefined) {
      console.warn(
        `[vite-plugin-svg-spritemap] skipped ${file}: id "${id}" is already used by ${previous}. ` +
          'Set the `symbolId` option (for example `"[dir]-[name]"`) to keep them apart.',
      );
      return;
    }

    const svgElement = parse(isolateIds(result, id)).querySelector('svg');

    if (!svgElement) {
      console.warn(`[vite-plugin-svg-spritemap] skipped ${file}: no <svg> root element`);
      return;
    }

    const symbol = parse('<symbol/>').querySelector('symbol') as HTMLElement;
    const defs = svgElement.querySelector('defs');

    if (defs) {
      defs.childNodes.forEach(def => definitions.push(def.toString()));
      svgElement.removeChild(defs);
    }

    symbol.setAttribute('id', id);

    const viewBox = svgElement.attributes.viewBox;

    if (viewBox) {
      symbol.setAttribute('viewBox', viewBox);
    }

    svgElement.childNodes.forEach(child => symbol.appendChild(child));

    symbols.push(symbol.toString());
    symbolIds.push(id);
    seen.set(id, file);

    if (!view) {
      return;
    }

    const size = parseViewBox(viewBox);

    if (!size) {
      console.warn(
        `[vite-plugin-svg-spritemap] no <view> generated for ${file}: it has no usable viewBox.`,
      );
      return;
    }

    // `<symbol>` is never rendered, so an `<img src="sprite.svg#id-view">` needs
    // a laid out `<use>` plus a `<view>` framing it.
    views.push(
      `<use href="#${id}" x="0" y="${viewOffset}" width="${size.width}" height="${size.height}"/>` +
        `<view id="${id}-view" viewBox="0 ${viewOffset} ${size.width} ${size.height}"/>`,
    );

    viewOffset += size.height;
  });

  const content =
    `<svg xmlns="http://www.w3.org/2000/svg">` +
    (definitions.length > 0 ? `<defs>${definitions.join('')}</defs>` : '') +
    symbols.join('') +
    views.join('') +
    `</svg>`;

  return { content, symbolIds };
}
