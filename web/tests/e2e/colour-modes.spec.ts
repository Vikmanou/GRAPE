// Colour modes, their legends and settings that last across a reload.
// Needs a WebGPU adapter, so it runs under `npm run check:headed`.

import { expect, test } from '@playwright/test';
import { near, openSettled, ribbonColor, repo, segmentsOnScreen, showTab } from './helpers';

const MODES = ['uniform', 'random', 'depth', 'gc', 'length', 'component', 'tags'];

test('every colour mode shows its legend', async ({ page }) => {
  await openSettled(page, repo('testdata/linear.gfa'));
  await showTab(page, 'display');
  for (const mode of MODES) {
    await page.getByTestId('color-mode').selectOption(mode);
    await expect(page.getByTestId('legend')).toHaveAttribute('data-mode', mode);
    const ranged = mode === 'depth' || mode === 'gc' || mode === 'length';
    await expect(page.getByTestId('legend-ramp')).toHaveCount(ranged ? 1 : 0);
  }
});

test("depth starts at Bandage's quartile range and colours segments along the ramp", async ({ page }) => {
  // Depths 10, 20 and 10: quartiles 10 and 17.5 over Bandage's doubled list.
  await openSettled(page, repo('testdata/linear.gfa'));
  await showTab(page, 'display');
  await page.getByTestId('color-mode').selectOption('depth');
  await expect(page.getByTestId('range-min')).toHaveValue('10');
  await expect(page.getByTestId('range-max')).toHaveValue('17.5');
  await page.getByTestId('dim-unselected').uncheck();
  const segments = await segmentsOnScreen(page, 3);
  const viridisEnds = { 0: [0x44, 0x01, 0x54], 1: [0xfd, 0xe7, 0x25], 2: [0x44, 0x01, 0x54] };
  for (const [segment, at] of segments) {
    const want = viridisEnds[segment as 0 | 1 | 2];
    expect(near(await ribbonColor(page, at.x, at.y), want), `segment ${segment}`).toBe(true);
  }

  await page.getByTestId('range-max').fill('40');
  await page.getByTestId('range-max').press('Enter');
  await page.getByTestId('range-auto').click();
  await expect(page.getByTestId('range-max')).toHaveValue('17.5');
});

test('uniform and tag colours follow Bandage', async ({ page }) => {
  await openSettled(page, repo('testdata/colour_tags.gfa'));
  await showTab(page, 'display');
  const segments = await segmentsOnScreen(page, 4);
  // Segments in file order: red (CL #ff0000), blue (CL blue), plain, bad (CL not a colour).
  const tags: Record<number, number[]> = { 0: [255, 0, 0], 1: [0, 0, 255], 2: [190, 190, 190], 3: [190, 190, 190] };
  await page.getByTestId('color-mode').selectOption('tags');
  for (const [segment, at] of segments) {
    const got = await ribbonColor(page, at.x, at.y);
    expect(near(got, tags[segment] ?? []), `segment ${segment}: ${got.join()}`).toBe(true);
  }
  await page.getByTestId('color-mode').selectOption('uniform');
  for (const [, at] of segments) expect(near(await ribbonColor(page, at.x, at.y), [178, 34, 34])).toBe(true);
});

test('display settings and the theme last across a reload', async ({ page }) => {
  await openSettled(page, repo('testdata/bubble.gfa'));
  await showTab(page, 'display');
  await page.getByTestId('color-mode').selectOption('component');
  await page.getByTestId('double-mode').check();
  await page.getByTestId('theme').click();
  await expect(page.getByTestId('theme')).toHaveAttribute('data-theme-choice', 'light');
  await page.reload();
  await page.getByTestId('open-input').setInputFiles(repo('testdata/bubble.gfa'));
  await expect(page.getByTestId('color-mode')).toHaveValue('component');
  await expect(page.getByTestId('double-mode')).toBeChecked();
  await expect(page.getByTestId('theme')).toHaveAttribute('data-theme-choice', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
