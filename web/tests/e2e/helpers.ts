// Shared by the end-to-end tests.

import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

export const repo = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

export function failOnPageError(page: Page): void {
  page.on('pageerror', (error) => {
    throw error;
  });
}

/** Skips the test unless the page picked WebGPU, which needs `npm run check:headed`. */
export async function skipWithoutWebGpu(page: Page): Promise<void> {
  // Detection can finish after the core is ready, especially on a busy GPU.
  const status = page.getByTestId('status-renderer');
  await expect(status).not.toHaveAttribute('data-renderer', 'detecting');
  const renderer = await status.getAttribute('data-renderer');
  test.skip(renderer !== 'webgpu', 'needs a WebGPU adapter (npm run check:headed)');
}

export async function showTab(page: Page, tab: 'overview' | 'display'): Promise<void> {
  await page.getByTestId(`tab-${tab}`).click();
}
