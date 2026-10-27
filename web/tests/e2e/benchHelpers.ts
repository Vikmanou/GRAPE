// Shared by the benchmark specs, which scripts/bench-*.mjs run.

import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';

export interface Point {
  x: number;
  y: number;
}

/**
 * Resident memory in MB of the page's renderer process, which holds the page
 * and its workers, and of Chromium's GPU process, which holds GPU buffers on
 * integrated graphics.
 */
export function memoryMb(): { tab: number; gpu: number } {
  const rows = execFileSync('ps', ['-eo', 'rss=,args='], { encoding: 'utf8' })
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row.includes('ms-playwright/chromium'));
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
