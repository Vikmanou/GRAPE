// The empty state offers a file, a URL and the examples with their sizes.

import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers';

test('a pasted text that is not a URL is refused with a message', async ({ page }) => {
  await gotoApp(page);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('empty-state').getByTestId('example-mitochondrion')).toContainText('244 KB');
  await page.getByTestId('empty-url-input').fill('not a url');
  await page.getByTestId('empty-url-submit').click();
  await expect(page.getByTestId('toasts')).toContainText('That is not a URL');
});
