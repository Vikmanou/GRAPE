// The spec's determinism rule: the same file, seed and settings give the same
// layout on the same machine. Needs a WebGPU adapter, so it runs under
// `npm run check:headed` and skips elsewhere.

import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { failOnPageError, repo, showTab, skipWithoutWebGpu } from './helpers';

const GRAPHS = ['testdata/tangle.gfa', 'testdata/two_components.gfa', 'samples/bacterial-spades.gfa'];

/** Waits for the next settled layout and returns an FNV-1a hash of its positions' bits. */
async function settledHash(page: Page, after: number): Promise<{ run: number; hash: string; finite: boolean }> {
  await page.waitForFunction(
    (last) => ((window as { grapeLayout?: { run: number } }).grapeLayout?.run ?? 0) > last,
    after,
    { timeout: 60_000 },
  );
  return page.evaluate(() => {
    const layout = (window as unknown as { grapeLayout: { run: number; positions: Float32Array } }).grapeLayout;
    const bits = new Uint32Array(layout.positions.buffer, layout.positions.byteOffset, layout.positions.length);
    let hash = 0x811c9dc5;
    for (const word of bits) hash = Math.imul(hash ^ word, 0x01000193) >>> 0;
    return { run: layout.run, hash: hash.toString(16), finite: layout.positions.every(Number.isFinite) };
  });
}

async function setSeed(page: Page, seed: number): Promise<void> {
  await showTab(page, 'display');
  await page.getByTestId('layout-seed').fill(String(seed));
  await page.getByTestId('layout-seed').press('Enter');
}

for (const graph of GRAPHS) {
  test(`same seed gives the same layout: ${graph}`, async ({ page }) => {
    test.skip(!existsSync(repo(graph)), 'run `npm run samples` first');
    failOnPageError(page);
    await page.goto('/');
    await skipWithoutWebGpu(page);

    await page.getByTestId('open-input').setInputFiles(repo(graph));
    const first = await settledHash(page, 0);
    await setSeed(page, 2);
    const other = await settledHash(page, first.run);
    await setSeed(page, 1);
    const again = await settledHash(page, other.run);
    expect(first.finite && other.finite && again.finite).toBe(true);
    expect(again.hash).toBe(first.hash);
    expect(other.hash).not.toBe(first.hash);
  });
}
