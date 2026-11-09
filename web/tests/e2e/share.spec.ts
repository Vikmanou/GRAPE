// A share link reproduces the view on the same machine: the same file, opened
// from the link, comes back with its layout, colours, selection and camera.

import { expect, type Page, test } from '@playwright/test';
import { backend, failOnPageError, gotoApp, repo, skipUnlessBackend } from './helpers';

const VIEWPORT = { width: 1000, height: 700 };
const CLIP = { x: 48, y: 48, width: VIEWPORT.width - 56, height: VIEWPORT.height - 84 };
const FILE = repo('web/public/examples/acacia-mitochondrion-spades.gfa.gz');

interface Snapshot {
  color: string;
  selected: number;
  camera: { x: number; y: number; zoom: number } | undefined;
  seed: number;
  paths: number[];
}

function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    type State = {
      displayOptions: { color: string };
      selection: { count: number };
      camera: Snapshot['camera'];
      layoutOptions: { seed: number };
      highlightedPaths: number[];
    };
    const s = (window as unknown as { grapeTest: { store: { getState(): State } } }).grapeTest.store.getState();
    return {
      color: s.displayOptions.color,
      selected: s.selection.count,
      camera: s.camera,
      seed: s.layoutOptions.seed,
      paths: s.highlightedPaths,
    };
  });
}

async function settled(page: Page): Promise<void> {
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
}

test('a share link brings back the view on the same file', async ({ page, context }) => {
  failOnPageError(page);
  await page.setViewportSize(VIEWPORT);
  await gotoApp(page);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await skipUnlessBackend(page);
  await page.getByTestId('open-input').setInputFiles(FILE);
  await settled(page);
  await page.getByRole('button', { name: 'Hide the sidebar' }).click();
  await page.evaluate(async () => {
    type State = {
      setLayoutOptions(o: { seed: number; quality: string }): void;
    };
    const store = (window as unknown as { grapeTest: { store: { getState(): State } } }).grapeTest.store;
    store.getState().setLayoutOptions({ seed: 42, quality: 'fast' });
    await Promise.resolve();
  });
  await settled(page);
  await page.evaluate(async () => {
    type State = {
      toggleHighlight(p: number): void;
      setColorMode(m: string): void;
      select(s: Uint32Array, mode: string): void;
      zoomView(f: number): void;
      panView(x: number, y: number): void;
      paths: { state: string };
    };
    const store = (window as unknown as { grapeTest: { store: { getState(): State } } }).grapeTest.store;
    const s = () => store.getState();
    while (s().paths.state !== 'ready') await new Promise((r) => setTimeout(r, 50));
    s().toggleHighlight(1);
    s().select(Uint32Array.of(3, 7, 11), 'replace');
    s().zoomView(2.5);
    s().panView(0.1, -0.05);
  });
  await page.mouse.move(0, VIEWPORT.height - 10);
  await page.waitForTimeout(800);
  const before = await snapshot(page);
  const picture = await page.screenshot({ clip: CLIP });
  const { link } = await page.evaluate(() =>
    (
      window as unknown as {
        grapeTest: { store: { getState(): { shareLink(u: boolean): Promise<{ link: string }> } } };
      }
    ).grapeTest.store
      .getState()
      .shareLink(false),
  );
  expect(link).toMatch(/#v=1\./);

  const other = await context.newPage();
  failOnPageError(other);
  await other.setViewportSize(VIEWPORT);
  await other.goto(backend() === 'webgl2' ? link.replace('#', '?renderer=webgl2#') : link);
  await expect(other.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await expect(other.getByTestId('shared-view')).toContainText('A shared view is waiting for its graph');
  await other.getByTestId('open-input').setInputFiles(FILE);
  await settled(other);
  await expect(other.getByTestId('shared-view')).toBeHidden();
  await expect.poll(async () => (await snapshot(other)).selected).toBe(3);
  await other.mouse.move(0, VIEWPORT.height - 10);
  await other.waitForTimeout(800);
  const after = await snapshot(other);
  expect(after.seed).toBe(42);
  expect(after.color).toBe(before.color);
  expect(after.paths).toEqual(before.paths);
  expect(after.camera?.zoom).toBeCloseTo(before.camera?.zoom ?? 0, 6);
  expect(after.camera?.x).toBeCloseTo(before.camera?.x ?? 0, 3);
  expect(after.camera?.y).toBeCloseTo(before.camera?.y ?? 0, 3);
  expect(await other.evaluate(() => location.hash)).toBe('');

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
  expect(different).toBeLessThan(0.002);
});

test('a share link refuses a different file and opens it as it is', async ({ page }) => {
  failOnPageError(page);
  await gotoApp(page);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await skipUnlessBackend(page);
  await page.getByTestId('open-input').setInputFiles(FILE);
  await settled(page);
  const { link } = await page.evaluate(() =>
    (
      window as unknown as {
        grapeTest: { store: { getState(): { shareLink(u: boolean): Promise<{ link: string }> } } };
      }
    ).grapeTest.store
      .getState()
      .shareLink(false),
  );
  await page.goto(backend() === 'webgl2' ? link.replace('#', '?renderer=webgl2#') : link);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await page.getByTestId('open-input').setInputFiles(repo('testdata/tangle.gfa'));
  await expect(page.getByText('This is not the file the link was made from')).toBeVisible();
  await settled(page);
});

test('the share menu copies a link and saves a session file', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  failOnPageError(page);
  await gotoApp(page);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await skipUnlessBackend(page);
  await page.getByTestId('open-input').setInputFiles(FILE);
  await settled(page);
  await page.getByTestId('share-menu').locator('summary').click();
  await page.getByTestId('share-copy-link').click();
  await expect(page.getByTestId('share-copied')).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/^http:\/\/localhost:\d+\/#v=1\.[A-Za-z0-9_-]+$/);
  const download = page.waitForEvent('download');
  await page.getByTestId('share-save-session').click();
  expect((await download).suggestedFilename()).toBe('acacia-mitochondrion-spades.grape.json.gz');
});
