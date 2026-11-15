import { expect, test } from '@playwright/test';

test('loads the core in a worker and settles on a renderer', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');

  const core = page.getByTestId('status-core');
  await expect(core).toHaveAttribute('data-state', 'ready');
  await expect(core).toHaveText('Ready');
  await page.getByTestId('help').click();
  await expect(page.getByTestId('about')).toContainText(/gfa-core \d+\.\d+\.\d+ · worker round trip \d+ ms/);
  await page.getByTestId('help').click();

  const renderer = page.getByTestId('status-renderer');
  await expect(renderer).not.toHaveAttribute('data-renderer', 'detecting');
  const kind = await renderer.getAttribute('data-renderer');

  if (kind === 'webgpu') {
    await expect(page.getByTestId('engine-canvas')).toBeVisible();
    await expect(page.getByTestId('unsupported')).toHaveCount(0);
  } else if (kind === 'none') {
    await expect(page.getByTestId('unsupported')).toBeVisible();
  } else {
    expect(kind).toBe('webgl2');
    await expect(page.getByText('never uploaded')).toBeVisible();
  }

  expect(pageErrors).toEqual([]);
});
