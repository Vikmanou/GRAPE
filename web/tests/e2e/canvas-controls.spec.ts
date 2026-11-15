// The zoom and fit buttons, and the tooltip over a segment.

import { expect, test } from '@playwright/test';
import { appState, openSettled, repo, segmentsOnScreen } from './helpers';

test('zoom and fit buttons change the view', async ({ page }) => {
  await openSettled(page, repo('testdata/linear.gfa'));
  await page.getByTestId('fit').click();
  await page.waitForTimeout(600);
  const before = (await appState(page)).zoom ?? 0;
  await page.getByTestId('zoom-in').click();
  await expect.poll(async () => (await appState(page)).zoom ?? 0).toBeGreaterThan(before * 1.2);
  await page.getByTestId('fit').click();
  await expect.poll(async () => (await appState(page)).zoom ?? 0).toBeCloseTo(before, 1);
});

test('the pointer over a segment shows its name, length and depth', async ({ page }) => {
  await openSettled(page, repo('testdata/linear.gfa'));
  const at = (await segmentsOnScreen(page, 3)).get(1);
  if (!at) throw new Error('segment 2 is not on screen');
  await page.mouse.move(at.x, at.y);
  const tip = page.getByTestId('hover-tip');
  await expect(tip).toContainText('2');
  await expect(tip).toContainText('8 bp');
  await expect(tip).toContainText('20.0×');
});
