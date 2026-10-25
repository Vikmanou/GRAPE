// GPU kernels against CPU references. Needs a WebGPU adapter, so it runs
// under `npm run check:headed` and skips elsewhere.

import { expect, test } from '@playwright/test';

test('layout kernels match their CPU references', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/tests/gpu/index.html');
  await expect(page.locator('body')).toHaveAttribute('data-results', /./, { timeout: 100_000 });
  const results = JSON.parse((await page.locator('body').getAttribute('data-results')) ?? '{}') as Record<
    string,
    string
  >;
  test.skip(results.webgpu === 'none', 'needs a WebGPU adapter (npm run check:headed)');
  for (const [name, result] of Object.entries(results)) expect(result, name).toBe('ok');
  expect(Object.keys(results).length).toBeGreaterThan(0);
});
