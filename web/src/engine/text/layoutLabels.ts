import type { Atlas } from './Atlas';

/** Floats per glyph instance: offset and size in pixels, atlas uv corners, segment. Matches glyphs.wgsl. */
export const GLYPH_FLOATS = 12;

export interface LabelText {
  segment: number;
  /** Lines joined by newlines. */
  text: string;
}

/** A label's box per character and per line, in pixels, at `fontPx`. */
export function labelMetrics(atlas: Atlas, fontPx: number): { advance: number; lineHeight: number } {
  const scale = fontPx / atlas.metrics.size;
  return { advance: atlas.advance * scale, lineHeight: atlas.metrics.lineHeight * scale };
}

/**
 * Glyph quads for each label, around its anchor: lines stacked and each one
 * centred, as Bandage centres its node text, in a box of exactly the size
 * placement measured.
 */
export function layoutLabels(labels: LabelText[], atlas: Atlas, fontPx: number): Float32Array<ArrayBuffer> {
  const scale = fontPx / atlas.metrics.size;
  const { advance, lineHeight } = labelMetrics(atlas, fontPx);
  const { width: aw, height: ah } = atlas.metrics;
  const out: number[] = [];
  const segments: number[] = [];
  for (const { segment, text } of labels) {
    const lines = text.split('\n');
    const top = (-lines.length * lineHeight) / 2;
    lines.forEach((line, row) => {
      // Code points, so a character outside the atlas takes one cell, as its label box counted it.
      const chars = Array.from(line);
      const left = (-chars.length * advance) / 2;
      chars.forEach((char, column) => {
        const g = atlas.glyph(char.codePointAt(0) ?? 0);
        if (!g || g.width === 0) return;
        out.push(
          left + column * advance + g.xoffset * scale,
          top + row * lineHeight + g.yoffset * scale,
          g.width * scale,
          g.height * scale,
          g.x / aw,
          g.y / ah,
          (g.x + g.width) / aw,
          (g.y + g.height) / ah,
          0,
          0,
          0,
          0,
        );
        segments.push(segment);
      });
    });
  }
  const glyphs = Float32Array.from(out);
  const words = new Uint32Array(glyphs.buffer);
  segments.forEach((segment, i) => {
    words[i * GLYPH_FLOATS + 8] = segment;
  });
  return glyphs;
}
