// Single source of render colors, shared by the WebGPU renderer and the
// WebGL2 fallback. Keep `background` in sync with --bg in ui/styles.css.

export type Theme = 'light' | 'dark';

/** RGBA, each channel 0 to 1, in sRGB. */
export type Rgba = readonly [number, number, number, number];

export interface Palette {
  background: Rgba;
  link: Rgba;
}

function hex(value: string): Rgba {
  const n = Number.parseInt(value.slice(1), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255, 1];
}

export const palettes: Record<Theme, Palette> = {
  light: { background: hex('#f7f7f5'), link: hex('#3d3d3a') },
  dark: { background: hex('#17161a'), link: hex('#c9c7d1') },
};

// Bandage's default random colours: a random hue at saturation 127 and
// lightness 150 of 255 (`randomColourPositiveSaturation` and
// `randomColourPositiveLightness` in Bandage's program/settings.cpp).
const SATURATION = 127 / 255;
const LIGHTNESS = 150 / 255;
/** Stepping hue by the golden ratio keeps any run of ids far apart in hue. */
const GOLDEN = (Math.sqrt(5) - 1) / 2;

/** murmur3's 32-bit finaliser, to turn the seed into a starting hue. */
function mix(x: number): number {
  let h = x >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
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

/** RGBA8 with red in the low byte, as WGSL's `unpack4x8unorm` reads it. */
export function randomColors(segments: number, seed: number): Uint32Array<ArrayBuffer> {
  const out = new Uint32Array(segments);
  const start = mix(seed) / 2 ** 32;
  for (let i = 0; i < segments; i++) {
    const [r, g, b] = hsl((start + i * GOLDEN) % 1, SATURATION, LIGHTNESS);
    out[i] = (Math.round(r * 255) | (Math.round(g * 255) << 8) | (Math.round(b * 255) << 16) | (255 << 24)) >>> 0;
  }
  return out;
}
