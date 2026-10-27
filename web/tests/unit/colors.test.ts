import { describe, expect, it } from 'vitest';
import type { SegmentData } from '../../src/engine/core/backend';
import {
  type ColorStyle,
  goldenHue,
  NO_TAG_COLOR,
  rgba8,
  segmentColor,
  tagColor,
  UNIFORM_COLOR,
} from '../../src/engine/style/colors';
import { ramp, rampColor } from '../../src/engine/style/ramps';
import { rangeFraction } from '../../src/engine/style/scales';
import { depthWidth, linkFade, RIBBON_WIDTH } from '../../src/engine/style/widths';

const tags = (pairs: [number, number][]) => ({
  segments: Uint32Array.from(pairs.map((p) => p[0])),
  colors: Uint32Array.from(pairs.map((p) => p[1])),
});

const RED = rgba8(255, 0, 0);
const BLUE = rgba8(0, 0, 255);

const data: SegmentData = {
  lengths: Uint32Array.from([10, 1000, 100]),
  components: Uint32Array.from([0, 0, 1]),
  depth: Float32Array.from([5, NaN, 50]),
  gc: Float32Array.from([0.5, 0.25, NaN]),
  tagColors: tags([[0, RED]]),
  tagColors2: tags([
    [0, BLUE],
    [1, BLUE],
  ]),
};

const style = (mode: ColorStyle['mode'], scale: 'linear' | 'log' = 'linear', min = 0, max = 100): ColorStyle => ({
  mode,
  range: { scale, min, max },
  seed: 1,
  unknown: rgba8(128, 128, 128),
});

describe('ramp', () => {
  it('runs from viridis purple to yellow', () => {
    expect(ramp.length).toBe(256);
    expect(ramp[0]).toBe(rgba8(0x44, 0x01, 0x54));
    expect(ramp[255]).toBe(rgba8(0xfd, 0xe7, 0x25));
    expect(rampColor(1)).toBe(ramp[255]);
    expect(rampColor(0.5)).toBe(ramp[128]);
  });
});

describe('scales', () => {
  it('maps linear and log ranges and clamps', () => {
    expect(rangeFraction(50, { scale: 'linear', min: 0, max: 100 })).toBe(0.5);
    expect(rangeFraction(500, { scale: 'linear', min: 0, max: 100 })).toBe(1);
    expect(rangeFraction(10, { scale: 'log', min: 1, max: 100 })).toBeCloseTo(0.5);
    expect(rangeFraction(0, { scale: 'log', min: 1, max: 100 })).toBe(0);
    expect(rangeFraction(NaN, { scale: 'linear', min: 0, max: 1 })).toBeNaN();
    expect(rangeFraction(3, { scale: 'linear', min: 2, max: 2 })).toBe(0);
  });
});

describe('widths', () => {
  it("follows Bandage's getNodeWidth within the spec's clamp", () => {
    expect(depthWidth(10, 10)).toBe(RIBBON_WIDTH);
    expect(depthWidth(40, 10)).toBeCloseTo(RIBBON_WIDTH * 1.5);
    expect(depthWidth(0, 10)).toBe(RIBBON_WIDTH * 0.5);
    expect(depthWidth(1e6, 10)).toBe(RIBBON_WIDTH * 4);
    expect(depthWidth(NaN, 10)).toBe(RIBBON_WIDTH);
    expect(depthWidth(5, NaN)).toBe(RIBBON_WIDTH);
  });

  it('fades links between one pixel and the full width', () => {
    expect(linkFade(3 / RIBBON_WIDTH)).toBe(1);
    expect(linkFade(1 / RIBBON_WIDTH)).toBe(0);
    expect(linkFade(5 / RIBBON_WIDTH, 9)).toBe(0.5);
  });
});

describe('segment colours', () => {
  it('steps golden hues exactly at any id', () => {
    expect(goldenHue(0, 0)).toBe(0);
    expect(goldenHue(0, 1)).toBeCloseTo(0.618034, 5);
    expect(goldenHue(0, 2 ** 20 + 1)).not.toBe(goldenHue(0, 2 ** 20));
  });

  it('colours each mode', () => {
    expect(segmentColor(style('uniform'), data, 2, 'single')).toBe(UNIFORM_COLOR);
    expect(segmentColor(style('component'), data, 0, 'single')).toBe(
      segmentColor(style('component'), data, 1, 'single'),
    );
    expect(segmentColor(style('component'), data, 0, 'single')).not.toBe(
      segmentColor(style('component'), data, 2, 'single'),
    );
    expect(segmentColor(style('random'), data, 0, 'single')).not.toBe(segmentColor(style('random'), data, 1, 'single'));
    expect(segmentColor(style('depth'), data, 2, 'single')).toBe(ramp[128]);
    expect(segmentColor(style('depth'), data, 1, 'single')).toBe(rgba8(128, 128, 128));
    expect(segmentColor(style('gc', 'linear', 0, 1), data, 1, 'single')).toBe(ramp[64]);
    expect(segmentColor(style('length', 'log', 10, 1000), data, 2, 'single')).toBe(ramp[128]);
  });

  it("falls back to the other strand's tag in single mode only", () => {
    expect(tagColor(data, 0, 'single')).toBe(RED);
    expect(tagColor(data, 1, 'single')).toBe(BLUE);
    expect(tagColor(data, 2, 'single')).toBe(NO_TAG_COLOR);
    expect(tagColor(data, 0, 'reverse')).toBe(BLUE);
    expect(tagColor(data, 1, 'forward')).toBe(NO_TAG_COLOR);
  });
});
