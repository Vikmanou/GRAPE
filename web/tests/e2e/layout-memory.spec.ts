// A settled layout gives back the buffers only iterating needs, and a
// refinement builds them again and gives them back again.

import { expect, type Page, test } from '@playwright/test';
import { openSettled, repo } from './helpers';

type Hooks = {
  store: { getState(): { refining: boolean; select(s: Uint32Array, mode: string): void } };
  send(command: unknown): void;
  memory(): Promise<{ gpu: number }>;
};

const gpuBytes = (page: Page) =>
  page.evaluate(async () => (await (window as unknown as { grapeTest: Hooks }).grapeTest.memory()).gpu);

test('a refinement leaves the GPU holding what the settled layout held', async ({ page }) => {
  await openSettled(page, repo('testdata/tangle.gfa'));
  const settled = await gpuBytes(page);
  expect(settled).toBeGreaterThan(0);

  await page.evaluate(() => {
    const hooks = (window as unknown as { grapeTest: Hooks }).grapeTest;
    hooks.store.getState().select(Uint32Array.of(0), 'replace');
    hooks.send({ type: 'relayout-selection' });
  });
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { grapeTest: Hooks }).grapeTest.store.getState().refining))
    .toBe(false);
  expect(await gpuBytes(page)).toBe(settled);
});
