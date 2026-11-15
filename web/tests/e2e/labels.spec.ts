// Labels: shown, sized by their content, hidden.

import { expect, test } from '@playwright/test';
import { openSettled, repo, showDetail, showTab } from './helpers';

test('labels show every segment of a small graph and hide again', async ({ page }) => {
  await openSettled(page, repo('testdata/bubble.gfa'));
  await showTab(page, 'display');
  await page.keyboard.press('l');
  await expect(page.getByTestId('labels-show')).toBeChecked();
  await expect(page.getByTestId('labels-count')).toHaveText('4 shown');
  await page.getByTestId('label-length').check();
  await page.getByTestId('label-name').uncheck();
  await expect(page.getByTestId('labels-count')).toHaveText('4 shown');
  await showDetail(page);
  await page.getByTestId('labels-max').fill('2');
  await page.getByTestId('labels-max').press('Enter');
  await expect(page.getByTestId('labels-count')).toHaveText('2 shown');
  await page.keyboard.press('l');
  await expect(page.getByTestId('labels-count')).toBeHidden();
});

test('thin ribbons label only segments long enough to hold their label, and tell when none fit', async ({ page }) => {
  await openSettled(page, repo('testdata/bubble.gfa'));
  await showTab(page, 'display');
  await page.getByTestId('labels-show').check();
  await expect(page.getByTestId('labels-count')).toHaveText('4 shown');
  // Ribbons now count as thin, but the segments are long on screen.
  await showDetail(page);
  await page.getByTestId('labels-min-px').fill('50');
  await page.getByTestId('labels-min-px').press('Enter');
  await expect(page.getByTestId('labels-count')).toHaveText('4 shown');
  await expect(page.getByTestId('labels-hint')).toBeHidden();
  // Zoomed far out nothing fits.
  await page.mouse.move(700, 400);
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 400);
  await expect(page.getByTestId('labels-count')).toHaveText('0 shown');
  await expect(page.getByTestId('labels-hint')).toBeVisible();
});
