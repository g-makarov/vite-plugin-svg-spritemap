import fg from 'fast-glob';
import fs from 'fs';
import { Config as SVGOConfig, optimize } from 'svgo';
import path from 'path';
import { HTMLElement, parse } from 'node-html-parser';

const svgoConfig: SVGOConfig = {
  plugins: [
    {
      name: 'convertColors',
      params: {
        currentColor: true,
      },
    },
  ],
};

export function getSpriteContent(pattern: string, prefix: string): string {
  const svgFiles = fg.sync(pattern);
  const symbols: string[] = [];

  svgFiles.forEach(file => {
    let code = fs.readFileSync(file, 'utf-8');
    const result = optimize(code, svgoConfig);
    const name = path.basename(file, '.svg');
    const symbolId = `${prefix}-${name}`;

    const svgElement = parse(result.data).querySelector('svg') as HTMLElement;
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
