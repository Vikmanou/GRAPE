// The service worker that keeps a copy of the whole app, so the site opens
// without a network after one visit. Written at build time, when every file
// of the build is known.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

export const WORKER_FILE = 'sw.js';

/** Every file under `dir`, as paths relative to it with `/` separators. */
export function listFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(relative(dir, path).split(sep).join('/'));
    }
  };
  walk(dir);
  return found.sort();
}

/** The script of the worker: cache every file at install, answer same-origin reads from the cache. */
export function workerSource(files: readonly string[], version: string): string {
  const urls = ['./', ...files.filter((f) => f !== WORKER_FILE).map((f) => `./${f}`)];
  return `const CACHE = 'grape-${version}';
const FILES = ${JSON.stringify(urls)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('grape-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      (hit) => hit ?? (request.mode === 'navigate' ? caches.match('./index.html') : undefined) ?? fetch(request),
    ),
  );
});
`;
}

/** Writes `sw.js` into the build, named after a hash of the files it caches. */
export function offline(): Plugin {
  let outDir = '';
  return {
    name: 'grape-offline',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = listFiles(outDir).filter((f) => f !== WORKER_FILE);
      const hash = createHash('sha256');
      for (const file of files) hash.update(file).update(readFileSync(join(outDir, file)));
      writeFileSync(join(outDir, WORKER_FILE), workerSource(files, hash.digest('hex').slice(0, 12)));
    },
  };
}
