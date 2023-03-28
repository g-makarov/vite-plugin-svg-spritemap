import fg from 'fast-glob';
import fs from 'fs';
import { Config as SVGOConfig, optimize } from 'svgo';
import path from 'path';
import { HTMLElement, parse } from 'node-html-parser';
import { SvgSpritemapOptions } from './index';

type GetSpriteContentOptions = Pick<
  SvgSpritemapOptions,
  'pattern' | 'prefix' | 'svgo' | 'currentColor'
>;

export function getSpriteContent({
  pattern,
  prefix,
  svgo,
  currentColor,
}: GetSpriteContentOptions): string {
  const svgFiles = fg.sync(pattern);
  const symbols: string[] = [];

  let svgoConfig: SVGOConfig = {};

  if (typeof svgo === 'object') {
    svgoConfig = svgo;
  }

  if (currentColor) {
    if (!svgoConfig.plugins) {
      svgoConfig.plugins = [];
    }
    svgoConfig.plugins.push({
      name: 'convertColors',
      params: {
        currentColor: true,
      },
    });
  }

  svgFiles.forEach(file => {
    let code = fs.readFileSync(file, 'utf-8');
    const result = svgo ? optimize(code, svgoConfig).data : code;
    const name = path.basename(file, '.svg');
    const symbolId = `${prefix}-${name}`;

    const svgElement = parse(result).querySelector('svg') as HTMLElement;
    const symbol = parse('<symbol/>').querySelector('symbol') as HTMLElement;

    symbol.setAttribute('id', symbolId);

    if (svgElement.attributes.viewBox) {
      symbol.setAttribute('viewBox', svgElement.attributes.viewBox);
    }

    svgElement.childNodes.forEach(child => symbol.appendChild(child));

    symbols.push(symbol.toString());
  });

  return `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>`;
}
