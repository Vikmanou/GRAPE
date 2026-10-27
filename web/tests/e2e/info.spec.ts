// The info panel for one segment and for several. Needs a WebGPU adapter, so
// it runs under `npm run check:headed` and skips elsewhere.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { appState, openSettled, repo } from './helpers';

async function select(page: Page, segments: number[]): Promise<void> {
  await page.evaluate((ids) => {
    type Store = { getState(): { select(s: Uint32Array, mode: string): void } };
    const store = (window as unknown as { grapeTest: { store: Store } }).grapeTest.store;
    store.getState().select(Uint32Array.from(ids), 'replace');
  }, segments);
}

test('one segment: its numbers, neighbours, sequence and line', async ({ page }) => {
  await openSettled(page, repo('testdata/linear.gfa'));
  // Segments get ids in the order the file names them: 1, 2, 3.
  await select(page, [1]);
  const panel = page.getByTestId('info-panel');
  await expect(panel.getByTestId('info-name')).toHaveText('2');
  await expect(panel.getByTestId('info-length')).toHaveText('8 bp');
  await expect(panel.getByTestId('info-depth')).toHaveText('20.0×');
  await expect(panel.getByTestId('info-gc')).toHaveText('75.0%');
  await expect(panel.getByTestId('info-degree')).toHaveText('1 / 1');
  await expect(panel.getByTestId('neighbours')).toContainText('1+ → 2+');
  await expect(panel.getByTestId('neighbours')).toContainText('2+ → 3+');
  await expect(panel.getByTestId('info-sequence')).toHaveText('GGGCCCAA');
  await expect(panel.getByTestId('info-raw-line')).toHaveText('S\t2\tGGGCCCAA\tDP:f:20');

  await panel.getByTestId('neighbour').filter({ hasText: '3' }).click();
  await expect(panel.getByTestId('info-name')).toHaveText('3');
  await expect.poll(async () => (await appState(page)).selection.single).toBe(2);
});

test('several segments: count, total length and weighted depth', async ({ page }) => {
  await openSettled(page, repo('testdata/linear.gfa'));
  await select(page, [0, 1, 2]);
  const panel = page.getByTestId('info-panel');
  await expect(panel.getByTestId('info-title')).toHaveText('3 segments');
  await expect(panel.getByTestId('info-total-length')).toHaveText('30 bp');
  // (10 × 10 + 8 × 20 + 12 × 10) / 30
  await expect(panel.getByTestId('info-mean-depth')).toHaveText('12.7×');
});

test('a gzipped file shows its sequence but not its line', async ({ page }) => {
  const dir = test.info().outputPath();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'linear.gfa.gz');
  writeFileSync(path, gzipSync(readFileSync(repo('testdata/linear.gfa'))));
  await openSettled(page, path);
  await select(page, [2]);
  const panel = page.getByTestId('info-panel');
  await expect(panel.getByTestId('info-sequence')).toHaveText('TTTTAAAACCCC');
  await expect(panel).toContainText('Gzipped files cannot be read at an offset');
});

test('a long sequence shows its two ends', async ({ page }) => {
  const bacterial = repo('samples/bacterial-spades.gfa');
  test.skip(!existsSync(bacterial), 'run `npm run samples` first');
  await openSettled(page, bacterial);
  // The first segment of this SPAdes graph is several kilobases long.
  await select(page, [0]);
  const sequence = page.getByTestId('info-sequence');
  await expect(sequence).toContainText('…');
  const text = (await sequence.textContent()) ?? '';
  const [head = '', tail = ''] = text.split(/ … .* … /);
  expect(head).toMatch(/^[ACGTN]{100}$/i);
  expect(tail).toMatch(/^[ACGTN]{100}$/i);
  await expect(page.getByTestId('info-raw-line')).toContainText('…');
});
