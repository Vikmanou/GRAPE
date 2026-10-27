// The bundled examples load from the top bar and the empty state, with their credits.

import { expect, test } from '@playwright/test';
import { failOnPageError, gotoApp, skipUnlessBackend } from './helpers';

const SEGMENTS = { chloroplast: 1, mitochondrion: 161, lpa: 3751, 'human-mito': 8 };

test('each example loads from the menu and is credited', async ({ page }) => {
  test.setTimeout(120_000);
  failOnPageError(page);
  await gotoApp(page);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await skipUnlessBackend(page);
  await expect(page.getByTestId('empty-state').getByText('Anna Syme (2020)').first()).toBeVisible();
  for (const [id, segments] of Object.entries(SEGMENTS)) {
    await page.getByTestId('example-menu').locator('summary').click();
    await page.getByTestId('example-menu').getByTestId(`example-${id}`).click();
    await expect(page.getByTestId('file-name')).toContainText('.gfa.gz');
    await expect(page.getByTestId('stat-segments')).toHaveText(segments.toLocaleString('en'));
    await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
    await expect(page.getByTestId('example-menu')).not.toHaveAttribute('open');
  }
});

test('an example opens from the empty state', async ({ page }) => {
  failOnPageError(page);
  await gotoApp(page);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await skipUnlessBackend(page);
  await page.getByTestId('empty-state').getByTestId('example-human-mito').click();
  await expect(page.getByTestId('file-name')).toContainText('human-mitochondrion-minigraph.gfa.gz');
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done');
});
