// Run through scripts/bench/compare.mjs and scripts/bench/bandage.mjs, which set
// GRAPE_COMPARE_BENCH to one run: a graph to open in a fresh browser, how long it
// may take, and what to export once it is laid out.

import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { memoryMbAsync, peakMemoryMb } from './benchHelpers';

interface Job {
  file: string;
  result: string;
  timeoutMs: number;
  /** Time a PNG export of the settled view at the canvas size. */
  png?: boolean;
  /** Where to save that PNG. */
  picture?: string;
  /** Select the first `count` segments and save their GFA to `path`. */
  selection?: { count: number; path: string };
  /** Save the GFA of the whole graph here. */
  whole?: string;
}

const job = JSON.parse(process.env.GRAPE_COMPARE_BENCH ?? 'null') as Job | null;

interface Store {
  getState(): {
    exportPng(scale: number): Promise<Blob>;
    exportGfa(scope: 'selection' | 'visible'): Promise<Blob>;
    select(segments: Uint32Array, mode: 'replace' | 'add'): void;
  };
}

test.describe('comparison run', () => {
  test.skip(!job, 'run through scripts/bench/compare.mjs');
  test.setTimeout((job?.timeoutMs ?? 0) + 5 * 60_000);

  test('open and export', async ({ page }) => {
    if (!job) return;
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
    await expect(page.getByTestId('status-renderer')).toHaveAttribute('data-renderer', 'webgpu');

    const peak = { tab: 0, gpu: 0, total: 0 };
    const sampling = { on: true };
    const sampler = (async () => {
      while (sampling.on) {
        const m = await memoryMbAsync();
        peak.tab = Math.max(peak.tab, m.tab);
        peak.gpu = Math.max(peak.gpu, m.gpu);
        peak.total = Math.max(peak.total, m.tab + m.gpu);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    })();

    // Timed in the page, from the file input's change to the layout reported
    // done, because the test's own waits poll up to a second apart.
    const DONE = '[data-testid="status-layout"][data-state="done"], [data-testid="unsupported"]';
    await page.evaluate((done) => {
      const marks: { start?: number; end?: number } = {};
      (window as unknown as { compareMarks: typeof marks }).compareMarks = marks;
      document.addEventListener('change', () => (marks.start ??= performance.now()), { capture: true });
      new MutationObserver(() => {
        if (marks.start !== undefined && marks.end === undefined && document.querySelector(done))
          marks.end = performance.now();
      }).observe(document.body, { subtree: true, childList: true, attributes: true });
    }, DONE);
    await page.getByTestId('open-input').setInputFiles(job.file);
    await expect(page.locator(DONE)).toBeVisible({ timeout: job.timeoutMs });
    const marks = await page.evaluate(
      () => (window as unknown as { compareMarks: { start?: number; end?: number } }).compareMarks,
    );
    if (marks.start === undefined || marks.end === undefined) throw new Error('the open was not timed');
    const openMs = marks.end - marks.start;
    const unsupported = page.getByTestId('unsupported');
    if (await unsupported.isVisible()) throw new Error(`no layout: ${await unsupported.textContent()}`);

    const status = page.getByTestId('status-layout');
    const result: Record<string, unknown> = {
      openMs,
      parseMs: Number(await page.getByTestId('format').getAttribute('data-parse-ms')),
      usableMs: Number(await status.getAttribute('data-usable-ms')),
      settledMs: Number(await status.getAttribute('data-ms')),
    };

    if (job.png) {
      const exported = await page.evaluate(async () => {
        const store = (window as unknown as { grapeTest: { store: Store } }).grapeTest.store;
        const t = performance.now();
        const blob = await store.getState().exportPng(1);
        const ms = performance.now() - t;
        const bitmap = await createImageBitmap(blob);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let text = '';
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { ms, width: bitmap.width, height: bitmap.height, base64: btoa(text) };
      });
      Object.assign(result, { exportMs: exported.ms, width: exported.width, height: exported.height });
      if (job.picture) writeFileSync(job.picture, Buffer.from(exported.base64, 'base64'));
    }
    sampling.on = false;
    await sampler;
    // Each process's own peak, kept by Windows, catches what sampling misses between reads.
    const os = peakMemoryMb();
    Object.assign(
      result,
      os
        ? { peakTabMb: os.tab, peakGpuMb: os.gpu, peakMb: os.tab + os.gpu, sampledPeakMb: peak.total }
        : { peakTabMb: peak.tab, peakGpuMb: peak.gpu, peakMb: peak.total },
    );

    const gfa = (scope: 'selection' | 'visible', count = 0) =>
      page.evaluate(
        async ({ scope, count }) => {
          const store = (window as unknown as { grapeTest: { store: Store } }).grapeTest.store;
          if (scope === 'selection')
            store.getState().select(
              Uint32Array.from({ length: count }, (_, i) => i),
              'replace',
            );
          return (await store.getState().exportGfa(scope)).text();
        },
        { scope, count },
      );
    if (job.selection) writeFileSync(job.selection.path, await gfa('selection', job.selection.count));
    if (job.whole) writeFileSync(job.whole, await gfa('visible'));
    writeFileSync(job.result, JSON.stringify(result));
  });
});
