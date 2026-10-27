// The bundled examples drawn by both backends from the same CPU layout match
// within a tolerance, and WebGL2's pictures match committed baselines, so CI,
// which has no WebGPU, still catches rendering regressions.

import { expect, type Browser, type Page, test } from '@playwright/test';
import { backend, failOnPageError } from './helpers';

const EXAMPLES = ['chloroplast', 'mitochondrion', 'lpa', 'human-mito'];
const VIEWPORT = { width: 1000, height: 700 };
/** The canvas without the bars and the button that brings the sidebar back. */
const CLIP = { x: 48, y: 48, width: VIEWPORT.width - 56, height: VIEWPORT.height - 84 };
/** Pixels whose channels differ by more than this in all are counted as different. */
const PIXEL_THRESHOLD = 48;
/** At most this share of the pixels may differ between backends. */
const MAX_DIFFERENT = 0.01;

async function drawn(page: Page, query: string, example: string, renderer: string): Promise<Buffer> {
  failOnPageError(page);
  await page.setViewportSize(VIEWPORT);
  await page.goto(`/?${query}`);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('status-renderer')).toHaveAttribute('data-renderer', renderer);
  await page.getByTestId('example-menu').locator('summary').click();
  await page.getByTestId(`example-${example}`).first().click();
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Hide the sidebar' }).click();
  await page.mouse.move(0, VIEWPORT.height - 10);
  await page.waitForTimeout(500);
  return page.screenshot({ clip: CLIP });
}

/** Share of pixels that differ by more than `PIXEL_THRESHOLD` summed over the channels. */
async function difference(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([first, second, threshold]) => {
      const pixels = async (data: string) => {
        const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('no 2d context');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const [p, q] = await Promise.all([pixels(first), pixels(second)]);
      let different = 0;
      for (let i = 0; i < p.length; i += 4) {
        const d = [0, 1, 2].reduce((sum, k) => sum + Math.abs((p[i + k] ?? 0) - (q[i + k] ?? 0)), 0);
        if (d > threshold) different++;
      }
      return different / (p.length / 4);
    },
    [a.toString('base64'), b.toString('base64'), PIXEL_THRESHOLD] as const,
  );
}

async function webGpuAvailable(browser: Browser): Promise<boolean> {
  const page = await browser.newPage();
  await page.goto('/');
  const status = page.getByTestId('status-renderer');
  await expect(status).not.toHaveAttribute('data-renderer', 'detecting');
  const ok = (await status.getAttribute('data-renderer')) === 'webgpu';
  await page.close();
  return ok;
}

for (const example of EXAMPLES) {
  test(`${example} looks the same on both backends`, async ({ browser }) => {
    test.setTimeout(120_000);
    test.skip(backend() !== 'webgpu', 'compares both backends once, in the webgpu project');
    test.skip(!(await webGpuAvailable(browser)), 'needs a WebGPU adapter (npm run check:headed)');
    const [gpu, gl] = [await browser.newPage(), await browser.newPage()];
    const a = await drawn(gpu, 'layout=cpu', example, 'webgpu');
    const b = await drawn(gl, 'renderer=webgl2', example, 'webgl2');
    const share = await difference(gl, a, b);
    console.log(`${example}: ${(share * 100).toFixed(3)}% of pixels differ`);
    await gpu.screenshot({ path: test.info().outputPath('webgpu.png'), clip: CLIP });
    await gl.screenshot({ path: test.info().outputPath('webgl2.png'), clip: CLIP });
    expect(share).toBeLessThan(MAX_DIFFERENT);
  });

  test(`${example} matches its WebGL2 baseline`, async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(backend() !== 'webgl2', 'WebGL2 baselines');
    await drawn(page, 'renderer=webgl2', example, 'webgl2');
    await expect(page).toHaveScreenshot(`${example}.png`, { clip: CLIP, maxDiffPixelRatio: MAX_DIFFERENT });
  });
}
