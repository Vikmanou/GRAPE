// Sequences, copy and FASTA as Bandage writes them, from plain, gzipped and
// FASTG input.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { openSettled, repo } from './helpers';

const fasta = (records: [string, number, string, string][]) =>
  records
    .map(([name, length, cov, bases]) => {
      const lines = bases.match(/.{1,70}/g) ?? [''];
      return `>NODE_${name}+_length_${String(length)}_cov_${cov}\n${lines.join('\n')}\n`;
    })
    .join('');

const LINEAR = fasta([
  ['1', 10, '10', 'ACGTACGTAC'],
  ['2', 8, '20', 'GGGCCCAA'],
  ['3', 12, '10', 'TTTTAAAACCCC'],
]);
const BUBBLE = fasta([
  ['1', 8, '10', 'AAAAAAAA'],
  ['2', 6, '5', 'CCCCCC'],
  ['3', 6, '5', 'GGGGGG'],
  ['4', 7, '10', 'TTTTTTT'],
]);

/** Gzips a test file into the test's output folder. */
function gzipped(name: string): string {
  const dir = test.info().outputPath();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.gz`);
  writeFileSync(path, gzipSync(readFileSync(repo(`testdata/${name}`))));
  return path;
}

async function selectAll(page: Page): Promise<void> {
  const segments = Number((await page.getByTestId('stat-segments').textContent())?.replace(/\D/g, ''));
  await page.evaluate((n) => {
    type Store = { getState(): { select(s: Uint32Array, mode: string): void } };
    const store = (window as unknown as { grapeTest: { store: Store } }).grapeTest.store;
    store.getState().select(
      Uint32Array.from({ length: n }, (_, i) => i),
      'replace',
    );
  }, segments);
  await expect(page.getByTestId('info-title')).toHaveText(`${String(segments)} segments`);
}

async function downloadedFasta(page: Page): Promise<string> {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-fasta').click()]);
  expect(file.suggestedFilename()).toBe('selected_sequences.fasta');
  return readFileSync(await file.path(), 'utf8');
}

const cases: [string, () => string, string][] = [
  ['plain GFA', () => repo('testdata/linear.gfa'), LINEAR],
  ['gzipped GFA', () => gzipped('linear.gfa'), LINEAR],
  ['FASTG', () => repo('testdata/bubble.fastg'), BUBBLE],
  ['gzipped FASTG', () => gzipped('bubble.fastg'), BUBBLE],
  [
    'segments known only from a reverse FASTG record',
    () => repo('testdata/reverse_only.fastg'),
    fasta([
      ['1', 4, '2.5', 'ACGG'],
      ['2', 4, '3', 'ATCC'],
    ]),
  ],
  [
    'segments without sequence',
    () => repo('testdata/star_ln.gfa'),
    fasta([
      ['1', 5000, '3', 'N'.repeat(5000)],
      ['2', 100, '1', 'N'.repeat(100)],
      ['3', 0, '1', ''],
    ]),
  ],
];

for (const [label, path, expected] of cases) {
  test(`FASTA of ${label} matches Bandage`, async ({ page }) => {
    await openSettled(page, path());
    await selectAll(page);
    expect(await downloadedFasta(page)).toBe(expected);
  });
}

test('copying joins the sequences with newlines, as Bandage does', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openSettled(page, gzipped('linear.gfa'));
  await selectAll(page);
  await page.getByTestId('copy-sequence').click();
  await expect(page.getByTestId('toasts')).toContainText('Sequences copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('ACGTACGTAC\nGGGCCCAA\nTTTTAAAACCCC');
});
