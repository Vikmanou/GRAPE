// Single source of render colors, shared by the WebGPU renderer and the
// WebGL2 fallback. Keep `background` in sync with --bg in ui/styles.css.

export type Theme = 'light' | 'dark';

/** RGBA, each channel 0 to 1, in sRGB. */
export type Rgba = readonly [number, number, number, number];

export interface Palette {
  background: Rgba;
  link: Rgba;
  /** Around selected segments; the hovered one gets the lighter `hover`. */
  selection: Rgba;
  hover: Rgba;
  /** Segments whose depth or GC is unknown, in the modes colouring by them. */
  unknown: Rgba;
  /** Label text; its halo is the background. */
  label: Rgba;
}

function hex(value: string): Rgba {
  const n = Number.parseInt(value.slice(1), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255, 1];
}

function faded([r, g, b]: Rgba, alpha: number): Rgba {
  return [r, g, b, alpha];
}

// Light uses Bandage's `selectionColour` (0, 0, 255, program/settings.cpp);
// pure blue barely shows on the dark background, so dark uses a lighter blue.
const LIGHT_SELECTION = hex('#0000ff');
const DARK_SELECTION = hex('#7aa2ff');

export const palettes: Record<Theme, Palette> = {
  light: {
    background: hex('#f7f7f5'),
    link: hex('#3d3d3a'),
    selection: LIGHT_SELECTION,
    hover: faded(LIGHT_SELECTION, 0.45),
    unknown: hex('#a3a3a0'),
    label: hex('#1f1f1d'),
  },
  dark: {
    background: hex('#17161a'),
    link: hex('#c9c7d1'),
    selection: DARK_SELECTION,
    hover: faded(DARK_SELECTION, 0.5),
    unknown: hex('#6b6a72'),
    label: hex('#ececf1'),
  },
};

/** RGBA8 with red in the low byte. */
export function packRgba([r, g, b, a]: Rgba): number {
  return (
    (Math.round(r * 255) | (Math.round(g * 255) << 8) | (Math.round(b * 255) << 16) | (Math.round(a * 255) << 24)) >>> 0
  );
}
