// Shift-drag selects every segment whose ribbon touches the box.

import { expect, type Page, test } from '@playwright/test';
import { appState, openSettled, repo, segmentsOnScreen } from './helpers';

async function shiftDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2);
  await expect(page.getByTestId('rubber-band')).toBeVisible();
  await page.mouse.move(to.x, to.y);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.getByTestId('rubber-band')).toBeHidden();
}

test('a box around the whole graph selects every segment', async ({ page }) => {
  await openSettled(page, repo('testdata/tangle.gfa'));
  const segments = Number((await page.getByTestId('stat-segments').textContent())?.replace(/\D/g, ''));
  const box = await page.getByTestId('engine-canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await shiftDrag(page, { x: box.x + 340, y: box.y + 45 }, { x: box.x + box.width - 5, y: box.y + box.height - 30 });
  await expect.poll(async () => (await appState(page)).selection.count).toBe(segments);
});

test('a small box selects the segment under it and adds to the selection', async ({ page }) => {
  await openSettled(page, repo('testdata/two_components.gfa'));
  // Left of where the info panel opens on the first selection.
  const segments = [...(await segmentsOnScreen(page, 20)).entries()].filter(([, at]) => at.x < 800);
  const [[a, at] = [], [b, bt] = []] = segments;
  if (a === undefined || b === undefined || !at || !bt) throw new Error('fewer than two segments on screen');
  await shiftDrag(page, { x: at.x - 6, y: at.y - 6 }, { x: at.x + 6, y: at.y + 6 });
  await expect.poll(async () => (await appState(page)).selection.count).toBeGreaterThanOrEqual(1);
  const first = (await appState(page)).selection.count;
  await shiftDrag(page, { x: bt.x - 6, y: bt.y - 6 }, { x: bt.x + 6, y: bt.y + 6 });
  await expect.poll(async () => (await appState(page)).selection.count).toBeGreaterThan(first);
});
