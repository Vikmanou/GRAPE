// Runs one graph through GRAPE (Chromium on the real GPU), Bandage 0.9.0 (in
// WSL, from the AppImage) or BandageNG (Windows build), and reports the wall
// time and the peak memory of that run. Each tool is unpacked under tools/.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { basename, join } from 'node:path';
import { needsShell, root } from '../lib.mjs';

export const CAP_MS = 30 * 60_000;
export const BANDAGE_VERSION = '0.9.0';
export const BANDAGENG_VERSION = '2026.11.1';
const WSL_DISTRO = 'Ubuntu';
const WSL_HOME = '~/grape-compare';
const BANDAGENG = join(root, 'tools', 'bandageng', 'BandageNG', 'BandageNG.exe');
const BANDAGE_DIR = join(root, 'tools', 'bandage', 'squashfs-root');

const work = join(root, 'target', 'compare');
mkdirSync(work, { recursive: true });

/**
 * Runs a command and returns its output. A command that could not start, or
 * was killed from outside, stops the whole run: its result says nothing
 * about the tool, so it must not be recorded as one.
 */
function capture(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, shell: needsShell(cmd), ...options });
  if (r.error || r.signal) throw new Error(`${cmd} did not run: ${r.error?.message ?? `killed by ${r.signal}`}`);
  return r;
}

function wsl(script, timeout) {
  const r = capture('wsl.exe', ['-d', WSL_DISTRO, '--', 'bash', '-lc', script], { timeout });
  return { ...r, stdout: (r.stdout ?? '').replace(/\0/g, ''), stderr: (r.stderr ?? '').replace(/\0/g, '') };
}

