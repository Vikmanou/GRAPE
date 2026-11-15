// After one visit the site opens, and opens a file, with no network. This
// builds the site and serves it from a folder, because the dev server has no
// service worker.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { repo } from './helpers';

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

let server: Server;
let origin = '';

test.beforeAll(async () => {
  const web = fileURLToPath(new URL('../../', import.meta.url));
  const dist = mkdtempSync(join(tmpdir(), 'grape-offline-'));
  execFileSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], { cwd: web, stdio: 'ignore' });
  server = createServer((request, response) => {
    const path = normalize(new URL(request.url ?? '/', 'http://x').pathname).replace(/^(\.\.[/\\])+/, '');
    let file = join(dist, path);
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      const body = readFileSync(file);
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  origin = `http://localhost:${typeof address === 'object' && address ? address.port : 0}`;
});

test.afterAll(() => {
  server.close();
});

test('the site reloads and opens a file with no network after one visit', async ({ page, context }) => {
  await page.goto(origin);
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
