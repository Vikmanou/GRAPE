// Keyboard navigation: the top bar is reachable in order with a visible focus, and the sidebar tabs
// move with the arrow keys.

import { expect, test, type Page } from '@playwright/test';
import { failOnPageError, gotoApp, repo, skipUnlessBackend } from './helpers';

async function open(page: Page): Promise<void> {
  failOnPageError(page);
  await page.setViewportSize({ width: 1200, height: 750 });
  await gotoApp(page);
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await skipUnlessBackend(page);
  await page.getByTestId('open-input').setInputFiles(repo('testdata/tangle.gfa'));
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
}

/** The test id of the focused element, or of the menu or tab that holds it, and whether a focus ring shows. */
async function focused(page: Page): Promise<{ id: string; ring: boolean }> {
  return page.evaluate(() => {
    const el = document.activeElement;
    const holder = el?.closest('[data-testid]');
    const style = el ? getComputedStyle(el) : undefined;
    const ring = style !== undefined && style.outlineStyle !== 'none' && style.outlineWidth !== '0px';
    return { id: holder?.getAttribute('data-testid') ?? el?.tagName ?? '', ring };
  });
}

test('the top bar is reachable in order and every stop shows a focus ring', async ({ page }) => {
  await open(page);
  await page
    .getByTestId('engine-canvas')
    .focus()
    .catch(() => undefined);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  const wanted = ['open-file', 'open-menu', 'export-menu', 'share-menu', 'theme', 'help'];
  const seen: string[] = [];
  for (let i = 0; i < 12 && seen.length < wanted.length; i++) {
    await page.keyboard.press('Tab');
    const stop = await focused(page);
    if (wanted.includes(stop.id) && seen.at(-1) !== stop.id) {
      seen.push(stop.id);
      expect(stop.ring, `${stop.id} shows a focus ring`).toBe(true);
    }
  }
  expect(seen).toEqual(wanted);
});

test('the sidebar tabs move with the arrow keys, wrapping at the ends', async ({ page }) => {
  await open(page);
  await page.getByTestId('tab-overview').focus();
  const order = ['display', 'find', 'paths', 'overview'];
  for (const tab of order) {
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId(`tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId(`tab-${tab}`)).toBeFocused();
  }
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('tab-paths')).toHaveAttribute('aria-selected', 'true');
});
