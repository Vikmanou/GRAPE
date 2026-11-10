// A link that carries the whole graph opens in a fresh tab with no file: the
// same bytes, the same view, and any FASTA the sharer attached.

import { expect, type Page, test } from '@playwright/test';
import { backend, failOnPageError, gotoApp, openSettled, repo, skipUnlessBackend } from './helpers';

const VIEWPORT = { width: 1000, height: 700 };
const CLIP = { x: 48, y: 48, width: VIEWPORT.width - 56, height: VIEWPORT.height - 84 };
const FILE = repo('web/public/examples/acacia-mitochondrion-spades.gfa.gz');

type Store = { getState(): Record<string, unknown> };

interface Snapshot {
  name: string;
  sha256: string;
  seed: number;
  selected: number;
  paths: number[];
  color: string;
  camera: { x: number; y: number; zoom: number } | undefined;
  sequences: string;
}

function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(async () => {
    const s = (window as unknown as { grapeTest: { store: Store } }).grapeTest.store.getState() as unknown as {
      load: { file: { name: string }; source: File };
      layoutOptions: { seed: number };
      selection: { count: number };
      highlightedPaths: number[];
      displayOptions: { color: string };
      camera: Snapshot['camera'];
      sequenceFile: { state: string; name?: string };
    };
    const head = new Uint8Array(await s.load.source.slice(0, 2).arrayBuffer());
    const stream =
      head[0] === 0x1f && head[1] === 0x8b
        ? s.load.source.stream().pipeThrough(new DecompressionStream('gzip'))
        : s.load.source.stream();
    const digest = await crypto.subtle.digest('SHA-256', await new Response(stream).arrayBuffer());
    return {
      name: s.load.file.name.replace(/\.gz$/, ''),
      sha256: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(''),
      seed: s.layoutOptions.seed,
      selected: s.selection.count,
      paths: s.highlightedPaths,
      color: s.displayOptions.color,
      camera: s.camera,
      sequences: s.sequenceFile.state === 'added' ? (s.sequenceFile.name ?? '') : s.sequenceFile.state,
    };
  });
}

async function settled(page: Page): Promise<void> {
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
}

/** Playwright grants clipboard access in Chromium only. */
const firefox = () => test.info().project.name === 'firefox';

/**
 * Makes the link through the share menu and reads it back from the clipboard;
 * in Firefox, from the store, as the clipboard is closed to tests there.
 */