const toWsl = (path) => path.replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/');
const quote = (text) => `'${text.replace(/'/g, `'\\''`)}'`;

export function machine() {
  const gpu = capture('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader']).stdout?.trim() || 'unknown GPU';
  const cpu = cpus()[0]?.model.trim() ?? 'unknown CPU';
  return `${cpu}, ${gpu}, ${Math.round(totalmem() / 2 ** 30)} GB, ${platform()} ${release()}`;
}

export function grapeVersion() {
  return capture('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).stdout.trim();
}

/** Copies Bandage and the inputs into WSL's own disk, so reading them is not slowed by the Windows mount. */
export function stageWsl(files) {
  const lines = [`mkdir -p ${WSL_HOME}/inputs`];
  lines.push(`test -x ${WSL_HOME}/bandage/AppRun || cp -r ${quote(toWsl(BANDAGE_DIR))} ${WSL_HOME}/bandage`);
  for (const file of files) {
    const target = `${WSL_HOME}/inputs/${basename(file)}`;
    lines.push(
      `[ "$(stat -c %s ${target} 2>/dev/null)" = "${statSync(file).size}" ] || cp ${quote(toWsl(file))} ${target}`,
    );
  }
  const r = wsl(lines.join(' && '));
  if (r.status !== 0) throw new Error(`staging in WSL failed: ${r.stderr}`);
}

/** One `Bandage <command>` in WSL, timed by GNU time; `timeout` stops it at the cap. */
export function bandage(command, file, args, out) {
  const output = `${WSL_HOME}/out/${basename(out)}`;
  const script = [
    `mkdir -p ${WSL_HOME}/out && rm -f ${output}`,
    `QT_QPA_PLATFORM=offscreen /usr/bin/time -f 'GRAPE_TIME %e %M %x' timeout -s KILL ${CAP_MS / 1000} ${WSL_HOME}/bandage/AppRun ${command} ${WSL_HOME}/inputs/${basename(file)} ${output} ${args.map(quote).join(' ')}`,
    `test -f ${output} && cp ${output} ${quote(toWsl(out))}; true`,
  ].join('; ');
  const r = wsl(script, CAP_MS + 120_000);
  const text = `${r.stdout}\n${r.stderr}`;
  const time = text.match(/GRAPE_TIME (\S+) (\d+) (-?\d+)/);
  if (!time) return { status: 'failed', error: tail(text) };
  const [, seconds, kb, code] = time;
  const ms = Number(seconds) * 1000;
  const peakMb = Math.round(Number(kb) / 1024);
  // timeout -s KILL ends the run with signal 9, which GNU time reports as status 137.
  if (ms >= CAP_MS - 1000) return { status: 'dnf', ms, peakMb, error: 'stopped at the 30 min cap' };
  if (code !== '0' || !existsSync(out)) return { status: 'failed', ms, peakMb, error: tail(text) };
  return { status: 'ok', ms, peakMb };
}

/**
 * One `BandageNG <command>` on Windows. The process's own start and exit times
 * give the wall time, and its peak working set, polled while it runs, the memory.
 */
export function bandageNg(command, file, args, out) {
  rmSync(out, { force: true });
  const list = [command, file, out, ...args].map((a) => `'"${a.replace(/'/g, "''")}"'`).join(',');
  const log = join(work, 'bandageng.log');
  const script = [
    '$clock = [Diagnostics.Stopwatch]::StartNew()',
    `$p = Start-Process -FilePath '${BANDAGENG}' -ArgumentList ${list} -PassThru -NoNewWindow -RedirectStandardOutput '${log}' -RedirectStandardError '${log}.err'`,
    '$null = $p.Handle; $peak = 0',
    'while (-not $p.HasExited) {',
    '  $p.Refresh(); if ($p.PeakWorkingSet64 -gt $peak) { $peak = $p.PeakWorkingSet64 }',
    `  if (((Get-Date) - $p.StartTime).TotalMilliseconds -gt ${CAP_MS}) { Stop-Process -Id $p.Id -Force; $p.WaitForExit(); 'GRAPE_DNF {0}' -f $peak; exit }`,
    '  Start-Sleep -Milliseconds 50',
    '}',
    // The process's own times, unless Windows returned no exit time (seen once
    // as a date in year 1); then the stopwatch, which also counts Start-Process.
    '$ms = ($p.ExitTime - $p.StartTime).TotalMilliseconds',
    'if ($ms -le 0 -or $ms -gt $clock.Elapsed.TotalMilliseconds + 1000) { $ms = $clock.Elapsed.TotalMilliseconds }',
    "'GRAPE_RUN {0} {1} {2}' -f $ms, $peak, $p.ExitCode",
  ].join('\n');
  const r = capture('powershell', ['-NoProfile', '-Command', script], { timeout: CAP_MS + 120_000 });
  const done = r.stdout.match(/GRAPE_RUN (\S+) (\d+) (-?\d+)/);
  const logText = () => [log, `${log}.err`].map((p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')).join('\n');
  if (!done) {
    const dnf = r.stdout.match(/GRAPE_DNF (\d+)/);
    if (dnf)
      return {
        status: 'dnf',
        ms: CAP_MS,
        peakMb: Math.round(Number(dnf[1]) / 2 ** 20),
        error: 'stopped at the 30 min cap',
      };
    return { status: 'failed', error: tail(`${r.stdout}\n${r.stderr}\n${logText()}`) };
  }
  const [, ms, bytes, code] = done;
  const result = { ms: Number(ms), peakMb: Math.round(Number(bytes) / 2 ** 20) };
  if (code !== '0' || !existsSync(out)) return { ...result, status: 'failed', error: tail(logText()) };
  return { ...result, status: 'ok' };
}

/** One GRAPE run in a fresh headless Chromium on the real GPU (web/tests/bench/compare-bench.spec.ts). */
export function grape(job) {
  const result = join(work, 'grape-result.json');
  rmSync(result, { force: true });
  const started = Date.now();
  const r = capture(
    'npx',
    ['playwright', 'test', 'tests/bench/compare-bench.spec.ts', '--project=webgpu', '--workers=1', '--reporter=line'],
    {
      cwd: join(root, 'web'),
      env: {
        ...process.env,
        GRAPE_GPU_HEADLESS: '1',
        GRAPE_COMPARE_BENCH: JSON.stringify({ timeoutMs: CAP_MS, ...job, result }),
      },
      timeout: CAP_MS + 15 * 60_000,
    },
  );
  if (existsSync(result)) return { status: 'ok', ...JSON.parse(readFileSync(result, 'utf8')) };
  const text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  if (Date.now() - started >= CAP_MS || /Timed out \d+ms|Timeout \d+ms exceeded/.test(text))
    return { status: 'dnf', error: 'stopped at the 30 min cap' };
  return { status: 'failed', error: tail(text) };
}

function tail(text) {
  return text.trim().split('\n').slice(-6).join(' | ').slice(0, 600);
}
