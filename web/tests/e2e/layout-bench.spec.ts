// Run through scripts/bench-layout.mjs, which sets GRAPE_LAYOUT_BENCH to a JSON
// job: graphs to lay out on the GPU, where to write their positions and
// timings, and where to put a screenshot of each.

import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { memoryMb, panAndZoom, zoomIn } from './benchHelpers';

interface Job {
  files: string[];
  out: string;
  screenshots: string;
}

const job = JSON.parse(process.env.GRAPE_LAYOUT_BENCH ?? 'null') as Job | null;
const SETTLE_MS = 30 * 60_000;

async function openGraph(page: Page, path: string): Promise<void> {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/');
  // A page loaded right after a large graph can take a while to come up.
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await expect(page.getByTestId('status-renderer')).toHaveAttribute('data-renderer', 'webgpu');
  await page.getByTestId('open-input').setInputFiles(path);
  const settled = page.locator('[data-testid="status-layout"][data-state="done"], [data-testid="unsupported"]');
  await expect(settled).toBeVisible({ timeout: SETTLE_MS });
  const unsupported = page.getByTestId('unsupported');
  if (await unsupported.isVisible()) throw new Error(`no layout: ${await unsupported.textContent()}`);
  await page.waitForFunction(() => (window as { grapeLayout?: unknown }).grapeLayout !== undefined, undefined, {
    timeout: SETTLE_MS,
  });
}

test.describe('layout benchmark', () => {
  test.skip(!job, 'run through scripts/bench-layout.mjs');
  test.setTimeout(2 * SETTLE_MS);

  test('adapter', async ({ page }) => {
    await page.goto('/');
    const info = await page.evaluate(async () => {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      return adapter ? `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`.trim() : '';
    });
    writeFileSync(join(job?.out ?? '.', 'adapter.txt'), info);
  });

  for (const path of job?.files ?? []) {
    test(path, async ({ page }) => {
      if (!job) return;
      const name = basename(path);
      await openGraph(page, path);
      const status = page.getByTestId('status-layout');
      const result: Record<string, number | string | undefined> = {
        parseMs: Number(await page.getByTestId('format').getAttribute('data-parse-ms')),
        settledMs: Number(await status.getAttribute('data-ms')),
        usableMs: Number(await status.getAttribute('data-usable-ms')),
        tabMb: memoryMb()?.tab,
        gpuProcessMb: memoryMb()?.gpu,
      };
      const positions = await page.evaluate(() => {
        const layout = (window as unknown as { grapeLayout: { positions: Float32Array } }).grapeLayout;
        const bytes = new Uint8Array(layout.positions.buffer, layout.positions.byteOffset, layout.positions.byteLength);
        let text = '';
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(text);
      });
      writeFileSync(join(job.out, `${name}.gpu.f32`), Buffer.from(positions, 'base64'));

      await page.screenshot({ path: join(job.screenshots, `${name}.png`) });
      result.fpsZoomedOut = await panAndZoom(page);
      await zoomIn(page, 30);
      result.fpsZoomedIn = await panAndZoom(page);
      writeFileSync(join(job.out, `${name}.json`), JSON.stringify(result));
    });
  }
});
