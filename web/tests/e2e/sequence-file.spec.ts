// Sequences from a separate FASTA file, for graphs saved without them (ABySS style).

import { expect, test } from '@playwright/test';
import { openSettled, repo } from './helpers';

test('a FASTA file gives a sequence-less graph its sequences', async ({ page }) => {
  await openSettled(page, repo('testdata/abyss.gfa'));
  await expect(page.getByTestId('sequence-file')).toContainText('This file has no sequences.');
  await page.getByTestId('add-sequences-input').setInputFiles(repo('testdata/abyss.fa'));
  await expect(page.getByTestId('sequences-added')).toHaveText('2 sequences from abyss.fa.');
  await expect(page.getByTestId('stat-gc')).toHaveText('57.1%');

  await page.evaluate(() => {
    type Store = { getState(): { select(s: Uint32Array, mode: string): void } };
    (window as unknown as { grapeTest: { store: Store } }).grapeTest.store
      .getState()
      .select(Uint32Array.of(0), 'replace');
  });
  const panel = page.getByTestId('info-panel');
  await expect(panel.getByTestId('info-sequence')).toHaveText('ACGTACGT');
  await expect(panel.getByTestId('info-gc')).toHaveText('50.0%');
});
