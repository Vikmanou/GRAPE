// Keyboard shortcuts and the overlay listing them. Needs a WebGPU adapter, so
// it runs under `npm run check:headed` and skips elsewhere.

import { expect, test } from '@playwright/test';
import { appState, openSettled, repo } from './helpers';

test('the overlay lists the shortcuts and Escape closes it', async ({ page }) => {
  await openSettled(page, repo('testdata/tangle.gfa'));
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcuts')).toContainText('Fit the graph');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('shortcuts')).toBeHidden();
  await page.getByTestId('help').click();
  await expect(page.getByTestId('shortcuts')).toBeVisible();
});

test('find, invert, clear, panels and fit from the keyboard', async ({ page }) => {
  await openSettled(page, repo('testdata/tangle.gfa'));
  await expect.poll(async () => (await appState(page)).zoom).toBeDefined();
  const fitted = (await appState(page)).zoom ?? 0;

  await page.keyboard.press('/');
  await expect(page.getByTestId('find-input')).toBeFocused();
  await page.keyboard.type('a');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await appState(page)).selection.count).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('find-input')).not.toBeFocused();

  await page.keyboard.press('i');
  await expect.poll(async () => (await appState(page)).selection.count).toBe(6);
  await page.keyboard.press(']');
  await expect(page.getByTestId('info-panel')).toBeHidden();
  await page.keyboard.press(']');
  await expect(page.getByTestId('info-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await appState(page)).selection.count).toBe(0);

  await page.keyboard.press('[');
  await expect(page.getByTestId('sidebar')).toBeHidden();
  await page.keyboard.press('[');
  await expect(page.getByTestId('sidebar')).toBeVisible();

  await page.keyboard.press('+');
  await expect.poll(async () => (await appState(page)).zoom).toBeGreaterThan(fitted);
  await page.keyboard.press('f');
  await expect.poll(async () => (await appState(page)).zoom).toBeCloseTo(fitted, 6);
});
