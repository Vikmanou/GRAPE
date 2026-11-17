// What a screen reader and a keyboard user meet: every control has a name, ids
// are unique, and the control in focus is visible. Contrast is in
// tests/unit/tokens.test.ts.

import { expect, type Page, test } from '@playwright/test';
import { openSettled, repo, showTab } from './helpers';

/** Controls with no text, label or title a screen reader could speak, and ids used twice. */
async function problems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const visible = (e: Element) => e.getClientRects().length > 0;
    const named = (e: Element): boolean => {
      if (e.getAttribute('aria-label')?.trim()) return true;
      const by = e.getAttribute('aria-labelledby');
      if (by && by.split(/\s+/).some((id) => document.getElementById(id)?.textContent.trim())) return true;
      if (e instanceof HTMLInputElement || e instanceof HTMLSelectElement || e instanceof HTMLTextAreaElement)
        if (e.labels && [...e.labels].some((l) => l.textContent.trim())) return true;
      if (e.textContent.trim()) return true;
      return Boolean(e.getAttribute('title')?.trim());
    };
    const controls = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab]';
    for (const e of document.querySelectorAll(controls)) {
      if (visible(e) && !named(e)) found.push(`no name: ${e.outerHTML.slice(0, 120)}`);
    }
    for (const e of document.querySelectorAll('img')) {
      if (!e.hasAttribute('alt')) found.push(`image without alt: ${e.outerHTML.slice(0, 80)}`);
    }
    const seen = new Set<string>();
    for (const e of document.querySelectorAll('[id]')) {
      if (seen.has(e.id)) found.push(`id used twice: ${e.id}`);
      seen.add(e.id);
    }
    if (!document.documentElement.lang) found.push('html has no lang');
    return found;
  });
}

test('every control has a name in each tab, with a selection and in the help overlay', async ({ page }) => {
  await openSettled(page, repo('testdata/linear.gfa'));
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<button data-probe></button>');
  });
  expect((await problems(page)).join()).toContain('data-probe');
  await page.evaluate(() => {
    document.querySelector('[data-probe]')?.remove();
  });
  const all: string[] = [];
  for (const tab of ['overview', 'display', 'find', 'paths'] as const) {
    await showTab(page, tab);
    all.push(...(await problems(page)).map((p) => `${tab}: ${p}`));
  }
  await page.evaluate(() => {
    type Store = { getState(): { select(s: Uint32Array, mode: string): void } };
    (window as unknown as { grapeTest: { store: Store } }).grapeTest.store
      .getState()
      .select(Uint32Array.of(1), 'replace');
  });
  await expect(page.getByTestId('info-panel')).toBeVisible();
  all.push(...(await problems(page)).map((p) => `selection: ${p}`));
  await page.keyboard.press('?');
  all.push(...(await problems(page)).map((p) => `help: ${p}`));
  expect(all).toEqual([]);
});

test('the focused control is outlined while tabbing through the shell', async ({ page }) => {
  await openSettled(page, repo('testdata/linear.gfa'));
  const unseen: string[] = [];
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return undefined;
      const style = getComputedStyle(e);
      const outlined = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1;
      const ring = style.boxShadow !== 'none';
      return { label: e.outerHTML.slice(0, 80), visible: outlined || ring };
    });
    if (outline && !outline.visible) unseen.push(outline.label);
  }
  expect(unseen).toEqual([]);
});

test('a selection is announced through a live region that is there before it', async ({ page }) => {
  await openSettled(page, repo('testdata/linear.gfa'));
  const heard = page.getByTestId('selection-heard');
  await expect(heard).toHaveAttribute('aria-live', 'polite');
  await expect(heard).toHaveText('');
  await showTab(page, 'find');
  await page.getByTestId('find-input').fill('2');
  await page.getByTestId('find-input').press('Enter');
  await expect(heard).toHaveText('Segment 2 selected');
  await page.getByRole('button', { name: 'Clear the selection' }).click();
  await expect(heard).toHaveText('');
});
