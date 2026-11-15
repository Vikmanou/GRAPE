import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { palettes } from '../../src/engine/style/palette';

const css = readFileSync(new URL('../../src/ui/styles/tokens.css', import.meta.url), 'utf8');

function tokens(selector: string): Record<string, string> {
  const block = css.slice(css.indexOf(selector));
  const body = block.slice(block.indexOf('{') + 1, block.indexOf('}'));
  return Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1] ?? '', m[2] ?? '']));
}

const themes = { light: tokens(':root {'), dark: tokens(":root[data-theme='dark']") };

/** WCAG 2.x relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe.each(['light', 'dark'] as const)('%s theme tokens', (theme) => {
  const t = themes[theme];
  const surfaces = ['panel', 'chrome', 'bg'];

  it.each(['fg', 'muted', 'accent', 'warn'])('%s text reads at 4.5:1 on every surface (WCAG 1.4.3)', (name) => {
    for (const surface of surfaces) {
      expect(contrast(t[name] ?? '', t[surface] ?? ''), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('control borders reach 3:1 on every surface (WCAG 1.4.11)', () => {
    for (const surface of surfaces) {
      expect(contrast(t['control-border'] ?? '', t[surface] ?? ''), surface).toBeGreaterThanOrEqual(3);
    }
  });

  it('gives the canvas the colour the renderer clears to', () => {
    const [r, g, b] = palettes[theme].background;
    const hex = `#${[r, g, b]
      .map((v) =>
        Math.round(v * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
    expect(hex).toBe(t['bg']);
  });
});
