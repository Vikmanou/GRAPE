// The top bar's menus act as one group: one open at a time, closed by a
// press outside or by Escape.

import { expect, test } from '@playwright/test';
import { openSettled, repo } from './helpers';

test('top bar menus close each other, on a press outside and on Escape', async ({ page }) => {
  await openSettled(page, repo('testdata/tangle.gfa'));
  const exportMenu = page.getByTestId('export-menu');
  const share = page.getByTestId('share-menu');
  const examples = page.getByTestId('open-menu');

  await exportMenu.locator('summary').click();
  await expect(exportMenu).toHaveAttribute('open', '');
  await share.locator('summary').click();
  await expect(share).toHaveAttribute('open', '');
  await expect(exportMenu).not.toHaveAttribute('open');

  await page.getByTestId('engine-canvas').click({ position: { x: 600, y: 400 } });
  await expect(share).not.toHaveAttribute('open');

  await examples.locator('summary').click();
  await expect(examples).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(examples).not.toHaveAttribute('open');
  await expect(examples.locator('summary')).toBeFocused();

  // A press inside the open menu keeps it open.
  await share.locator('summary').click();
  await share.locator('p').first().hover();
  await page.mouse.down();
  await page.mouse.up();
  await expect(share).toHaveAttribute('open', '');
});
