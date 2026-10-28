// The paths panel: listing, highlighting in each path's colour and stepping.

import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { pathColor } from '../../src/engine/style/colors';
import {
  appState,
  backend,
  failOnPageError,
  gotoApp,
  near,
  openSettled,
  ribbonColor,
  repo,
  segmentsOnScreen,
  showTab,
  skipUnlessBackend,
  storeAction,
} from './helpers';

const rgb = (color: number) => [color & 0xff, (color >>> 8) & 0xff, (color >>> 16) & 0xff];
const NO_PATH = [190, 190, 190];

/** Highlighting and finding need the graph drawn, not its layout settled. */
async function openLoaded(page: Page, path: string): Promise<void> {
  failOnPageError(page);
  await gotoApp(page);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await skipUnlessBackend(page);
  await page.getByTestId('open-input').setInputFiles(path);
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', /running|done/, { timeout: 60_000 });
}

/** Ids of the segments the path colour mode colours. */
function colouredSegments(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    type State = { pathColors: Uint32Array | undefined };
    const store = (window as unknown as { grapeTest: { store: { getState(): State } } }).grapeTest.store;
    return Array.from(store.getState().pathColors ?? [])
      .map((c, s) => (c === 0 ? -1 : s))
      .filter((s) => s >= 0);
  });
}

/** Ids of the named segments, found the way the Find tab finds them. */
async function idsOf(page: Page, names: string[]): Promise<number[]> {
  await storeAction(page, 'find', names.join(','), false);
  // A real graph's layout keeps the main thread busy on a software GPU.
  await expect.poll(async () => (await appState(page)).selection.count, { timeout: 30_000 }).toBe(new Set(names).size);
  return page.evaluate(() => {
    type State = { selection: { bits: Uint32Array } };
    const store = (window as unknown as { grapeTest: { store: { getState(): State } } }).grapeTest.store;
    const ids: number[] = [];
    store.getState().selection.bits.forEach((word, w) => {
      for (let b = 0; b < 32; b++) if ((word >>> b) & 1) ids.push(w * 32 + b);
    });
    return ids;
  });
}

/** Segment names of the `k`th P or W line of a GFA file. */
function pathNames(text: string, k: number): string[] {
  const line = text.split('\n').filter((l) => l.startsWith('P\t') || l.startsWith('W\t'))[k] ?? '';
  const fields = line.split('\t');
  if (line.startsWith('P\t')) return (fields[2] ?? '').split(',').map((s) => s.slice(0, -1));
  return (fields[6] ?? '').split(/[<>]/).filter((s) => s !== '');
}

test('paths and walks list with their lengths and highlight in their own colour', async ({ page }) => {
  await openSettled(page, repo('testdata/paths.gfa'));
  await showTab(page, 'paths');
  await expect(page.getByTestId('paths').locator('tbody tr')).toHaveCount(3);
  await expect(page.getByTestId('path-0')).toContainText('p1');
  await expect(page.getByTestId('path-0')).toContainText('11 bp');

  await showTab(page, 'display');
  await page.getByTestId('dim-unselected').uncheck();
  const segments = await segmentsOnScreen(page, 3);
  await showTab(page, 'paths');
  // The second walk visits s11 and s13 only.
  await page.getByTestId('path-highlight-2').check();
  await expect(page.getByTestId('paths-clear')).toBeVisible();
  await expect.poll(() => colouredSegments(page)).toEqual([0, 2]);
  for (const [segment, at] of segments) {
    const want = segment === 1 ? NO_PATH : rgb(pathColor(2));
    const got = await ribbonColor(page, at.x, at.y);
    expect(near(got, want), `segment ${segment}: ${got.join()}`).toBe(true);
  }
  await page.getByTestId('paths-clear').click();
  await expect.poll(() => colouredSegments(page)).toEqual([]);
});

test('stepping selects each step in turn', async ({ page }) => {
  await openSettled(page, repo('testdata/paths.gfa'));
  await showTab(page, 'paths');
  await page.getByTestId('path-step-0').click();
  await expect(page.getByTestId('step-position')).toHaveText('Step 1 of 3 (+)');
  await expect.poll(async () => (await appState(page)).selection.single).toBe(0);
  await page.getByTestId('step-next').click();
  await expect(page.getByTestId('step-position')).toHaveText('Step 2 of 3 (−)');
  await expect.poll(async () => (await appState(page)).selection.single).toBe(1);
  await expect(page.getByTestId('step-previous')).toBeEnabled();
});

const REAL = [
  { name: 'SPAdes', file: 'web/public/examples/acacia-mitochondrion-spades.gfa.gz', path: 4 },
  { name: 'minigraph', file: 'samples/human-100-genes-walks.gfa.gz', path: 7 },
];

for (const { name, file, path } of REAL) {
  test(`highlighting colours exactly a path's segments on a ${name} graph`, async ({ page }) => {
    test.skip(!existsSync(repo(file)), `needs ${file} (npm run samples)`);
    // The colour table is the store's, whichever backend draws it; software WebGL2 takes minutes on this graph.
    test.skip(file.startsWith('samples/') && backend() === 'webgl2', 'checked on the WebGPU project');
    test.setTimeout(180_000);
    await openLoaded(page, repo(file));
    const expected = pathNames(gunzipSync(readFileSync(repo(file))).toString('utf8'), path);
    expect(expected.length).toBeGreaterThan(1);
    const ids = await idsOf(page, expected);
    await storeAction(page, 'toggleHighlight', path);
    await expect.poll(() => colouredSegments(page), { timeout: 30_000 }).toEqual(ids);
  });
}
