import { expect, test } from '@playwright/test';

// Run through scripts/bench-parse.mjs, which generates the files and sets
// GRAPE_BENCH_FILES to a comma-separated list of paths.
const files = (process.env.GRAPE_BENCH_FILES ?? '').split(',').filter(Boolean);

test.describe('parse benchmark', () => {
  test.skip(files.length === 0, 'set GRAPE_BENCH_FILES to run');
  test.setTimeout(10 * 60_000);

  for (const path of files) {
    test(path, async ({ page }) => {
      await page.goto('/');
      await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
      // Records when the progress text changes, to check the update interval.
      await page.evaluate(() => {
        const w = window as unknown as { progressTimes: number[] };
        w.progressTimes = [];
        new MutationObserver(() => {
          if (document.querySelector('[data-testid="status-task"]')) w.progressTimes.push(performance.now());
        }).observe(document.body, { subtree: true, childList: true, characterData: true });
      });
      await page.getByTestId('open-input').setInputFiles(path);
      const format = page.getByTestId('format');
      await expect(format).toBeVisible({ timeout: 10 * 60_000 });
      const parseMs = Number(await format.getAttribute('data-parse-ms'));
      const segments = await page.getByTestId('stat-segments').textContent();
      const times = await page.evaluate(() => (window as unknown as { progressTimes: number[] }).progressTimes);
      const gaps = times.slice(1).map((t, i) => t - (times[i] ?? t));
      const maxGap = gaps.length > 0 ? Math.max(...gaps) : 0;
      console.log(
        `BENCH ${path} parseMs=${String(parseMs)} segments=${segments ?? ''} progressUpdates=${String(times.length)} maxProgressGapMs=${maxGap.toFixed(0)}`,
      );
    });
  }
});
