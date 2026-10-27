// Dragging pins a segment where it is dropped; the rest of the graph refines
// around it. Needs a WebGPU adapter, so it runs under `npm run check:headed`
// and skips elsewhere.

import { expect, type Page, test } from '@playwright/test';
import { appState, openSettled, repo, segmentsOnScreen, showTab } from './helpers';

/** The segment the engine draws at a page position. */
async function segmentAt(page: Page, at: { x: number; y: number }): Promise<number | undefined> {
  return page.evaluate(async ({ x, y }) => {
    type Picked = { type: string; x?: number; y?: number; segment?: number };
    type Hooks = { send(command: unknown): void; on(listener: (event: Picked) => void): () => void };
    const hooks = (window as unknown as { grapeTest: Hooks }).grapeTest;
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    const [px, py] = [Math.round(x * scale), Math.round(y * scale)];
    return new Promise<number | undefined>((resolve) => {
      const off = hooks.on((event) => {
        if (event.type === 'picked' && event.x === px && event.y === py) {
          off();
          resolve(event.segment);
        }
      });
      hooks.send({ type: 'pick', x: px, y: py });
    });
  }, at);
}

const pinned = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { grapeTest: { store: { getState(): { pinned: number } } } }).grapeTest.store.getState()
        .pinned,
  );

test('a dragged segment stays where it is dropped until unpinned', async ({ page }) => {
  const gpuErrors: string[] = [];
  page.on('console', (message) => {
    if (message.text().startsWith('GPU error')) gpuErrors.push(message.text());
  });
  await openSettled(page, repo('testdata/tangle.gfa'));
  const candidates = [...(await segmentsOnScreen(page, 20)).entries()].filter(([, at]) => at.x > 450 && at.x < 750);
  const [segment, at] = candidates[0] ?? [];
  if (segment === undefined || !at) throw new Error('no segment in the middle of the view');

  await page.mouse.move(at.x, at.y);
  await expect.poll(async () => (await appState(page)).hovered).toBe(segment);
  const to = { x: at.x + 60, y: at.y + 90 };
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(at.x + (60 * k) / 10, at.y + (90 * k) / 10);
  await page.mouse.up();
  await expect.poll(() => pinned(page)).toBe(1);
  await expect(page.getByTestId('status-refining')).toBeHidden({ timeout: 30_000 });
  await expect.poll(() => segmentAt(page, to)).toBe(segment);
  expect((await appState(page)).selection.count).toBe(0);

  await showTab(page, 'display');
  await page.getByTestId('unpin-all').click();
  await expect.poll(() => pinned(page)).toBe(0);
  expect(gpuErrors).toEqual([]);
});

test('re-layout selection moves only the selection', async ({ page }) => {
  await openSettled(page, repo('testdata/tangle.gfa'));
  const moved = 0;
  await page.evaluate((segment) => {
    type Store = { getState(): { select(s: Uint32Array, mode: string): void } };
    const store = (window as unknown as { grapeTest: { store: Store } }).grapeTest.store;
    store.getState().select(Uint32Array.of(segment), 'replace');
  }, moved);
  // The info panel opens and the view refits around it before positions are read.
  await expect(page.getByTestId('info-panel')).toBeVisible();
  await page.waitForTimeout(300);
  await showTab(page, 'display');
  const others = [...(await segmentsOnScreen(page, 20)).entries()].filter(([segment]) => segment !== moved);
  const [[kept, keptAt] = []] = others;
  if (kept === undefined || !keptAt) throw new Error('no other segment on screen');
  await page.evaluate(() => {
    type Hooks = { on(listener: (event: { type: string; active?: boolean }) => void): () => void };
    const w = window as unknown as { grapeTest: Hooks; refined?: boolean };
    w.grapeTest.on((event) => {
      if (event.type === 'refining' && event.active) w.refined = true;
    });
  });
  await page.getByTestId('relayout-selection').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { refined?: boolean }).refined)).toBe(true);
  await expect(page.getByTestId('status-refining')).toBeHidden({ timeout: 30_000 });
  await expect.poll(() => segmentAt(page, keptAt)).toBe(kept);
});
