// Layout controls on the GPU layout. Needs a WebGPU adapter, so it runs under
// `npm run check:headed` and skips elsewhere.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const PANGENOME = fileURLToPath(new URL('../../../samples/brca2-cactus.gfa', import.meta.url));

async function open(page: Page): Promise<void> {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto('/');
  await expect(page.getByTestId('status-renderer')).not.toHaveAttribute('data-renderer', 'detecting');
  const renderer = await page.getByTestId('status-renderer').getAttribute('data-renderer');
  test.skip(renderer !== 'webgpu', 'needs a WebGPU adapter (npm run check:headed)');
  test.skip(!existsSync(PANGENOME), 'run `npm run samples` first');
  await page.getByTestId('open-input').setInputFiles(PANGENOME);
}

test('pauses and resumes the layout', async ({ page }) => {
  await open(page);
  await page.getByTestId('layout-quality').selectOption('best');
  const status = page.getByTestId('status-layout');
  await expect(status).toHaveAttribute('data-state', 'running');
  await page.getByTestId('layout-pause').click();
  await expect(status).toHaveAttribute('data-state', 'paused');
  const text = await status.textContent();
  await page.waitForTimeout(1000);
  expect(await status.textContent()).toBe(text);
  await page.getByTestId('layout-pause').click();
  await expect(status).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
});

test('restarts with a new seed or a typed one', async ({ page }) => {
  await open(page);
  const status = page.getByTestId('status-layout');
  const seed = page.getByTestId('layout-seed');
  await expect(status).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
  await expect(seed).toHaveValue('1');
  await page.getByTestId('layout-restart').click();
  await expect(seed).not.toHaveValue('1');
  await expect(status).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
  await seed.fill('42');
  await seed.press('Enter');
  await expect(seed).toHaveValue('42');
  await expect(status).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
  await seed.fill('not a seed');
  await seed.press('Enter');
  await expect(seed).toHaveValue('42');
});
