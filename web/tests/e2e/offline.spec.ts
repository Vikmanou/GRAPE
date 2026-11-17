// After one visit the site opens, and opens a file, with no network.

import { expect, test } from '@playwright/test';
import { repo } from './helpers';
import { serveBuild } from './serveBuild';

let site: Awaited<ReturnType<typeof serveBuild>>;

test.beforeAll(async () => {
  site = await serveBuild();
});

test.afterAll(() => {
  site.stop();
});

test('the site reloads and opens a file with no network after one visit', async ({ page, context }) => {
  await page.goto(site.origin);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).length > 0 && !!navigator.serviceWorker.controller))
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await page.getByTestId('open-input').setInputFiles(repo('testdata/linear.gfa'));
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
});
