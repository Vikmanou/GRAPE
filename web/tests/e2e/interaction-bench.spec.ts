// Run through scripts/bench-interaction.mjs, which sets GRAPE_INTERACTION_BENCH
// to a JSON job: graphs to open and where to write what was measured. Times
// are taken in the page, from the input event to the engine's answer.

import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { memoryMb, panAndZoom, zoomIn } from './benchHelpers';
import { segmentsOnScreen } from './helpers';

interface Job {
  files: string[];
  out: string;
}

const job = JSON.parse(process.env.GRAPE_INTERACTION_BENCH ?? 'null') as Job | null;
const SETTLE_MS = 30 * 60_000;
const CLICKS = 20;

interface Timed {
  median: number;
  max: number;
  n: number;
}

function summary(times: number[]): Timed {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    median: Math.round((sorted[Math.floor(sorted.length / 2)] ?? NaN) * 10) / 10,
    max: Math.round((sorted.at(-1) ?? NaN) * 10) / 10,
    n: sorted.length,
  };
}

/** Records, in the page, how long each event of `type` takes to follow the last `trigger` DOM event. */
async function startTiming(page: Page, trigger: string, type: string): Promise<void> {
  await page.evaluate(
    ({ trigger, type }) => {
      type Hooks = { on(listener: (event: { type: string }) => void): () => void };
      const w = window as unknown as { grapeTest: Hooks; timings: number[]; off?: () => void; at: number };
      w.off?.();
      w.timings = [];
      w.at = NaN;
      const mark = () => {
        w.at = performance.now();
      };
      window.addEventListener(trigger, mark, { capture: true });
      const off = w.grapeTest.on((event) => {
        if (event.type === type && !Number.isNaN(w.at)) {
          w.timings.push(performance.now() - w.at);
          w.at = NaN;
        }
      });
      w.off = () => {
        off();
        window.removeEventListener(trigger, mark, { capture: true });
      };
    },
    { trigger, type },
  );
}

async function resetTimings(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { timings: number[] }).timings = [];
  });
}

async function timings(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { timings: number[] }).timings);
}

test.describe('interaction benchmark', () => {
  test.skip(!job, 'run through scripts/bench-interaction.mjs');
  test.setTimeout(2 * SETTLE_MS);

  for (const path of job?.files ?? []) {
    test(path, async ({ page }) => {
      if (!job) return;
      page.on('crash', () => {
        console.log(`page crashed; tab memory ${memoryMb().tab} MB`);
      });
      await page.setViewportSize({ width: 1200, height: 800 });
      await page.goto('/');
      await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
      await expect(page.getByTestId('status-renderer')).toHaveAttribute('data-renderer', 'webgpu');
      await page.getByTestId('open-input').setInputFiles(path);
      await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done', { timeout: SETTLE_MS });
      const memory = memoryMb();
      const result: Record<string, unknown> = {
        segments: Number((await page.getByTestId('stat-segments').textContent())?.replace(/\D/g, '')),
        tabMb: memory.tab,
        gpuProcessMb: memory.gpu,
      };

      // Zoomed in on a segment, not on whatever lies at the canvas centre,
      // which can be a gap between components. Pointer timings come first,
      // while the view still holds that segment; panning for the frame rate
      // moves it.
      const [anchor] = [...(await segmentsOnScreen(page, 1)).values()];
      if (!anchor) throw new Error('no segment on screen');
      await zoomIn(page, 30, anchor);
      await page.waitForTimeout(500);
      const targets = [...(await segmentsOnScreen(page, CLICKS)).values()];
      if (targets.length === 0) throw new Error('no segment on screen once zoomed in');
      result.segmentsClicked = targets.length;

      await startTiming(page, 'pointermove', 'hover');
      const hovers: number[] = [];
      for (const at of targets) {
        await page.mouse.move(5, 5);
        await page.waitForTimeout(150);
        await resetTimings(page);
        await page.mouse.move(at.x, at.y);
        await expect.poll(async () => (await timings(page)).length).toBeGreaterThan(0);
        hovers.push((await timings(page))[0] ?? NaN);
      }
      result.hoverMs = summary(hovers);

      await startTiming(page, 'pointerup', 'selection');
      for (const [i, at] of targets.entries()) {
        await page.mouse.click(at.x, at.y);
        await expect.poll(() => timings(page)).toHaveLength(i + 1);
        await page.waitForTimeout(100);
      }
      result.clickMs = summary(await timings(page));

      const box = await page.getByTestId('engine-canvas').boundingBox();
      if (!box) throw new Error('no canvas');
      await startTiming(page, 'pointerup', 'selection');
      await page.keyboard.down('Shift');
      await page.mouse.move(box.x + 400, box.y + 200);
      await page.mouse.down();
      await page.mouse.move(box.x + 600, box.y + 400, { steps: 5 });
      await page.mouse.up();
      await page.keyboard.up('Shift');
      await expect.poll(() => timings(page)).toHaveLength(1);
      result.boxSelectMs = summary(await timings(page));

      const findMs = await page.evaluate(async () => {
        type State = { find(text: string, regex: boolean): void; findResult: { state: string } };
        type Store = { getState(): State; subscribe(listener: (state: State) => void): () => void };
        const store = (window as unknown as { grapeTest: { store: Store } }).grapeTest.store;
        const started = performance.now();
        await new Promise<void>((done) => {
          const off = store.subscribe((state) => {
            if (state.findResult.state === 'done' || state.findResult.state === 'failed') {
              off();
              done();
            }
          });
          store.getState().find('^1[0-9]*7$', true);
        });
        return performance.now() - started;
      });
      result.findRegexMs = Math.round(findMs);

      result.fpsZoomedIn = await panAndZoom(page, anchor);
      await page.getByTestId('engine-canvas').press('f');
      await page.waitForTimeout(500);
      result.fpsZoomedOut = await panAndZoom(page, anchor);
      result.tabMbAfter = memoryMb().tab;
      writeFileSync(join(job.out, `${basename(path)}.json`), JSON.stringify(result));
    });
  }
});
