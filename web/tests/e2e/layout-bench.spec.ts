// Run through scripts/bench-layout.mjs, which sets GRAPE_LAYOUT_BENCH to a JSON
// job: graphs to lay out on the GPU, where to write positions and timings,
// which graphs to screenshot (with the CPU layout too) and which to time
// panning and zooming on.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

interface Job {
  files: string[];
  out: string;
  /** Screenshots of the GPU layout, and of the CPU layout for `cpu` graphs. */
  screenshots?: { dir: string; gpu: string[]; cpu: string[] };
  interaction?: string[];
}

const job = JSON.parse(process.env.GRAPE_LAYOUT_BENCH ?? 'null') as Job | null;
const SETTLE_MS = 30 * 60_000;

/** Resident memory of every Chromium process, in MB; Linux only. */
function browserMemoryMb(): number | undefined {
  if (process.platform !== 'linux') return undefined;
  const rows = execFileSync('ps', ['-eo', 'rss=,comm='], { encoding: 'utf8' }).split('\n');
  const kb = rows
    .map((row) => row.trim().split(/\s+/))
    .filter(([, name]) => name?.startsWith('chrome'))
    .reduce((sum, [rss]) => sum + Number(rss), 0);
  return Math.round(kb / 1024);
}

async function openGraph(page: Page, path: string, query = ''): Promise<void> {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(`/${query}`);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('status-renderer')).toHaveAttribute('data-renderer', 'webgpu');
  await page.getByTestId('open-input').setInputFiles(path);
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done', { timeout: SETTLE_MS });
  await page.waitForFunction(() => (window as { grapeLayout?: unknown }).grapeLayout !== undefined, undefined, {
    timeout: SETTLE_MS,
  });
}

/**
 * Drags and wheels the view every frame for three seconds. Returns the
 * status bar's frame rate, or the animation frame rate when frames came too
 * far apart for the status bar to count them.
 */
async function panAndZoom(page: Page): Promise<number> {
  const animationFps = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const rect = canvas.getBoundingClientRect();
    const [cx, cy] = [rect.left + rect.width / 2, rect.top + rect.height / 2];
    const at = { clientX: cx, clientY: cy, bubbles: true, cancelable: true };
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
  });
  const shown = await page
    .getByTestId('status-fps')
    .textContent({ timeout: 1000 })
    .catch(() => null);
  const status = shown === null ? Infinity : Number(shown.replace(/\D+/g, ''));
  return Math.round(Math.min(status, animationFps));
}

async function zoomIn(page: Page, steps: number): Promise<void> {
  await page.evaluate((n) => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const rect = canvas.getBoundingClientRect();
    const at = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true };
    for (let i = 0; i < n; i++)
      canvas.dispatchEvent(new WheelEvent('wheel', { ...at, cancelable: true, deltaY: -100 }));
  }, steps);
}

test.describe('layout benchmark', () => {
  test.skip(!job, 'run through scripts/bench-layout.mjs');
  test.setTimeout(2 * SETTLE_MS);

  test('adapter', async ({ page }) => {
    await page.goto('/');
    const info = await page.evaluate(async () => {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      return adapter ? `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`.trim() : '';
    });
    writeFileSync(join(job?.out ?? '.', 'adapter.txt'), info);
  });

  for (const path of job?.files ?? []) {
    test(path, async ({ page }) => {
      if (!job) return;
      const name = basename(path);
      await openGraph(page, path);
      const status = page.getByTestId('status-layout');
      const result: Record<string, number | string | undefined> = {
        parseMs: Number(await page.getByTestId('format').getAttribute('data-parse-ms')),
        settledMs: Number(await status.getAttribute('data-ms')),
        usableMs: Number(await status.getAttribute('data-usable-ms')),
        memoryMb: browserMemoryMb(),
      };
      const positions = await page.evaluate(() => {
        const layout = (window as unknown as { grapeLayout: { positions: Float32Array } }).grapeLayout;
        const bytes = new Uint8Array(layout.positions.buffer, layout.positions.byteOffset, layout.positions.byteLength);
        let text = '';
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(text);
      });
      writeFileSync(join(job.out, `${name}.gpu.f32`), Buffer.from(positions, 'base64'));

      const shots = job.screenshots;
      if (shots?.gpu.includes(path)) await page.screenshot({ path: join(shots.dir, `${name}-gpu.png`) });
      if (job.interaction?.includes(path)) {
        result.fpsZoomedOut = await panAndZoom(page);
        await zoomIn(page, 30);
        result.fpsZoomedIn = await panAndZoom(page);
      }
      if (shots?.cpu.includes(path)) {
        await openGraph(page, path, '?layout=cpu');
        await page.screenshot({ path: join(shots.dir, `${name}-cpu.png`) });
      }
      writeFileSync(join(job.out, `${name}.json`), JSON.stringify(result));
    });
  }
});
