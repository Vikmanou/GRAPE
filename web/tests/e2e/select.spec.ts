// Selecting with the pointer. Needs a WebGPU adapter, so it runs under
// `npm run check:headed` and skips elsewhere.

import { expect, test } from '@playwright/test';
import { appState, openSettled, repo, segmentsOnScreen } from './helpers';

test('click selects, shift-click adds and removes, a click on nothing clears', async ({ page }) => {
  await openSettled(page, repo('testdata/two_components.gfa'));
  const segments = [...(await segmentsOnScreen(page, 2)).entries()];
  const [[a, at] = [], [b, bt] = []] = segments;
  if (a === undefined || b === undefined || !at || !bt) throw new Error('fewer than two segments on screen');

  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await appState(page)).selection).toEqual({ count: 1, single: a });
  await expect(page.getByTestId('info-panel')).toBeVisible();

  await page.keyboard.down('Shift');
  await page.mouse.click(bt.x, bt.y);
  await expect.poll(async () => (await appState(page)).selection.count).toBe(2);
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await appState(page)).selection).toEqual({ count: 1, single: b });

  await page.mouse.click(5, 300);
  await expect.poll(async () => (await appState(page)).selection.count).toBe(0);
  await expect(page.getByTestId('info-panel')).toBeHidden();
});

test('hovering a segment marks it', async ({ page }) => {
  await openSettled(page, repo('testdata/tangle.gfa'));
  const [[segment, at] = []] = [...(await segmentsOnScreen(page, 1)).entries()];
  if (segment === undefined || !at) throw new Error('no segment on screen');
  await page.mouse.move(at.x, at.y);
  await expect.poll(async () => (await appState(page)).hovered).toBe(segment);
  await expect(page.getByTestId('engine-canvas')).toHaveCSS('cursor', 'pointer');
});
