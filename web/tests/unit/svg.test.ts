import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY } from '../../src/engine/style/display';
import { cssColor, goldenHue, hueColor, mix } from '../../src/engine/style/colors';
import { type SvgScene, TooManySegmentsError, viewToSvg } from '../../src/engine/export/svg';

const tags = { segments: new Uint32Array(0), colors: new Uint32Array(0) };

/** Three segments in a row, `a` of two pieces, joined by two links; `c` far off screen. The selection outline is 1 unit at zoom 4, a pair of rings of half a unit. */
function scene(patch: Partial<SvgScene> = {}): SvgScene {
  return {
    positions: new Float32Array([0, 0, 20, 0, 40, 0, 50, 0, 70, 0, 5000, 0, 5020, 0]),
    geometry: {
      segmentStarts: new Uint32Array([0, 3, 5]),
      segmentPieces: new Uint8Array([2, 1, 1]),
      links: new Uint32Array([2, 1, 3, 4, 4, 3, 5, 6]),
    },
    segments: {
      depth: new Float32Array([1, 2, 3]),
      gc: new Float32Array(3),
      tagColors: tags,
      tagColors2: tags,
      lengths: new Uint32Array([40, 20, 20]),
      components: new Uint32Array(3),
      linkFrom: new Uint32Array([0, 1]),
      linkTo: new Uint32Array([1, 2]),
      meanDepth: 2,
    },
    seed: 1,
    style: { theme: 'light', display: DEFAULT_DISPLAY },
    view: { x: 35, y: 0, zoom: 4, width: 400, height: 200 },
    selection: new Uint32Array(1),
    hidden: undefined,
    labels: { labels: [{ segment: 1, text: 'b<1>\n20 bp' }], fontPx: 12, lineHeight: 14 },
    bands: undefined,
    ...patch,
  };
}

async function svg(s: SvgScene): Promise<string> {
  return (await viewToSvg(s)).text();
}

/** `attribute` of every element of `tag` whose attributes match `filter`. */
function attributes(text: string, tag: string, attribute: string, filter = ''): string[] {
  const elements = text.match(new RegExp(`<${tag} [^>]*>`, 'g')) ?? [];
  return elements.filter((e) => e.includes(filter)).map((e) => new RegExp(`${attribute}="([^"]*)"`).exec(e)?.[1] ?? '');
}

describe('SVG export', () => {
  it('draws the segments and links in view with the shader colours and the labels', async () => {
    const text = await svg(scene());
    expect(attributes(text, 'svg', 'viewBox')).toEqual(['-15 -25 100 50']);
    expect(attributes(text, 'path', 'd', 'stroke-width="5"')).toEqual(['M0 0L20 0L40 0', 'M50 0L70 0']);
    expect(attributes(text, 'path', 'stroke', 'stroke-width="5"')[0]).toBe(cssColor(hueColor(goldenHue(mix(1), 0))));
    expect(attributes(text, 'path', 'd', 'C')).toEqual(['M40 0C45 0 45 0 50 0', 'M70 0C2042 0 3028 0 5000 0']);
    expect(text).toContain('>b&lt;1&gt;</tspan>');
    expect(text).toContain('>20 bp</tspan>');
  });

  it('outlines the selection, dims the rest and leaves out what a filter hides', async () => {
    const text = await svg(
      scene({
        selection: new Uint32Array([0b10]),
        hidden: { segments: new Uint32Array([0b1]), links: new Uint32Array([0b1]) },
      }),
    );
    expect(attributes(text, 'path', 'd').some((d) => d.startsWith('M0 0'))).toBe(false);
    expect(attributes(text, 'path', 'stroke-width', 'd="M50 0L70 0"')).toEqual(['5', '6', '5', '4']);
  });

  it('refuses a view with more segments than the cap', async () => {
    const n = 50_001;
    const positions = new Float32Array(n * 4);
    const starts = Uint32Array.from({ length: n }, (_, i) => i * 2);
    const big = scene({
      positions,
      geometry: { segmentStarts: starts, segmentPieces: new Uint8Array(n).fill(1), links: new Uint32Array(0) },
      labels: { labels: [], fontPx: 12, lineHeight: 14 },
    });
    await expect(viewToSvg(big)).rejects.toBeInstanceOf(TooManySegmentsError);
  });

  it('stripes a ribbon by the paths highlighted on it, the first on the side of lower y', async () => {
    const base = scene();
    const red = 0xff0000ff;
    const blue = 0xffff0000;
    const text = await svg(
      scene({
        style: { theme: 'light', display: { ...DEFAULT_DISPLAY, color: 'path' } },
        segments: {
          ...base.segments,
          pathColors: Uint32Array.from([red, 0, 0]),
          pathExtra: [Uint32Array.from([blue, 0, 0]), new Uint32Array(3), new Uint32Array(3)],
        },
      }),
    );
    // Segment `a` is 5 wide: two stripes of 2.5, a quarter of its width either side of the middle.
    expect(attributes(text, 'path', 'stroke-width', 'stroke="#ff0000"')).toEqual(['2.5']);
    expect(attributes(text, 'path', 'stroke-width', 'stroke="#0000ff"')).toEqual(['2.5']);
    expect(attributes(text, 'path', 'd', 'stroke="#ff0000"')[0]).toBe('M0 -1.25L20 -1.25L40 -1.25');
  });
});
