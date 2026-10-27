// Double mode draws both strands; picking still finds each segment.
// Needs a WebGPU adapter.

import { expect, test } from '@playwright/test';
import { openSettled, repo, segmentsOnScreen } from './helpers';

test('double mode redraws both strands and keeps picking', async ({ page }) => {
  await openSettled(page, repo('testdata/bubble.gfa'));
  const canvas = page.getByTestId('engine-canvas');
  const single = await canvas.screenshot();
  await page.keyboard.press('d');
  await expect.poll(async () => (await canvas.screenshot()).equals(single)).toBe(false);

  const picked = [...(await segmentsOnScreen(page, 4)).keys()].sort();
  expect(picked).toEqual([0, 1, 2, 3]);
});
