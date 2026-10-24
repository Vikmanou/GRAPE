// Downloads the real assembly graphs in samples/manifest.json into samples/.
// A URL fragment names a member of a zip archive.
//
// Usage: npm run samples [-- --large] [-- --huge] [-- --check]
//   --large   also fetch the 30-110 MB graphs
//   --huge    also fetch the multi-GB stress graphs (implies --large)
//   --check   parse every present sample natively and print its counts

import { spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGunzip, inflateRawSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const samplesDir = join(root, 'samples');
const args = new Set(process.argv.slice(2));
const huge = args.has('--huge');
const tiers = ['small', ...(huge || args.has('--large') ? ['large'] : []), ...(huge ? ['huge'] : [])];

const manifest = JSON.parse(readFileSync(join(samplesDir, 'manifest.json'), 'utf8'));
const samples = tiers.flatMap((tier) => Object.entries(manifest[tier]));
// Zenodo answers 403 to fetch's default User-Agent.
const headers = { 'User-Agent': 'GRAPE-sample-fetcher (+https://github.com/Vikmanou/GRAPE)' };
const archives = new Map();
let failures = 0;

for (const [file, url] of samples) {
  const path = join(samplesDir, file);
  if (existsSync(path)) continue;
  console.log(`fetch  ${file}`);
  const [location, member] = url.split('#');
  try {
    if (member) writeFileSync(path, unzip(await archive(location), member));
    else await download(location, path);
  } catch (error) {
    console.error(`FAILED ${file}: ${error.message}`);
    failures++;
  }
}

if (args.has('--check')) {
  const parser = buildParser();
  for (const [file] of samples) {
    const path = join(samplesDir, file);
    if (!existsSync(path)) continue;
    const result = spawnSync(parser, [await plain(path)], { encoding: 'utf8' });
    if (result.status !== 0) {
      console.error(`FAILED ${file}: ${(result.stderr || result.stdout).trim().split('\n').pop()}`);
      failures++;
      continue;
    }
    const counts = ['segments', 'links', 'components', 'paths', 'walks', 'warnings']
      .map((name) => `${name} ${/\d+/.exec(result.stdout.split('\n').find((l) => l.startsWith(name)) ?? '')?.[0]}`)
      .join(', ');
    console.log(`parsed ${file}: ${counts}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} sample(s) failed`);
  process.exit(1);
}

async function download(url, path) {
  const response = await fetch(url, { headers });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${url}`);
  const total = Number(response.headers.get('content-length') ?? 0);
  let received = 0;
  let lastReport = 0;
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (total > 50e6 && Date.now() - lastReport > 2000) {
        lastReport = Date.now();
        console.log(`       ${((received / total) * 100).toFixed(0)}% of ${(total / 1e9).toFixed(2)} GB`);
      }
      callback(null, chunk);
    },
  });
  // Written under a temporary name so an interrupted download is fetched again.
  const partial = `${path}.part`;
  await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(partial));
  renameSync(partial, path);
}

async function archive(url) {
  if (!archives.has(url)) {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    archives.set(url, Buffer.from(await response.arrayBuffer()));
  }
  return archives.get(url);
}

// Just enough of the zip format (PKWARE APPNOTE 4.3) to pull one stored or
// deflated member out of an archive held in memory.
function unzip(zip, member) {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip archive');
  const entries = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let i = 0; i < entries; i++) {
    const method = zip.readUInt16LE(at + 10);
    const compressedSize = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    const local = zip.readUInt32LE(at + 42);
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    if (name !== member) continue;
    const data = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(data, data + compressedSize);
    if (method === 0) return body;
    if (method === 8) return inflateRawSync(body);
    throw new Error(`unsupported zip compression method ${method}`);
  }
  throw new Error(`${member} not found in archive`);
}

function buildParser() {
  const build = spawnSync('cargo', ['build', '-q', '-p', 'gfa-core', '--release', '--example', 'parse_file'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (build.status !== 0) process.exit(1);
  return join(root, 'target', 'release', 'examples', process.platform === 'win32' ? 'parse_file.exe' : 'parse_file');
}

/** The native parser reads plain text, so gzipped samples are expanded into target/. */
async function plain(path) {
  if (!path.endsWith('.gz')) return path;
  const scratch = join(root, 'target', 'samples');
  mkdirSync(scratch, { recursive: true });
  const out = join(scratch, path.split(/[\\/]/).pop().replace(/\.gz$/, ''));
  if (!existsSync(out)) await pipeline(createReadStream(path), createGunzip(), createWriteStream(out));
  return out;
}
