/** web/public/fonts/label-atlas.json, written by scripts/font-atlas.mjs. */
export interface AtlasMetrics {
  /** The font size the atlas was drawn at, in its pixels. */
  size: number;
  lineHeight: number;
  base: number;
  /** Atlas pixels the signed distance spans. */
  distanceRange: number;
  width: number;
  height: number;
  /** `code, x, y, width, height, xoffset, yoffset, xadvance` per glyph. */
  glyphs: number[][];
}

export interface Glyph {
  x: number;
  y: number;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
}

/** The atlas covers ASCII 32 to 126; anything else shows as this. */
const MISSING = '?'.charCodeAt(0);

export class Atlas {
  private readonly glyphs = new Map<number, Glyph>();

  constructor(
    readonly metrics: AtlasMetrics,
    readonly image: ImageBitmap,
  ) {
    for (const [
      code = 0,
      x = 0,
      y = 0,
      width = 0,
      height = 0,
      xoffset = 0,
      yoffset = 0,
      xadvance = 0,
    ] of metrics.glyphs) {
      this.glyphs.set(code, { x, y, width, height, xoffset, yoffset, xadvance });
    }
  }

  /** The committed atlas under `base`; without it labels are off. */
  static async load(base: string): Promise<Atlas | undefined> {
    try {
      const [metrics, blob] = await Promise.all([
        fetch(`${base}fonts/label-atlas.json`).then((r) => r.json() as Promise<AtlasMetrics>),
        fetch(`${base}fonts/label-atlas.png`).then((r) => r.blob()),
      ]);
      // Distances are data, not colour: no premultiplying or colour conversion.
      const image = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      return new Atlas(metrics, image);
    } catch (error) {
      console.warn('labels are off: the font atlas did not load', error);
      return undefined;
    }
  }

  glyph(code: number): Glyph | undefined {
    return this.glyphs.get(code) ?? this.glyphs.get(MISSING);
  }

  /** Every glyph of a monospace font advances the same. */
  get advance(): number {
    return this.glyph(MISSING)?.xadvance ?? this.metrics.size * 0.6;
  }
}
