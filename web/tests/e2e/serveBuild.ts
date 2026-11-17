// Builds the site and serves it from a folder, as GitHub Pages does, for the
// specs that need the production build: the dev server has no service worker.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

/** Builds the site into a temporary folder and serves it; returns the origin and a stop function. */
export async function serveBuild(): Promise<{ origin: string; stop: () => void }> {
  const web = fileURLToPath(new URL('../../', import.meta.url));
  const dist = mkdtempSync(join(tmpdir(), 'grape-build-'));
  // Vite's own script run by this node: npx is a .cmd file on Windows, which needs a shell.
  const vite = join(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin', 'vite.js');
  execFileSync(process.execPath, [vite, 'build', '--outDir', dist, '--emptyOutDir'], { cwd: web, stdio: 'ignore' });
  const server = createServer((request, response) => {
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
  return {
    origin: `http://localhost:${typeof address === 'object' && address ? address.port : 0}`,
    stop: () => server.close(),
  };
}