async function packedLink(page: Page): Promise<string> {
  if (firefox()) {
    const made = await page.evaluate(() => {
      type State = { packLink(): Promise<{ state: string; link?: string }> };
      const store = (window as unknown as { grapeTest: { store: { getState(): State } } }).grapeTest.store;
      return store.getState().packLink();
    });
    if (!made.link) throw new Error(`no link: ${made.state}`);
    return made.link;
  }
  await page.getByTestId('share-menu').locator('summary').click();
  await page.getByTestId('share-pack-link').click();
  await expect(page.getByTestId('share-packed')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('share-copy-packed').click();
  await expect(page.getByTestId('share-packed')).toContainText('Copied.');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/^http:\/\/localhost:\d+\/#g=1\.[A-Za-z0-9_-]+$/);
  await page.getByTestId('share-menu').locator('summary').click();
  return link;
}

function onBackend(link: string): string {
  return backend() === 'webgl2' ? link.replace('#', '?renderer=webgl2#') : link;
}

test('a link with the graph opens the same graph and view in a tab with no file', async ({ page, context }) => {
  if (!firefox()) await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  failOnPageError(page);
  await page.setViewportSize(VIEWPORT);
  await gotoApp(page);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await skipUnlessBackend(page);
  await page.getByTestId('open-input').setInputFiles(FILE);
  await settled(page);
  await page.getByRole('button', { name: 'Hide the sidebar' }).click();
  await page.evaluate(() => {
    type State = { setLayoutOptions(o: { seed: number; quality: string }): void };
    const store = (window as unknown as { grapeTest: { store: { getState(): State } } }).grapeTest.store;
    store.getState().setLayoutOptions({ seed: 42, quality: 'fast' });
  });
  await settled(page);
  await page.evaluate(async () => {
    type State = {
      toggleHighlight(p: number): void;
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
  const link = await packedLink(page);

  const fresh = await context.browser()?.newContext();
  if (!fresh) throw new Error('no browser');
  const other = await fresh.newPage();
  failOnPageError(other);
  await other.setViewportSize(VIEWPORT);
  await other.goto(onBackend(link));
  await settled(other);
  await expect(other.getByTestId('shared-view')).toBeHidden();
  await expect.poll(async () => (await snapshot(other)).selected).toBe(3);
  await other.getByRole('button', { name: 'Hide the sidebar' }).click();
  await other.mouse.move(0, VIEWPORT.height - 10);
  await other.waitForTimeout(800);
  const after = await snapshot(other);
  expect(after.name).toBe(before.name);
  expect(after.sha256).toBe(before.sha256);
  expect(after.seed).toBe(42);
  expect(after.color).toBe(before.color);
  expect(after.paths).toEqual(before.paths);
  expect(after.camera?.zoom).toBeCloseTo(before.camera?.zoom ?? 0, 6);
  expect(after.camera?.x).toBeCloseTo(before.camera?.x ?? 0, 3);
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
  await fresh.close();
});

test('a link carries an attached FASTA and opens when pasted into Open URL', async ({ page, context }) => {
  if (!firefox()) await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openSettled(page, repo('testdata/abyss.gfa'));
  await page.getByTestId('add-sequences-input').setInputFiles(repo('testdata/abyss.fa'));
  await expect(page.getByTestId('sequences-added')).toHaveText('2 sequences from abyss.fa.');
  const before = await snapshot(page);
  const link = await packedLink(page);

  const fresh = await context.browser()?.newContext();
  if (!fresh) throw new Error('no browser');
  const other = await fresh.newPage();
  failOnPageError(other);
  await gotoApp(other);
  await expect(other.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await other.getByTestId('open-url-menu').locator('summary').click();
  await other.getByTestId('open-url-input').fill(link);
  await other.getByTestId('open-url-submit').click();
  await settled(other);
  const after = await snapshot(other);
  expect(after.sha256).toBe(before.sha256);
  expect(after.sequences).toBe('abyss.fa');
  await fresh.close();
});

test('a damaged link says so', async ({ page }) => {
  failOnPageError(page);
  await gotoApp(page);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await page.evaluate(() => {
    location.hash = '#g=1.R0EBAQ';
  });
  await expect(page.getByTestId('load-error')).toContainText('damaged');
});

/** Random bases do not compress, so this graph packs to a link over Firefox's 1 MiB limit. */
function incompressibleGraph(): Buffer {
  let x = 0x9e3779b9;
  const lines: string[] = [];
  for (let i = 0; i < 330; i++) {
    let seq = '';
    for (let j = 0; j < 10_000; j++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      seq += 'ACGT'.charAt(x & 3);
    }
    lines.push(`S\t${String(i)}\t${seq}`);
    if (i > 0) lines.push(`L\t${String(i - 1)}\t+\t${String(i)}\t+\t0M`);
  }
  return Buffer.from(`${lines.join('\n')}\n`);
}

test('a link over 1 MiB opens from Open URL, and from the address bar in Chromium', async ({ page, context }) => {
  test.setTimeout(240_000);
  if (!firefox()) await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  failOnPageError(page);
  await gotoApp(page);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await skipUnlessBackend(page);
  await page
    .getByTestId('open-input')
    .setInputFiles({ name: 'random.gfa', mimeType: 'text/plain', buffer: incompressibleGraph() });
  await settled(page);
  const before = await snapshot(page);
  const link = await packedLink(page);
  expect(link.length).toBeGreaterThan(1_048_576);
  expect(link.length).toBeLessThan(2 * 1_048_576);

  const fresh = await context.browser()?.newContext();
  if (!fresh) throw new Error('no browser');
  const other = await fresh.newPage();
  failOnPageError(other);
  if (firefox()) {
    await gotoApp(other);
    await expect(other.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
    await other.getByTestId('open-url-menu').locator('summary').click();
    await other.getByTestId('open-url-input').fill(link);
    await other.getByTestId('open-url-submit').click();
  } else {
    await other.goto(onBackend(link));
  }
  await settled(other);
  expect((await snapshot(other)).sha256).toBe(before.sha256);
  await fresh.close();
});
