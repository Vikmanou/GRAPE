// Open URL downloads a graph straight from the browser and opens it; a bad
// address fails with a message.

import { expect, test } from '@playwright/test';
import { failOnPageError, gotoApp, skipUnlessBackend } from './helpers';

test('a graph opens from a URL, and a failed download says why', async ({ page, baseURL }) => {
  failOnPageError(page);
  await gotoApp(page);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await skipUnlessBackend(page);

  const open = async (url: string) => {
    await page.getByTestId('open-menu').locator('summary').click();
    await page.getByTestId('open-url-input').fill(url);
    await page.getByTestId('open-url-submit').click();
  };

  await open(`${baseURL ?? ''}/examples/acacia-chloroplast-unicycler.gfa.gz`);
  await expect(page.getByTestId('file-name')).toContainText('acacia-chloroplast-unicycler.gfa.gz');
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done', { timeout: 60_000 });

  // Nothing listens on port 9 here; the dev server would answer a missing path with the app's page.
  await open('http://127.0.0.1:9/graph.gfa');
  await expect(page.getByTestId('load-error')).toContainText('The download did not start');
});
