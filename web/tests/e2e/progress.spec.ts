// The strip under the top bar shows what is running and lets a task be paused or cancelled.

import { expect, test } from '@playwright/test';
import { failOnPageError, gotoApp, repo, skipUnlessBackend } from './helpers';

test('a layout in progress shows a bar and a chip that pauses and resumes it', async ({ page }) => {
  failOnPageError(page);
  await page.setViewportSize({ width: 1200, height: 750 });
  await gotoApp(page);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await skipUnlessBackend(page);
  await page.getByTestId('open-input').setInputFiles(repo('web/public/examples/lpa-13-haplotypes.gfa.gz'));
  const strip = page.getByTestId('progress');
  await expect(strip).toBeVisible();
  const chip = page.getByTestId('progress-layout');
  await expect(chip).toContainText(/Laying out/);
  await page.getByTestId('progress-pause').click();
  await expect(chip).toContainText('Layout paused');
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'paused');
  await page.getByTestId('progress-pause').click();
  await expect(chip).toContainText('Laying out');
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
  await expect(strip).toBeHidden();
});
