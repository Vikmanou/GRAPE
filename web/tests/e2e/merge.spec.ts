// Merging simple chains, and saving the merged graph as Bandage saves GFA.

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openSettled, repo } from './helpers';

test('a linear chain merges into one segment and saves as GFA', async ({ page }) => {
  await openSettled(page, repo('testdata/linear.gfa'));
  await page.getByTestId('merge-chains').check();
  await expect(page.getByTestId('merged-chains')).toHaveText('1 chain merged.');
  await expect(page.getByTestId('status-segments')).toHaveText('1 segments');
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done', { timeout: 60_000 });

  await page.evaluate(() => {
    type Store = { getState(): { select(s: Uint32Array, mode: string): void } };
    (window as unknown as { grapeTest: { store: Store } }).grapeTest.store
      .getState()
      .select(Uint32Array.of(0), 'replace');
  });
  const panel = page.getByTestId('info-panel');
  await expect(panel.getByTestId('info-name')).toHaveText('1_2_3');
  await expect(panel.getByTestId('info-length')).toHaveText('30 bp');
  await expect(panel.getByTestId('info-sequence')).toHaveText('ACGTACGTACGGGCCCAATTTTAAAACCCC');

  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('save-merged-gfa').click()]);
  expect(file.suggestedFilename()).toBe('linear.merged.gfa');
  // KC because the last segment with a depth used KC; (10 × 10 + 20 × 8 + 10 × 12) / 30 × 30 rounds to 380.
  expect(readFileSync(await file.path(), 'utf8')).toBe('S\t1_2_3\tACGTACGTACGGGCCCAATTTTAAAACCCC\tLN:i:30\tKC:i:380\n');

  await page.getByTestId('merge-chains').uncheck();
  await expect(page.getByTestId('status-segments')).toHaveText('3 segments');
});
