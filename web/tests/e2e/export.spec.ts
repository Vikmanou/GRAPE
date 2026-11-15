// Exports from the export menu: the PNG matches the screen and its tiles join
// without seams; GFA and FASTA cover the selection or what the filters show.

import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { failOnPageError, gotoApp, skipUnlessBackend } from './helpers';

const VIEWPORT = { width: 1000, height: 700 };
/** The canvas without the bars and the button that brings the sidebar back. */
const CLIP = { x: 48, y: 48, width: VIEWPORT.width - 56, height: VIEWPORT.height - 84 };

async function openExample(page: Page): Promise<void> {
  failOnPageError(page);
  await page.setViewportSize(VIEWPORT);
  await gotoApp(page);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await skipUnlessBackend(page);
  await page.getByTestId('open-menu').locator('summary').click();
  await page.getByTestId('example-chloroplast').first().click();
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Hide the sidebar' }).click();
  await page.mouse.move(0, VIEWPORT.height - 10);
  await page.waitForTimeout(500);
}

interface Compared {
  width: number;
  height: number;
  /** Share of the compared pixels whose channels differ by more than the threshold in sum. */
  different: number;
}

/**
 * Exports a PNG at `scale` through the engine, with tiles of `tilePx`, and
 * compares it with `reference` (a PNG, base64) over `clip` of the export
 * read at `1 / scale`.
 */
async function exportAndCompare(
  page: Page,
  scale: number,
  tilePx: number | undefined,
  reference: string,
  clip: typeof CLIP,
  threshold: number,
): Promise<Compared> {
  return page.evaluate(
    async ([scale, tilePx, reference, clip, threshold]) => {
      type Event = { type: string; result?: { blob: Blob } | { error: string } };
      type Hooks = { send(c: unknown): void; on(l: (e: Event) => void): () => void };
      const hooks = (window as unknown as { grapeTest: Hooks }).grapeTest;
      const blob = await new Promise<Blob>((resolve, reject) => {
        const off = hooks.on((event) => {
          if (event.type !== 'exported' || !event.result) return;
          off();
          if ('blob' in event.result) resolve(event.result.blob);
          else reject(new Error(event.result.error));
        });
        hooks.send({ type: 'export-png', scale, ...(tilePx !== undefined && { tilePx }) });
      });
      const exported = await createImageBitmap(blob);
      const read = (image: ImageBitmap, x: number, y: number, width: number, height: number) => {
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('no 2d context');
        context.drawImage(image, x, y, width, height, 0, 0, width, height);
        return context.getImageData(0, 0, width, height).data;
      };
      const ref = await createImageBitmap(await (await fetch(`data:image/png;base64,${reference}`)).blob());
      const s = exported.width / ref.width;
      const p = read(exported, clip.x * s, clip.y * s, clip.width * s, clip.height * s);
      const q = read(ref, clip.x, clip.y, clip.width, clip.height);
      let different = 0;
      for (let i = 0; i < p.length; i += 4) {
        const d = [0, 1, 2].reduce((sum, k) => sum + Math.abs((p[i + k] ?? 0) - (q[i + k] ?? 0)), 0);
        if (d > threshold) different++;
      }
      return { width: exported.width, height: exported.height, different: different / (p.length / 4) };
    },
    [scale, tilePx, reference, clip, threshold] as const,
  );
}

