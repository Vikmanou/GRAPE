// Narrow windows: every top-bar action stays on screen, and the sidebar and the info panel are
// bottom sheets over a graph that stays in view.

import { expect, test, type Page } from '@playwright/test';
import { failOnPageError, gotoApp, repo, segmentsOnScreen, skipUnlessBackend } from './helpers';

async function open(page: Page, width: number, height: number): Promise<void> {
  failOnPageError(page);
  await page.setViewportSize({ width, height });
  await gotoApp(page);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await skipUnlessBackend(page);
  await page.getByTestId('open-input').setInputFiles(repo('testdata/tangle.gfa'));
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
}

test('at 390 px wide every top-bar action is on screen and the page does not scroll sideways', async ({ page }) => {
  await open(page, 390, 844);
  for (const id of ['open-file', 'open-menu', 'export-menu', 'share-menu', 'theme', 'help']) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box, id).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0), `${id} ends inside the window`).toBeLessThanOrEqual(390);
    expect(box?.x ?? -1, `${id} starts inside the window`).toBeGreaterThanOrEqual(0);
  }
  const scroll = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll[0]).toBeLessThanOrEqual(scroll[1] ?? 0);
});

test('at 390 px the sidebar is a sheet under the graph and a selection swaps it for the details', async ({ page }) => {
  await open(page, 390, 844);
  const sidebar = page.getByTestId('sidebar');
  const sheet = await sidebar.boundingBox();
  expect(sheet?.width).toBe(390);
  // The graph keeps more than half of the height above the sheet.
  expect(sheet?.y ?? 0).toBeGreaterThan(844 * 0.45);

  const [first] = [...(await segmentsOnScreen(page, 1)).values()];
  if (!first) throw new Error('no segment on screen');
  await page.mouse.click(first.x, first.y);
  const info = page.getByTestId('info-panel');
  await expect(info).toBeVisible();
  await expect(sidebar).toBeHidden();
  expect((await info.boundingBox())?.width).toBe(390);

  await page.keyboard.press('Escape');
  await expect(info).toBeHidden();
  await expect(sidebar).toBeVisible();
});

test('at 1024 px the sidebar stays docked beside the graph', async ({ page }) => {
  await open(page, 1024, 768);
  const box = await page.getByTestId('sidebar').boundingBox();
  expect(box?.x).toBeLessThan(20);
  expect(box?.width).toBeLessThan(400);
});
