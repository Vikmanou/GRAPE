// Renders the app icons in web/public/icons from the owner's artwork in
// web/assets-src/GRAPE_Icon.png. The art is only scaled, never redrawn. Run
// once after the artwork changes; the output is committed.
//
// Usage: node scripts/app-icons.mjs

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { root } from './lib.mjs';

const SOURCE = join(root, 'web', 'assets-src', 'GRAPE_Icon.png');
const out = join(root, 'web', 'public', 'icons');
// The light --bg token, behind the icons that must be opaque (decisions.md, 2026-11-17).
const BACKDROP = '#f6f2e9';

// `padded` icons are drawn on the backdrop with the art inside the central 80%
// circle, the part a maskable crop keeps (https://www.w3.org/TR/appmanifest/#icon-masks);
// iOS fills transparency with black, so its icon is padded too.
const ICONS = [
  { file: 'icon-64.png', size: 64 },
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-maskable-512.png', size: 512, padded: true },
  { file: 'apple-touch-icon.png', size: 180, padded: true },
];

const { chromium } = createRequire(join(root, 'web', 'package.json'))('@playwright/test');
const browser = await chromium.launch();
const page = await browser.newPage();
const source = `data:image/png;base64,${readFileSync(SOURCE).toString('base64')}`;

const rendered = await page.evaluate(
  async ({ source, icons, backdrop }) => {
    const art = await (await fetch(source)).blob();
    const full = await createImageBitmap(art);
    const probe = new OffscreenCanvas(full.width, full.height).getContext('2d');
    probe.drawImage(full, 0, 0);
    const { data } = probe.getImageData(0, 0, full.width, full.height);
    const [cx, cy] = [full.width / 2, full.height / 2];
    let farthest = 0;
    for (let y = 0; y < full.height; y++)
      for (let x = 0; x < full.width; x++)
        if (data[(y * full.width + x) * 4 + 3] > 16)
          farthest = Math.max(farthest, Math.hypot(x + 0.5 - cx, y + 0.5 - cy));

    const results = [];
    for (const { file, size, padded } of icons) {
      // Art the size of the icon, or scaled so its farthest opaque pixel lies on the 80% circle.
      const drawn = padded ? Math.floor((size * 0.4 * full.width) / farthest) : size;
      const scaled = await createImageBitmap(art, { resizeWidth: drawn, resizeHeight: drawn, resizeQuality: 'high' });
      const canvas = new OffscreenCanvas(size, size);
      const context = canvas.getContext('2d');
      if (padded) {
        context.fillStyle = backdrop;
        context.fillRect(0, 0, size, size);
      }
      context.drawImage(scaled, (size - drawn) / 2, (size - drawn) / 2);
      const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let text = '';
      for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      results.push({ file, base64: btoa(text) });
    }
    return results;
  },
  { source, icons: ICONS, backdrop: BACKDROP },
);
await browser.close();

mkdirSync(out, { recursive: true });
for (const { file, base64 } of rendered) {
  writeFileSync(join(out, file), Buffer.from(base64, 'base64'));
  console.log(`web/public/icons/${file}`);
}
