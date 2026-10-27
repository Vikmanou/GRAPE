// Builds the label font atlas in web/public/fonts: a multi-channel signed
// distance field of JetBrains Mono Regular (SIL OFL 1.1) for ASCII 32 to
// 126, and its glyph metrics. Run once; the output is committed.
//
// Usage: npm run font-atlas

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root } from './lib.mjs';

const RELEASE = 'https://raw.githubusercontent.com/JetBrains/JetBrainsMono/v2.304';
const FONT_SHA256 = 'a0bf60ef0f83c5ed4d7a75d45838548b1f6873372dfac88f71804491898d138f';
const CHARSET = String.fromCharCode(...Array.from({ length: 95 }, (_, i) => 32 + i));
const out = join(root, 'web', 'public', 'fonts');

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const font = await fetchBytes(`${RELEASE}/fonts/ttf/JetBrainsMono-Regular.ttf`);
const sha = createHash('sha256').update(font).digest('hex');
if (sha !== FONT_SHA256) throw new Error(`font checksum ${sha} is not the pinned ${FONT_SHA256}`);
const fontPath = join(tmpdir(), 'grape-label-font.ttf');
writeFileSync(fontPath, font);

const generateBMFont = createRequire(import.meta.url)('msdf-bmfont-xml');
const options = {
  outputType: 'json',
  filename: 'label-atlas',
  charset: CHARSET,
  fontSize: 42,
  distanceRange: 4,
  fieldType: 'msdf',
  textureSize: [512, 512],
  smartSize: true,
  pot: true,
};
const [textures, bmfont] = await new Promise((resolve, reject) => {
  generateBMFont(fontPath, options, (error, textures, bmfont) => {
    if (error) reject(error);
    else resolve([textures, bmfont]);
  });
});
if (textures.length !== 1) throw new Error(`expected one atlas page, got ${textures.length}`);

// Only what the label layout reads, in web/src/engine/text/Atlas.ts's shape.
const data = JSON.parse(bmfont.data);
const atlas = {
  font: 'JetBrains Mono Regular 2.304',
  size: data.info.size,
  lineHeight: data.common.lineHeight,
  base: data.common.base,
  distanceRange: data.distanceField.distanceRange,
  width: data.common.scaleW,
  height: data.common.scaleH,
  // `code, x, y, width, height, xoffset, yoffset, xadvance` per glyph.
  glyphs: data.chars.map((c) => [c.id, c.x, c.y, c.width, c.height, c.xoffset, c.yoffset, c.xadvance]),
};
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'label-atlas.png'), textures[0].texture);
writeFileSync(join(out, 'label-atlas.json'), `${JSON.stringify(atlas)}\n`);
writeFileSync(join(out, 'OFL.txt'), await fetchBytes(`${RELEASE}/OFL.txt`));
console.log(`wrote ${atlas.glyphs.length} glyphs, ${atlas.width}x${atlas.height}, to web/public/fonts`);
