import { describe, expect, test } from 'vitest';
import { HTMLElement, parse } from 'node-html-parser';
import { getSpriteContent } from './getSpriteContent';

describe('getSpriteContent', () => {
  const result = getSpriteContent({ pattern: 'src/assets/*.svg', currentColor: true, svgo: true });
  const svgElement = parse(result).querySelector('svg') as HTMLElement;

  test('should return a string', () => {
    expect(typeof result).toBe('string');
  });

  test('should contain and symbol with id "close"', () => {
    const closeSymbol = svgElement.querySelector('symbol#close');
    expect(closeSymbol).not.toBe(null);
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
});
