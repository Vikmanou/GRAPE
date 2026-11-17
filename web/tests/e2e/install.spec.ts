// The production build can be installed as an app: Chromium finds no
// installability error, every image the manifest names has its stated size,
// and the offline copy holds the manifest and its images.

import { expect, test } from '@playwright/test';
import { serveBuild } from './serveBuild';

interface Image {
  src: string;
  sizes: string;
}

interface Manifest {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  icons: Image[];
  screenshots: Image[];
  file_handlers: { action: string }[];
}

let site: Awaited<ReturnType<typeof serveBuild>>;

test.beforeAll(async () => {
  site = await serveBuild();
});

test.afterAll(() => {
  site.stop();
});

test('the production build is installable and keeps its manifest offline', async ({ page }) => {
  await page.goto(site.origin);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  const manifest = (await (await page.request.get(`${site.origin}/manifest.webmanifest`)).json()) as Manifest;
  expect(manifest).toMatchObject({
    id: './',
    name: 'GPU-Rendered Assembly Path Explorer',
    short_name: 'GRAPE',
    start_url: './',
    scope: './',
    display: 'standalone',
  });
  // The site lives under a sub-path on GitHub Pages, so no path may start at the root.
  const images = [...manifest.icons, ...manifest.screenshots];
  const paths = [...images.map((image) => image.src), ...manifest.file_handlers.map((handler) => handler.action)];
  for (const path of paths) expect(path, path).not.toMatch(/^(\/|[a-z]+:)/i);
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(['192x192', '512x512', '512x512']);

  for (const image of images) {
    const size = await page.evaluate(async (src) => {
      const bitmap = await createImageBitmap(await (await fetch(src)).blob());
      return `${String(bitmap.width)}x${String(bitmap.height)}`;
    }, image.src);
    expect(size, image.src).toBe(image.sizes);
  }

  // Chromium's own reading of the manifest. Since Chrome relaxed its install
  // criteria a page without one also reports no installability error, so the
  // parsed manifest is checked too. CDP leaves out some fields (short_name,
  // file_handlers); the JSON checks above cover them.
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
  const parsed = await cdp.send('Page.getAppManifest');
  expect(parsed.url).toBe(`${site.origin}/manifest.webmanifest`);
  expect(parsed.errors).toEqual([]);
  expect(parsed.manifest).toMatchObject({ display: 'kStandalone', name: manifest.name, startUrl: `${site.origin}/` });
  expect(parsed.manifest.icons).toHaveLength(manifest.icons.length);
  expect(parsed.manifest.screenshots).toHaveLength(manifest.screenshots.length);

  await expect
    .poll(() =>
      page.evaluate(
        async (wanted) => {
          const cached = await Promise.all(wanted.map((path) => caches.match(path)));
          return wanted.filter((_, i) => !cached[i]);
        },
        [
          './manifest.webmanifest',
          './icons/icon-64.png',
          './icons/apple-touch-icon.png',
          ...images.map((image) => image.src),
        ],
      ),
    )
    .toEqual([]);
});
