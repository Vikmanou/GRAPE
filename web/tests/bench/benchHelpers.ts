// Shared by the benchmark specs, which scripts/bench-*.mjs run.

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import type { Page } from '@playwright/test';

export interface Point {
  x: number;
  y: number;
}

/** Prints "<KB> <command line>" per Chromium process: `kb` is a PowerShell expression of the process `$_`. */
function processList(kb: string): [string, string[]] {
  return process.platform === 'win32'
    ? [
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ForEach-Object { '{0} {1}' -f [int64](${kb}), $_.CommandLine }`,
        ],
      ]
    : ['ps', ['-eo', 'rss=,args=']];
}
const WORKING_SET = processList('$_.WorkingSetSize / 1KB');

/**
 * Resident memory in MB of the page's renderer process, which holds the page
 * and its workers, and of Chromium's GPU process, which holds GPU buffers on
 * integrated graphics. On Windows this is the working set, the nearest figure.
 */
export function memoryMb(): { tab: number; gpu: number } {
  return chromiumMemory(execFileSync(...WORKING_SET, { encoding: 'utf8' }));
}

/** `memoryMb` without blocking the test while the process list is read. */
export async function memoryMbAsync(): Promise<{ tab: number; gpu: number }> {
  const { stdout } = await promisify(execFile)(...WORKING_SET, { encoding: 'utf8' });
  return chromiumMemory(stdout);
}

/** The largest working set each process has had since it started, which Windows keeps (in KB); elsewhere undefined. */
export function peakMemoryMb(): { tab: number; gpu: number } | undefined {
  if (process.platform !== 'win32') return undefined;
  return chromiumMemory(execFileSync(...processList('$_.PeakWorkingSetSize'), { encoding: 'utf8' }));
}

function chromiumMemory(list: string): { tab: number; gpu: number } {
  const rows = list
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => /ms-playwright[\\/]chromium/.test(row));
  const sum = (match: (row: string) => boolean) =>
    Math.round(rows.filter(match).reduce((kb, row) => kb + Number(row.split(/\s+/)[0]), 0) / 1024);
  return {
    tab: sum((row) => row.includes('--type=renderer') && !row.includes('--top-chrome-webui')),
    gpu: sum((row) => row.includes('--type=gpu-process')),
  };
}

/**
 * Drags and wheels the view every frame for three seconds. Returns the
 * status bar's frame rate, or the animation frame rate when frames came too
 * far apart for the status bar to count them.
 */
export async function panAndZoom(page: Page, around?: Point): Promise<number> {
  const animationFps = await page.evaluate(async (around) => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const rect = canvas.getBoundingClientRect();
    const [cx, cy] = around ? [around.x, around.y] : [rect.left + rect.width / 2, rect.top + rect.height / 2];
    const at = { clientX: cx, clientY: cy, bubbles: true, cancelable: true };
    // With nothing hovered the press pans; on a hovered segment it would drag and pin it.
    canvas.dispatchEvent(new PointerEvent('pointerleave', { ...at, pointerId: 1 }));
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerId: 1, button: 0 }));
    const started = performance.now();
    let frames = 0;
    await new Promise<void>((done) => {
      const frame = (now: number) => {
        frames++;
        const t = now - started;
        canvas.dispatchEvent(new WheelEvent('wheel', { ...at, deltaY: Math.sin(t / 300) * 20 }));
        canvas.dispatchEvent(
          new PointerEvent('pointermove', { ...at, pointerId: 1, clientX: cx + Math.sin(t / 250) * 150 }),
        );
        if (t < 3000) requestAnimationFrame(frame);
        else done();
      };
      requestAnimationFrame(frame);
    });
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...at, pointerId: 1 }));
    return (frames * 1000) / (performance.now() - started);
  }, around);
  const shown = await page
    .getByTestId('status-fps')
    .textContent({ timeout: 1000 })
    .catch(() => null);
  const status = shown === null ? Infinity : Number(shown.replace(/\D+/g, ''));
  return Math.round(Math.min(status, animationFps));
}

/** Zooms toward `toward`, or the canvas centre. */
export async function zoomIn(page: Page, steps: number, toward?: Point): Promise<void> {
  await page.evaluate(
    ({ n, toward }) => {
      const canvas = document.querySelector('canvas');
      if (!canvas) throw new Error('no canvas');
      const rect = canvas.getBoundingClientRect();
      const [x, y] = toward ? [toward.x, toward.y] : [rect.left + rect.width / 2, rect.top + rect.height / 2];
      const at = { clientX: x, clientY: y, bubbles: true };
      for (let i = 0; i < n; i++)
        canvas.dispatchEvent(new WheelEvent('wheel', { ...at, cancelable: true, deltaY: -100 }));
    },
    { n: steps, toward },
  );
}
