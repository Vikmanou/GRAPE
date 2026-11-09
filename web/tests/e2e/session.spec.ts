// A session file reproduces a view exactly in another browser page and on the
// other backend: the WebGPU project saves and WebGL2 opens it; the WebGL2
// project, which CI runs, saves and opens on WebGL2.

import { writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { backend, failOnPageError, gotoApp, repo, skipUnlessBackend } from './helpers';

const VIEWPORT = { width: 1000, height: 700 };
const CLIP = { x: 48, y: 48, width: VIEWPORT.width - 56, height: VIEWPORT.height - 84 };
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

test('a session file reproduces the view exactly on WebGL2', async ({ page, context }, info) => {
  failOnPageError(page);
  await page.setViewportSize(VIEWPORT);
  await gotoApp(page);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await skipUnlessBackend(page);
  await page.getByTestId('open-input').setInputFiles(FILE);
  await settled(page);
  await page.getByRole('button', { name: 'Hide the sidebar' }).click();
  await page.evaluate(() => {
    const s = (window as unknown as { grapeTest: Hooks }).grapeTest.store.getState() as {
      setLayoutOptions(o: { seed: number; quality: string }): void;
    };
    s.setLayoutOptions({ seed: 9, quality: 'fast' });
  });
  await settled(page);
  await page.evaluate(() => {
    const s = (window as unknown as { grapeTest: Hooks }).grapeTest.store.getState() as {
      setColorMode(m: string): void;
      select(s: Uint32Array, mode: string): void;
      zoomView(f: number): void;
    };
    s.setColorMode('depth');
    s.select(Uint32Array.of(2, 5), 'replace');
    s.zoomView(1.8);
  });
  await page.mouse.move(0, VIEWPORT.height - 10);
  await page.waitForTimeout(800);
  const hash = await positionsHash(page);
  const picture = await page.screenshot({ clip: CLIP });
  const session = await page.evaluate(async () => {
    const s = (window as unknown as { grapeTest: Hooks }).grapeTest.store.getState() as {
      saveSession(): Promise<Blob>;
    };
    const bytes = new Uint8Array(await (await s.saveSession()).arrayBuffer());
    let text = '';
    for (const b of bytes) text += String.fromCharCode(b);
    return btoa(text);
  });
  const path = info.outputPath('view.grape.json.gz');
  writeFileSync(path, Buffer.from(session, 'base64'));

  const other = await context.newPage();
  failOnPageError(other);
  await other.setViewportSize(VIEWPORT);
  await other.goto('/?renderer=webgl2');
  await expect(other.getByTestId('status-renderer')).toHaveAttribute('data-renderer', 'webgl2');
  await other.getByTestId('open-input').setInputFiles(path);
  await expect.poll(() => other.evaluate(() => location.hash)).toBe('');
  await other.getByTestId('open-input').setInputFiles(FILE);
  await settled(other);
  await expect
    .poll(() =>
      other.evaluate(
        () =>
          ((window as unknown as { grapeTest: Hooks }).grapeTest.store.getState().selection as { count: number }).count,
      ),
    )
    .toBe(2);
  // Drawn from the session's positions: no layout ran.
  const status = await other.evaluate(
    () => (window as unknown as { grapeTest: Hooks }).grapeTest.store.getState().layoutStatus as { total: number },
  );
  expect(status.total).toBe(0);
  expect(await positionsHash(other)).toBe(hash);
  await other.mouse.move(0, VIEWPORT.height - 10);
  await other.waitForTimeout(800);
  const different = await other.evaluate(
    async ([a, b]) => {
      const pixels = async (data: string) => {
        const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
        const canvas = new OffscreenCanvas(image.width, image.height);
        const c = canvas.getContext('2d');
        if (!c) throw new Error('no 2d context');
        c.drawImage(image, 0, 0);
        return c.getImageData(0, 0, image.width, image.height).data;
      };
      const [p, q] = await Promise.all([pixels(a), pixels(b)]);
      let n = 0;
      for (let i = 0; i < p.length; i += 4) {
        if ([0, 1, 2].reduce((sum, k) => sum + Math.abs((p[i + k] ?? 0) - (q[i + k] ?? 0)), 0) > 48) n++;
      }
      return n / (p.length / 4);
    },
    [picture.toString('base64'), (await other.screenshot({ clip: CLIP })).toString('base64')] as const,
  );
  // The bundled examples differ by under 0.001% between backends from the same positions (milestone 7).
  expect(different).toBeLessThan(backend() === 'webgl2' ? 0.002 : 0.01);
});
