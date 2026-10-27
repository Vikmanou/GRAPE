// Find by name, list or regex. Needs a WebGPU adapter, so it runs under
// `npm run check:headed` and skips elsewhere.

import { expect, type Page, test } from '@playwright/test';
import { appState, openSettled, repo, showTab } from './helpers';

async function find(page: Page, text: string, regex = false): Promise<void> {
  await showTab(page, 'find');
  await page.getByTestId('find-regex').setChecked(regex);
  await page.getByTestId('find-input').fill(text);
  await page.getByTestId('find-input').press('Enter');
}

test('a list of names selects and frames those found and lists the rest', async ({ page }) => {
  await openSettled(page, repo('testdata/tangle.gfa'));
  await expect.poll(async () => (await appState(page)).zoom).toBeDefined();
  const fitted = (await appState(page)).zoom ?? 0;
  await find(page, 'a, r\nnope');
  await expect(page.getByTestId('find-result')).toContainText('Selected 2 segments.');
  await expect(page.getByTestId('find-missing')).toHaveText('nope');
  await expect.poll(async () => (await appState(page)).selection.count).toBe(2);
  await expect.poll(async () => (await appState(page)).zoom).not.toBe(fitted);
});

test('a regex selects every name it matches', async ({ page }) => {
  await openSettled(page, repo('testdata/tangle.gfa'));
  await find(page, '^[a-c]$', true);
  await expect(page.getByTestId('find-result')).toContainText('Selected 3 segments.');
  await expect.poll(async () => (await appState(page)).selection.count).toBe(3);
});

test('a bad regex says why and selects nothing', async ({ page }) => {
  await openSettled(page, repo('testdata/tangle.gfa'));
  await find(page, 'a(', true);
  await expect(page.getByTestId('find-result')).toContainText('Not a valid regular expression');
  expect((await appState(page)).selection.count).toBe(0);
});
