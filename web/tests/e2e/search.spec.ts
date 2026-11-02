// Sequence search: queries pasted or from a file, the results table and the
// bands hits draw on the ribbons.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { pathColor } from '../../src/engine/style/colors';
import { appState, near, openSettled, repo, ribbonColor, segmentsOnScreen, showTab, storeAction } from './helpers';

const GRAPH = repo('testdata/search.gfa');
const sequences = new Map(
  readFileSync(GRAPH, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('S\t'))
    .map((line) => {
      const [, name = '', bases = ''] = line.split('\t');
      return [name, bases];
    }),
);
const bases = (name: string) => sequences.get(name) ?? '';
const COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
const reverseComplement = (s: string) =>
  Array.from(s)
    .reverse()
    .map((b) => COMPLEMENT[b] ?? b)
    .join('');
const HIT_COLOR = pathColor(0);
const hitRgb = [HIT_COLOR & 0xff, (HIT_COLOR >>> 8) & 0xff, (HIT_COLOR >>> 16) & 0xff];

async function openFind(page: Page): Promise<void> {
  await openSettled(page, GRAPH);
  await showTab(page, 'find');
}

async function search(page: Page, text: string): Promise<void> {
  await page.getByTestId('search-input').fill(text);
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('search-found')).toBeVisible();
}

/** Ids of the named segments, in the graph's order of definition. */
function idOf(name: string): number {
  return Array.from(sequences.keys()).indexOf(name);
}

/** Where a segment is on screen, away from its ends. */
async function spot(page: Page, name: string): Promise<{ x: number; y: number }> {
  const found = (await segmentsOnScreen(page, sequences.size)).get(idOf(name));
  if (!found) throw new Error(`${name} is not on screen`);
  return found;
}

test('a query across a link is one hit, listed with its numbers, and its row zooms to it', async ({ page }) => {
  await openFind(page);
  await search(page, bases('a') + bases('b').slice(25));
  await expect(page.getByTestId('search-index')).toContainText('Indexed');
  const row = page.getByTestId('search-hit-0');
  await expect(row).toContainText('a+ … b+');
  await expect(row).toContainText('2 segments');
  await expect(row.locator('td').nth(3)).toHaveText('100.0%');
  await expect(row.locator('td').nth(4)).toHaveText('100.0%');
  await row.getByRole('button').click();
  await expect.poll(async () => (await appState(page)).selection.count).toBe(2);
});

test('the reverse complement finds the same segment on its other strand', async ({ page }) => {
  await openFind(page);
  await search(page, reverseComplement(bases('d')));
  const row = page.getByTestId('search-hit-0');
  await expect(row).toContainText('d−');
  await expect(row.locator('td').nth(2)).toHaveText('1–80');
});

test('a walk through a short segment takes the base the query has', async ({ page }) => {
  await openFind(page);
  await search(page, `${bases('e')}A${bases('f')}`);
  await expect(page.getByTestId('search-hit-0')).toContainText('e+ … f+');
  await expect(page.getByTestId('search-hit-0')).toContainText('3 segments');
});

test('hits colour exactly their part of the ribbon and go when asked', async ({ page }) => {
  await openFind(page);
  const whole = await spot(page, 'd');
  const before = await ribbonColor(page, whole.x, whole.y);
  await search(page, bases('d'));
  await expect.poll(() => ribbonColor(page, whole.x, whole.y).then((c) => near(c, hitRgb))).toBe(true);
  await page.getByTestId('search-show').uncheck();
  await expect.poll(() => ribbonColor(page, whole.x, whole.y).then((c) => near(c, before))).toBe(true);
  await page.getByTestId('search-show').check();
  await expect.poll(() => ribbonColor(page, whole.x, whole.y).then((c) => near(c, hitRgb))).toBe(true);
  // The first third of h leaves the middle of its ribbon as it was.
  const middle = await spot(page, 'h');
  const unhit = await ribbonColor(page, middle.x, middle.y);
  await search(page, bases('h').slice(0, 30));
  await expect(page.getByTestId('search-hit-0')).toContainText('h+');
  await expect.poll(() => ribbonColor(page, whole.x, whole.y).then((c) => near(c, before))).toBe(true);
  expect(near(await ribbonColor(page, middle.x, middle.y), unhit)).toBe(true);
});

test('a filter hides the hits of the segments it hides', async ({ page }) => {
  await openFind(page);
  const at = await spot(page, 'd');
  await search(page, bases('d'));
  await expect.poll(() => ribbonColor(page, at.x, at.y).then((c) => near(c, hitRgb))).toBe(true);
  await storeAction(page, 'setFilters', { minComponentLength: 100000 });
  await expect.poll(() => ribbonColor(page, at.x, at.y).then((c) => near(c, hitRgb))).toBe(false);
});

test('a FASTA file searches every record, which the table can pick between', async ({ page }) => {
  await openFind(page);
  const dir = test.info().outputPath();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'queries.fasta');
  writeFileSync(file, `>one first\n${bases('d')}\n>two\n${bases('c')}\n>short\nACGT\n`);
  await page.getByTestId('search-file-input').setInputFiles(file);
  await expect(page.getByTestId('search-found')).toHaveText('2 hits for 2 queries.');
  await expect(page.getByTestId('search-too-short')).toHaveText('Too short to search: short.');
  await page.getByTestId('search-query').selectOption({ label: 'two' });
  await expect(page.getByTestId('search-hits').locator('tbody tr')).toHaveCount(1);
  await expect(page.getByTestId('search-hit-1')).toContainText('c+');
});

test('protein and nothing to find are said plainly', async ({ page }) => {
  await openFind(page);
  await page.getByTestId('search-input').fill('MKVLAAGIVGLLLAQWE');
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('search-error')).toContainText('looks like protein');
  await search(page, 'GATTACAGATTACAGATTACAGATTACAGATTACA');
  await expect(page.getByTestId('search-found')).toHaveText('No hits.');
});

test('a cancelled index leaves no hits and a later search still works', async ({ page }) => {
  await openFind(page);
  await page.evaluate((query) => {
    type Actions = { runSearch(q: string): void; cancelSearch(): void };
    const store = (window as unknown as { grapeTest: { store: { getState(): Actions } } }).grapeTest.store;
    store.getState().runSearch(query);
    store.getState().cancelSearch();
  }, bases('d'));
  await expect(page.getByTestId('search-status')).not.toContainText('Indexing');
  await expect(page.getByTestId('search-results')).toHaveCount(0);
  await search(page, bases('d'));
  await expect(page.getByTestId('search-hit-0')).toContainText('d+');
});

test('merging chains forgets the hits, and the merged graph can be searched', async ({ page }) => {
  await openFind(page);
  await search(page, bases('d'));
  await storeAction(page, 'setMerged', true);
  await expect(page.getByTestId('search-results')).toHaveCount(0);
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
  await search(page, bases('h') + bases('i'));
  await expect(page.getByTestId('search-hit-0')).toContainText('h');
  await expect(page.getByTestId('search-hit-0').locator('td').nth(4)).toHaveText('100.0%');
});
