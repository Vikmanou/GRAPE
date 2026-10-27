import type { SegmentData } from '../core/backend';
import { rampColor } from './ramps';
import { type ColorRange, rangeFraction } from './scales';

export type ColorMode = 'uniform' | 'random' | 'depth' | 'gc' | 'length' | 'component' | 'tags';

/** Which copy of a segment is drawn: the one of single mode, or a strand of double mode. */
export type Strand = 'single' | 'forward' | 'reverse';

/** RGBA8 with red in the low byte, as WGSL's `unpack4x8unorm` reads it. */
export function rgba8(r: number, g: number, b: number, a = 255): number {
  return (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
}

// Bandage's `uniformPositiveNodeColour` and `defaultCustomNodeColour`
// (program/settings.cpp).
export const UNIFORM_COLOR = rgba8(178, 34, 34);
export const NO_TAG_COLOR = rgba8(190, 190, 190);

// Bandage's random colours: saturation 127 and lightness 150 of 255
// (`randomColourPositiveSaturation`, `randomColourPositiveLightness`).
const SATURATION = 127 / 255;
const LIGHTNESS = 150 / 255;
/** 2^32 over the golden ratio: hues stepped by it stay far apart for any run of ids. */
const GOLDEN_STEP = 0x9e3779b9;

/** murmur3's 32-bit finaliser, to turn the seed into a starting hue. */
export function mix(x: number): number {
  let h = x >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** The `i`th hue from `start`, in 0 to 1; integer steps stay exact for any `i`. */
export function goldenHue(start: number, i: number): number {
  return ((start + Math.imul(i, GOLDEN_STEP)) >>> 0) / 2 ** 32;
}

/** HSL to RGB, all in 0 to 1. */
export function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
}

export function hueColor(hue: number): number {
  const [r, g, b] = hsl(hue, SATURATION, LIGHTNESS);
  return rgba8(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
}

function tagged(tags: SegmentData['tagColors'], segment: number): number | undefined {
  const { segments, colors } = tags;
  let lo = 0;
  let hi = segments.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((segments[mid] ?? 0) < segment) lo = mid + 1;
    else hi = mid;
  }
  return segments[lo] === segment ? colors[lo] : undefined;
}

/** Bandage's `getCustomColourForDisplay`: single mode falls back to the reverse strand's colour. */
export function tagColor(data: SegmentData, segment: number, strand: Strand): number {
  const forward = tagged(data.tagColors, segment);
  const reverse = tagged(data.tagColors2, segment);
  if (strand === 'reverse') return reverse ?? NO_TAG_COLOR;
  if (strand === 'forward') return forward ?? NO_TAG_COLOR;
  return forward ?? reverse ?? NO_TAG_COLOR;
}

export interface ColorStyle {
  mode: ColorMode;
  /** For depth, GC and length. */
  range: ColorRange;
  seed: number;
  /** For a depth or GC that is unknown. */
  unknown: number;
}

/** A segment's colour as the shaders compute it, for tests and exports. */
export function segmentColor(style: ColorStyle, data: SegmentData, segment: number, strand: Strand): number {
  const ramped = (value: number) => {
    const t = rangeFraction(value, style.range);
    return Number.isNaN(t) ? style.unknown : rampColor(t);
  };
  switch (style.mode) {
    case 'uniform':
      return UNIFORM_COLOR;
    case 'random':
      return hueColor(goldenHue(mix(style.seed), segment));
    case 'component':
      return hueColor(goldenHue(0, data.components[segment] ?? 0));
    case 'tags':
      return tagColor(data, segment, strand);
    case 'depth':
      return ramped(data.depth[segment] ?? NaN);
    case 'gc':
      return ramped(data.gc[segment] ?? NaN);
    case 'length':
      return ramped(data.lengths[segment] ?? NaN);
  }
}

/** `#rrggbb` for an RGBA8 colour, for CSS. */
export function cssColor(color: number): string {
  const rgb = ((color & 0xff) << 16) | (color & 0xff00) | ((color >>> 16) & 0xff);
  return `#${rgb.toString(16).padStart(6, '0')}`;
}
