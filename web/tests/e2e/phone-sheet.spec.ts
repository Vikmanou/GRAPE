// On a phone the sidebar is a short sheet and the graph keeps most of the screen.

import { expect, test } from '@playwright/test';
import { openSettled, repo } from './helpers';

test.use({ viewport: { width: 390, height: 844 } });

test('the sidebar sheet leaves the graph at least half the height', async ({ page }) => {
  await openSettled(page, repo('testdata/tangle.gfa'));
  await page.setViewportSize({ width: 390, height: 844 });
  const sheet = await page.getByTestId('sidebar').boundingBox();
  if (!sheet) throw new Error('no sidebar');
  expect(sheet.height).toBeLessThanOrEqual(844 * 0.42);
  await expect(page.getByTestId('welcome').locator('ul')).toBeHidden();
});
