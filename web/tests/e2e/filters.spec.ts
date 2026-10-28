// Filters hide segments, and the links that touch them, without a new layout.

import { expect, type Page, test } from '@playwright/test';
import { near, openSettled, ribbonColor, repo, segmentsOnScreen, showTab, storeAction } from './helpers';

async function background(page: Page): Promise<number[]> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor.match(/\d+/g)?.map(Number) ?? []);
}

test('neighbourhood, depth and size filters hide segments and clear at once', async ({ page }) => {
  // 1 - 2 - 3 with depths 10, 20 and 10.
  await openSettled(page, repo('testdata/linear.gfa'));
  await showTab(page, 'display');
  await page.getByTestId('dim-unselected').uncheck();
  await page.evaluate(() => {
    type Store = { getState(): { select(s: Uint32Array, mode: string): void } };
    const store = (window as unknown as { grapeTest: { store: Store } }).grapeTest.store;
    store.getState().select(Uint32Array.of(0), 'replace');
  });
  // The info panel would cover part of the graph.
  await expect(page.getByTestId('info-panel')).toBeVisible();
  await storeAction(page, 'toggleInfo');
  await expect(page.getByTestId('info-panel')).toBeHidden();
  const segments = await segmentsOnScreen(page, 3);
  const at = (segment: number) => segments.get(segment) ?? { x: 0, y: 0 };
  const status = page.getByTestId('status-segments');
  const empty = await background(page);

  await page.getByTestId('filter-neighbourhood').click();
  await expect(page.getByTestId('filter-neighbourhood')).toBeChecked();
  await page.getByTestId('filter-steps').fill('0');
  await expect(status).toHaveText('1 of 3 segments shown');
  await expect.poll(async () => near(await ribbonColor(page, at(2).x, at(2).y), empty)).toBe(true);
  expect(near(await ribbonColor(page, at(0).x, at(0).y), empty)).toBe(false);
  await page.getByTestId('filter-steps').fill('1');
  await expect(status).toHaveText('2 of 3 segments shown');
  await page.getByTestId('filter-neighbourhood').uncheck();
  await expect(status).toHaveText('3 segments');

  await page.getByTestId('filter-depth').check();
  await page.getByTestId('filter-depth-min').fill('15');
  await page.getByTestId('filter-depth-min').press('Enter');
  await expect(status).toHaveText('1 of 3 segments shown');
  await page.getByTestId('filter-min-length').fill('100');
  await page.getByTestId('filter-min-length').press('Enter');
  await expect(status).toHaveText('0 of 3 segments shown');
  await page.getByTestId('filter-clear').click();
  await expect(status).toHaveText('3 segments');
  await expect.poll(async () => near(await ribbonColor(page, at(2).x, at(2).y), empty)).toBe(false);
});
