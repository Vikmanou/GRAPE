import { expect, test } from '@playwright/test';
import { failOnPageError, repo } from './helpers';

const testdata = (name: string) => repo(`testdata/${name}`);

test.beforeEach(({ page }) => {
  failOnPageError(page);
});

test('lays out each test graph in the layout worker', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  for (const name of ['linear.gfa', 'circle.gfa', 'tangle.gfa', 'self_loop.gfa', 'palindrome.gfa', 'bubble.fastg']) {
    await page.getByTestId('open-input').setInputFiles(testdata(name));
    await expect(page.getByTestId('file-name')).toContainText(name);
    await expect(page.getByTestId('status-layout'), name).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('status-layout')).toContainText('Laid out in');
  }
});
