// The quality gate every change is held to. CI runs exactly this script, so a
// green run here means a green CI run (minus the WebGPU path, see --headed).
//
// Usage: npm run check | check:quick | check:headed
//   --quick   Rust and TypeScript checks plus unit tests only; skips the
//             production build, size report and Playwright.
//   --headed  run Playwright in a visible browser so the real GPU and the
//             WebGPU path are exercised (headless Chromium has no adapter).

import { spawnSync } from 'node:child_process';
import { needsShell, root } from './lib.mjs';

const quick = process.argv.includes('--quick');
const headed = process.argv.includes('--headed');

const web = (script, ...args) => [
  'npm',
  ['run', script, '--workspace', 'web', ...(args.length > 0 ? ['--', ...args] : [])],
];

const steps = [
  ['rustfmt', 'cargo', ['fmt', '--all', '--check']],
  ['prettier', 'npx', ['prettier', '--check', '.']],
  ['clippy', 'cargo', ['clippy', '--workspace', '--all-targets', '--', '-D', 'warnings']],
  ['cargo test', 'cargo', ['test', '--workspace']],
  ['wasm build', 'node', ['scripts/build-wasm.mjs']],
  ['typecheck', ...web('typecheck')],
  ['eslint', ...web('lint')],
  ['vitest', ...web('test')],
  ...(quick
    ? []
    : [
        ['vite build', ...web('build')],
        ['bundle size', 'node', ['scripts/size-report.mjs']],
        // Playwright's browser is a separate download from `npm install`.
        // This is a no-op once the browser is present, so it runs every time
        // instead of being a setup step to remember.
        ['browser', 'npx', ['playwright', 'install', 'chromium']],
        // One worker when headed: GPU tests running side by side slow each other down.
        ['playwright', ...web('e2e', ...(headed ? ['--headed', '--workers=1'] : []))],
      ]),
];

const results = [];
for (const [name, cmd, args] of steps) {
  console.log(`\n=== ${name}: ${cmd} ${args.join(' ')}`);
  const start = performance.now();
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: needsShell(cmd) });
  const seconds = ((performance.now() - start) / 1000).toFixed(1);
  const ok = result.status === 0;
  results.push({ name, ok, seconds });
  if (!ok) break;
}

console.log('\n=== gate summary');
for (const { name, ok, seconds } of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(12)} ${seconds.padStart(6)} s`);
}
const skipped = steps.length - results.length;
if (skipped > 0) console.log(`skipped ${skipped} step(s) after the failure`);

const failed = results.some((r) => !r.ok);
console.log(failed ? '\nGATE FAILED' : `\nGATE PASSED${quick ? ' (quick)' : ''}`);
process.exit(failed ? 1 : 0);