test('a PNG of the view matches the screen, and tiles join without seams', async ({ page }) => {
  await openExample(page);
  const screen = (await page.screenshot()).toString('base64');
  const same = await exportAndCompare(page, 1, undefined, screen, CLIP, 48);
  expect(same.width).toBe(VIEWPORT.width);
  // The screen smooths the bends of ribbons and the PNG draws Bandage's straight pieces (measured: 1.2% of the
  // pixels of the fitted chloroplast ring, which is all bend).
  expect(same.different).toBeLessThan(0.02);

  // A 2× export in one tile is the reference for the same export in many.
  const whole = await exportAndCompare(page, 2, undefined, screen, CLIP, 48);
  expect(whole.width).toBe(VIEWPORT.width * 2);
  const full = { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height };
  const reference = await page.evaluate(async () => {
    type Hooks = { send(c: unknown): void; on(l: (e: { type: string; result?: { blob: Blob } }) => void): () => void };
    const hooks = (window as unknown as { grapeTest: Hooks }).grapeTest;
    const blob = await new Promise<Blob>((resolve) => {
      const off = hooks.on((event) => {
        if (event.type === 'exported' && event.result) {
          off();
          resolve(event.result.blob);
        }
      });
      hooks.send({ type: 'export-png', scale: 2 });
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let text = '';
    for (const b of bytes) text += String.fromCharCode(b);
    return btoa(text);
  });
  const doubled = { x: 0, y: 0, width: full.width * 2, height: full.height * 2 };
  // WebGL2 on a real GPU rounds antialiased edges by a unit or two differently
  // from one tile origin to the next (measured: 183 pixels, at most 2 in sum);
  // a seam would differ by far more.
  const tiled = await exportAndCompare(page, 2, 333, reference, doubled, 3);
  expect(tiled.width).toBe(VIEWPORT.width * 2);
  expect(tiled.different).toBe(0);
});

test('an SVG of the view parses and holds one ribbon per segment in view', async ({ page }) => {
  await openExample(page);
  const svg = await page.evaluate(async () => {
    type State = { exportSvg(): Promise<Blob>; load: { result?: { stats: { segments: number } } } };
    const state = (window as unknown as { grapeTest: { store: { getState(): State } } }).grapeTest.store.getState();
    const text = await (await state.exportSvg()).text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    return {
      error: doc.querySelector('parsererror')?.textContent ?? '',
      width: doc.documentElement.getAttribute('width'),
      ribbons: doc.querySelectorAll('g[stroke-linecap="round"] > path, g[stroke-linecap="round"] > circle').length,
      segments: state.load.result?.stats.segments ?? 0,
    };
  });
  expect(svg.error).toBe('');
  expect(svg.width).toBe(String(VIEWPORT.width));
  // The chloroplast is fitted to the view: every segment is in it.
  expect(svg.ribbons).toBe(svg.segments);
});

test('GFA and FASTA cover what the filters show or what is selected', async ({ page }) => {
  failOnPageError(page);
  await gotoApp(page);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await skipUnlessBackend(page);
  await page.getByTestId('open-menu').locator('summary').click();
  await page.getByTestId('example-mitochondrion').first().click();
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
  // The largest component holds 150 of the 161 segments; the rest are single segments under 1 kb.
  await page.evaluate(() => {
    type State = { setFilters(f: { minComponentLength: number }): void; select(s: Uint32Array, m: string): void };
    const s = (window as unknown as { grapeTest: { store: { getState(): State } } }).grapeTest.store.getState();
    s.setFilters({ minComponentLength: 1000 });
    s.select(Uint32Array.of(0, 1, 2), 'replace');
  });
  await expect(page.getByTestId('status-segments')).toHaveAttribute('data-visible', /\d+/);
  const visible = Number(await page.getByTestId('status-segments').getAttribute('data-visible'));

  const saved = async (id: string): Promise<string> => {
    await page.getByTestId('export-menu').locator('summary').click();
    const download = page.waitForEvent('download');
    await page.getByTestId(id).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^acacia-mitochondrion-spades\./);
    const path = await file.path();
    return readFileSync(path, 'utf8');
  };
  const lines = (text: string, start: string) => text.split('\n').filter((l) => l.startsWith(start)).length;

  const shownGfa = await saved('export-gfa-visible');
  expect(lines(shownGfa, 'S\t')).toBe(visible);
  const wholeGfa = await saved('export-gfa-all');
  expect(lines(wholeGfa, 'S\t')).toBe(161);
  expect(lines(shownGfa, 'L\t')).toBeLessThanOrEqual(lines(wholeGfa, 'L\t'));
  expect(lines(await saved('export-fasta-visible'), '>')).toBe(visible);
  expect(lines(await saved('export-fasta-selection'), '>')).toBe(3);
  expect(lines(await saved('export-gfa-selection'), 'S\t')).toBe(3);
});
