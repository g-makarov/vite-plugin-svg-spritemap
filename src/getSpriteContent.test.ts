import { describe, expect, test, vi } from 'vitest';
import { HTMLElement, parse } from 'node-html-parser';
import type { Config } from 'svgo';
import { getSpriteContent } from './getSpriteContent';

describe('getSpriteContent', () => {
  const sprite = getSpriteContent({ pattern: 'src/assets/*.svg', currentColor: true, svgo: true });
  const svgElement = parse(sprite.content).querySelector('svg') as HTMLElement;

  test('should return a string', () => {
    expect(typeof sprite.content).toBe('string');
  });

  test('should contain and symbol with id "close"', () => {
    const closeSymbol = svgElement.querySelector('symbol#close');
    expect(closeSymbol).not.toBe(null);
  });

  test('should isolate defs from "close-with-defs.svg" at the top level', () => {
    const defs = svgElement.querySelector('defs');
    expect(defs).not.toBe(null);
  });

  test('icon "close" should have currentColor in fill attributes', () => {
    const closeSymbol = svgElement.querySelector('symbol#close');
    closeSymbol?.querySelectorAll('[fill]').forEach(element => {
      expect(element.getAttribute('fill')).toBe('currentColor');
    });
  });

  test('should report the ids of the symbols it emitted', () => {
    expect([...sprite.symbolIds].sort()).toEqual(['close', 'close-with-defs']);
  });

  test('should support a literal prefix through symbolId', () => {
    const prefixed = getSpriteContent({
      pattern: 'src/assets/*.svg',
      symbolId: 'icon-[name]',
      svgo: true,
    });
    expect([...prefixed.symbolIds].sort()).toEqual(['icon-close', 'icon-close-with-defs']);
  });
});

describe('getSpriteContent with unusable files', () => {
  test('should skip them instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const sprite = getSpriteContent({ pattern: 'src/assets/invalid/*.svg', svgo: true });

    expect(parse(sprite.content).querySelectorAll('symbol')).toHaveLength(0);
    expect(sprite.symbolIds).toEqual([]);
    // Only the file with content but no <svg> root is worth reporting; an empty
    // file is what a half-written icon looks like to the watcher.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('no-root.svg');

    warn.mockRestore();
  });
});

describe('svgo config', () => {
  test('should not be mutated across calls', () => {
    const userConfig: Config = { plugins: [] };

    for (let index = 0; index < 3; index++) {
      getSpriteContent({ pattern: 'src/assets/*.svg', svgo: userConfig, currentColor: true });
    }

    expect(userConfig.plugins).toHaveLength(0);
  });
});

describe('symbol ids', () => {
  test('should skip files whose id is already taken', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const sprite = getSpriteContent({ pattern: 'src/assets/nested/**/*.svg', svgo: true });

    expect(sprite.symbolIds).toEqual(['close']);
    expect(parse(sprite.content).querySelectorAll('symbol')).toHaveLength(1);
    expect(warn.mock.calls[0]?.[0]).toContain('is already used by');

    warn.mockRestore();
  });

  test('should keep them apart with the [dir] token', () => {
    const sprite = getSpriteContent({
      pattern: 'src/assets/nested/**/*.svg',
      symbolId: '[dir]-[name]',
      svgo: true,
    });

    expect([...sprite.symbolIds].sort()).toEqual(['a-close', 'b-close']);
  });

  test('should accept a function', () => {
    const sprite = getSpriteContent({
      pattern: 'src/assets/nested/**/*.svg',
      symbolId: file => file.replace(/[^a-z]+/g, '-'),
      svgo: true,
    });

    expect(sprite.symbolIds).toHaveLength(2);
  });

  test('should collapse an empty [dir] instead of leaving a dangling dash', () => {
    const sprite = getSpriteContent({
      pattern: 'src/assets/*.svg',
      symbolId: '[dir]-[name]',
      svgo: true,
    });

    expect([...sprite.symbolIds].sort()).toEqual(['close', 'close-with-defs']);
  });
});

describe('defs isolation', () => {
  // SVGO's `cleanupIds` shortens ids per file, so every icon tends to come out
  // with an id of `a`. Without namespacing they would all collide in the sprite.
  test('should namespace ids so icons cannot overwrite each other', () => {
    const sprite = getSpriteContent({ pattern: 'src/assets/defs/*.svg', svgo: true });
    const root = parse(sprite.content);

    const ids = root.querySelectorAll('defs > *').map(node => node.getAttribute('id'));

    expect([...ids].sort()).toEqual(['one-a', 'two-a']);
    expect(new Set(ids).size).toBe(ids.length);
    expect(sprite.content).toContain('url(#one-a)');
    expect(sprite.content).toContain('url(#two-a)');
  });

  test('should namespace ids with svgo disabled too', () => {
    const sprite = getSpriteContent({ pattern: 'src/assets/defs/*.svg', svgo: false });

    expect(sprite.content).toContain('id="one-grad"');
    expect(sprite.content).toContain('id="two-grad"');
    expect(sprite.content).toContain('url(#two-grad)');
  });
});

describe('view generation', () => {
  test('should be off by default', () => {
    const sprite = getSpriteContent({ pattern: 'src/assets/*.svg', svgo: true });
    expect(sprite.content).not.toContain('<view');
  });

  test('should emit a stacked <use> and a <view> per icon', () => {
    const sprite = getSpriteContent({ pattern: 'src/assets/*.svg', view: true, svgo: true });
    const root = parse(sprite.content);
    const views = root.querySelectorAll('view');

    expect(views).toHaveLength(2);
    expect(views.map(node => node.getAttribute('id')).sort()).toEqual([
      'close-view',
      'close-with-defs-view',
    ]);

    // Icons are stacked, so every view frames a different band of the document.
    const boxes = views.map(node => node.getAttribute('viewBox'));
    expect(new Set(boxes).size).toBe(2);
  });
});
