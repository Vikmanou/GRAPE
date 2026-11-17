// 200% browser zoom: a window zoomed to 200% lays out at half its width and height, drawn at two
// device pixels per CSS pixel; 1280 by 800 gives the narrow sheet layout, 1920 by 1080 the docked one. Every control in each sidebar tab, the info panel and each
// menu can be scrolled to and is the element under its own centre, so nothing is cut off or covered.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { failOnPageError, gotoApp, repo, segmentsOnScreen, showTab, skipUnlessBackend } from './helpers';

test.use({ deviceScaleFactor: 2 });

const CONTROLS = 'button, a[href], input, select, summary, [role="tab"], [role="menuitem"]';

async function expectReachable(page: Page, scope: Locator, label: string): Promise<void> {
  const controls = await scope.locator(CONTROLS).all();
  let checked = 0;
  for (const control of controls) {
    if (!(await control.isVisible())) continue;
    await control.scrollIntoViewIfNeeded();
    const hit = await control.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const inside = x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight;
      const top = document.elementFromPoint(x, y);
      // A label wrapping a hidden checkbox counts as the control's own target.
      const own =
        top !== null &&
        (el.contains(top) ||
          top.contains(el) ||
          (el instanceof HTMLInputElement && el.labels?.[0]?.contains(top) === true));
      // Scripts can scroll an overflow: hidden box, a person cannot: any ancestor scrolled to
      // bring the control into view must be one the user can scroll too.
      let stuck = false;
      for (let a = el.parentElement; a; a = a.parentElement) {
        const style = getComputedStyle(a);
        const scrolled = a.scrollTop > 0 || a.scrollLeft > 0;
        if (scrolled && (style.overflowY === 'hidden' || style.overflowX === 'hidden')) stuck = true;
      }
      return inside && own && !stuck
        ? ''
        : `${el.outerHTML.slice(0, 120)} at ${String(Math.round(x))},${String(Math.round(y))}`;
    });
    expect(hit, `${label}: control is on screen and not covered`).toBe('');
    checked++;
  }
  expect(checked, `${label}: controls checked`).toBeGreaterThan(0);
}

for (const [width, height] of [
  [640, 400],
  [960, 540],
] as const) {
  test(`at 200% zoom of a ${String(width * 2)} px window every control in the sidebar, the info panel and the menus can be reached`, async ({
    page,
  }) => {
    failOnPageError(page);
    await page.setViewportSize({ width, height });
    await gotoApp(page);
    await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
    await skipUnlessBackend(page);
    await page.getByTestId('open-input').setInputFiles(repo('testdata/tangle.gfa'));
    await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done', { timeout: 60_000 });

    const scroll = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(scroll[0], 'the page does not scroll sideways').toBeLessThanOrEqual(scroll[1] ?? 0);
    await expectReachable(page, page.locator('header.top-bar'), 'top bar');

    const sidebar = page.getByTestId('sidebar');
    if (!(await sidebar.isVisible())) await page.getByTestId('sidebar-open').click();
    for (const tab of ['overview', 'display', 'find', 'paths', 'layout'] as const) {
      await showTab(page, tab);
      await expectReachable(page, sidebar, `${tab} tab`);
    }
    await page.keyboard.press('Escape');

    for (const menu of ['open-menu', 'export-menu', 'share-menu']) {
      const details = page.getByTestId(menu);
      await details.locator('summary').click();
      await expectReachable(page, details.locator('.menu-popup'), menu);
      await details.locator('summary').click();
    }

    const [first] = [...(await segmentsOnScreen(page, 1)).values()];
    if (!first) throw new Error('no segment on screen');
    await page.mouse.click(first.x, first.y);
    const info = page.getByTestId('info-panel');
    await expect(info).toBeVisible();
    await expectReachable(page, info, 'info panel');
  });
}
