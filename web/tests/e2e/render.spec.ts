// WebGPU rendering checks. Headless Chromium has no adapter, so these run
// under `npm run check:headed` and skip elsewhere.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const repo = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const BACTERIAL = repo('samples/bacterial-spades.gfa');

async function start(page: Page): Promise<string[]> {
  const gpuErrors: string[] = [];
  page.on('console', (message) => {
    if (message.text().startsWith('GPU error')) gpuErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/');
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  // Detection can finish after the core is ready, especially on a busy GPU.
  await expect(page.getByTestId('status-renderer')).not.toHaveAttribute('data-renderer', 'detecting');
  const renderer = await page.getByTestId('status-renderer').getAttribute('data-renderer');
  test.skip(renderer !== 'webgpu', 'needs a WebGPU adapter (npm run check:headed)');
  return gpuErrors;
}

async function open(page: Page, path: string): Promise<void> {
  await page.getByTestId('open-input').setInputFiles(path);
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
}

/** Share of canvas pixels that differ from the background, read from a screenshot. */
async function inkedFraction(page: Page): Promise<number> {
  const png = (await page.getByTestId('engine-canvas').screenshot()).toString('base64');
  return page.evaluate(async (data) => {
    const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
    const image = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    const [r, g, b] = [pixels[0] ?? 0, pixels[1] ?? 0, pixels[2] ?? 0];
    let inked = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const d =
        Math.abs((pixels[i] ?? 0) - r) + Math.abs((pixels[i + 1] ?? 0) - g) + Math.abs((pixels[i + 2] ?? 0) - b);
      if (d > 30) inked++;
    }
    return inked / (pixels.length / 4);
  }, png);
}

test('draws every test graph without GPU errors', async ({ page }) => {
  const gpuErrors = await start(page);
  for (const name of ['linear.gfa', 'circle.gfa', 'tangle.gfa', 'self_loop.gfa', 'palindrome.gfa', 'bubble.fastg']) {
    await open(page, repo(`testdata/${name}`));
    await page.waitForTimeout(200);
    expect(await inkedFraction(page), name).toBeGreaterThan(0.003);
  }
  expect(gpuErrors).toEqual([]);
});

test('pans and zooms a bacterial graph at 60 fps', async ({ page }) => {
  test.skip(!existsSync(BACTERIAL), 'run `npm run samples` first');
  const gpuErrors = await start(page);
  await open(page, BACTERIAL);
  // Synthetic wheel and drag events every frame for three seconds, timing
  // the frames the browser actually presents.
  const fps = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const rect = canvas.getBoundingClientRect();
    const [cx, cy] = [rect.left + rect.width / 2, rect.top + rect.height / 2];
    const at = { clientX: cx, clientY: cy, bubbles: true, cancelable: true };
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerId: 1, button: 0 }));
    const times: number[] = [];
    await new Promise<void>((done) => {
      const frame = (now: number) => {
        times.push(now);
        const t = times.length;
        canvas.dispatchEvent(new WheelEvent('wheel', { ...at, deltaY: Math.sin(t / 20) * 40 }));
        canvas.dispatchEvent(
          new PointerEvent('pointermove', { ...at, pointerId: 1, clientX: cx + Math.sin(t / 15) * 200 }),
        );
        if (now - (times[0] ?? now) < 3000) requestAnimationFrame(frame);
        else done();
      };
      requestAnimationFrame(frame);
    });
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...at, pointerId: 1 }));
    const first = times[0] ?? 0;
    const last = times[times.length - 1] ?? 0;
    return ((times.length - 1) * 1000) / (last - first);
  });
  console.log(`bacterial pan and zoom: ${fps.toFixed(1)} fps`);
  await expect(page.getByTestId('status-fps')).toBeVisible();
  expect(fps).toBeGreaterThan(55);
  expect(gpuErrors).toEqual([]);
});
