// Selecting with the pointer. Needs a WebGPU adapter, so it runs under
// `npm run check:headed` and skips elsewhere.

import { expect, test } from '@playwright/test';
import { appState, openSettled, repo, segmentsOnScreen } from './helpers';

test('click selects, shift-click adds and removes, a click on nothing clears', async ({ page }) => {
  await openSettled(page, repo('testdata/two_components.gfa'));
  // Left of where the info panel opens on the first click.
  const segments = [...(await segmentsOnScreen(page, 20)).entries()].filter(([, at]) => at.x < 800);
  const [[a, at] = [], [b, bt] = []] = segments;
  if (a === undefined || b === undefined || !at || !bt) throw new Error('fewer than two segments on screen');

  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await appState(page)).selection).toEqual({ count: 1, single: a });
  await expect(page.getByTestId('info-panel')).toBeVisible();

  await page.keyboard.down('Shift');
  await page.mouse.click(bt.x, bt.y);
  await expect.poll(async () => (await appState(page)).selection.count).toBe(2);
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await appState(page)).selection).toEqual({ count: 1, single: b });

  await page.mouse.click(5, 300);
  await expect.poll(async () => (await appState(page)).selection.count).toBe(0);
  await expect(page.getByTestId('info-panel')).toBeHidden();
});

test('hovering a segment marks it', async ({ page }) => {
  await openSettled(page, repo('testdata/tangle.gfa'));
  const [[segment, at] = []] = [...(await segmentsOnScreen(page, 1)).entries()];
  if (segment === undefined || !at) throw new Error('no segment on screen');
  await page.mouse.move(at.x, at.y);
  await expect.poll(async () => (await appState(page)).hovered).toBe(segment);
  await expect(page.getByTestId('engine-canvas')).toHaveCSS('cursor', 'pointer');
});

test('components select and frame, the selection grows to its components and inverts', async ({ page }) => {
  await openSettled(page, repo('testdata/two_components.gfa'));
  const segments = Number((await page.getByTestId('stat-segments').textContent())?.replace(/\D/g, ''));
  const second = Number(
    await page.getByTestId('components').locator('tbody tr').nth(1).locator('td').nth(1).textContent(),
  );
  await expect.poll(async () => (await appState(page)).zoom).toBeDefined();
  const fitted = (await appState(page)).zoom ?? 0;

  await page.getByTestId('component-2').click();
  await expect.poll(async () => (await appState(page)).selection.count).toBe(second);
  await expect.poll(async () => (await appState(page)).zoom).toBeGreaterThan(fitted);

  await page.getByTestId('invert-selection').click();
  await expect.poll(async () => (await appState(page)).selection.count).toBe(segments - second);

  await page.getByTestId('component-2').click();
  const [[one] = []] = [...(await segmentsOnScreen(page, 1)).entries()];
  if (one === undefined) throw new Error('no segment on screen');
  await page.evaluate((segment) => {
    type Store = { getState(): { select(s: Uint32Array, mode: string): void } };
    (window as unknown as { grapeTest: { store: Store } }).grapeTest.store
      .getState()
      .select(Uint32Array.of(segment), 'replace');
  }, one);
  await expect.poll(async () => (await appState(page)).selection.count).toBe(1);
  await page.getByTestId('select-components').click();
  await expect.poll(async () => (await appState(page)).selection.count).toBeGreaterThan(1);

  const before = (await appState(page)).zoom ?? 0;
  await page.getByTestId('zoom-selection').click();
  await expect.poll(async () => (await appState(page)).zoom).not.toBe(before);
});
