// A Bandage layout file (BandageNG's Export layout) draws a graph again
// exactly in another page and on the other backend: the WebGPU project saves
// and WebGL2 opens it; the WebGL2 project, which CI runs, does both on WebGL2.

import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { failOnPageError, gotoApp, repo, skipUnlessBackend, storeAction } from './helpers';

const VIEWPORT = { width: 1000, height: 700 };
const FILE = repo('web/public/examples/acacia-mitochondrion-spades.gfa.gz');

type Hooks = {
  send(c: unknown): void;
  on(l: (e: { type: string; positions?: Float32Array }) => void): () => void;
  store: { getState(): Record<string, unknown> };
};

/** SHA-256 of the positions the engine draws, so two pages compare them bit for bit. */
function positionsHash(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const hooks = (window as unknown as { grapeTest: Hooks }).grapeTest;
    const positions = await new Promise<Float32Array>((resolve) => {
      const off = hooks.on((event) => {
        if (event.type === 'positions' && event.positions) {
          off();
          resolve(event.positions);
        }
      });
      hooks.send({ type: 'read-positions' });
    });
    const bytes = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength).slice();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  });
}

async function settled(page: Page): Promise<void> {
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
}

/** The exported file, named as the browser saves it: Playwright keeps downloads under a random name. */
async function exportLayout(page: Page): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  await page.getByTestId('export-menu').locator('summary').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-layout').click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('acacia-mitochondrion-spades.layout');
  return { name: saved.suggestedFilename(), mimeType: 'application/json', buffer: readFileSync(await saved.path()) };
}

test('an exported layout draws the graph again exactly, on WebGL2', async ({ page, context }) => {
  failOnPageError(page);
  await page.setViewportSize(VIEWPORT);
  await gotoApp(page);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await skipUnlessBackend(page);
  await page.getByTestId('open-input').setInputFiles(FILE);
  await settled(page);
  const hash = await positionsHash(page);
  const file = await exportLayout(page);

  const other = await context.newPage();
  failOnPageError(other);
  await other.setViewportSize(VIEWPORT);
  await other.goto('/?renderer=webgl2');
  await expect(other.getByTestId('status-renderer')).toHaveAttribute('data-renderer', 'webgl2');
  await other.getByTestId('open-input').setInputFiles(file);
  await expect(other.getByText('Open the graph first, then the layout')).toBeVisible();
  await other.getByTestId('open-input').setInputFiles(FILE);
  await settled(other);
  await other.getByTestId('open-input').setInputFiles(file);
  // Drawn from the file: no layout ran.
  await expect
    .poll(() =>
      other.evaluate(
        () =>
          ((window as unknown as { grapeTest: Hooks }).grapeTest.store.getState().layoutStatus as { total?: number })
            .total,
      ),
    )
    .toBe(0);
  await settled(other);
  expect(await positionsHash(other)).toBe(hash);
});

test('a layout that leaves segments out hides them, as BandageNG does', async ({ page }) => {
  failOnPageError(page);
  await gotoApp(page);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await skipUnlessBackend(page);
  await page.getByTestId('open-input').setInputFiles(FILE);
  await settled(page);
  const layout = JSON.parse((await exportLayout(page)).buffer.toString('utf8')) as Record<string, unknown>;
  const kept = Object.fromEntries(Object.entries(layout).slice(0, 100));
  await page.getByTestId('open-input').setInputFiles({
    name: 'part.layout',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(kept)),
  });
  await expect(page.getByTestId('status-segments')).toHaveText('100 of 161 segments shown');
  await storeAction(page, 'clearFilters');
  await expect(page.getByTestId('status-segments')).toHaveText('161 segments');
});
