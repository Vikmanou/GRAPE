import type { KeyboardEvent } from 'react';

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href], [tabindex="0"]';
const FIELDS = ['INPUT', 'SELECT', 'TEXTAREA'];

/**
 * Key handling for a bottom sheet: Tab wraps inside it and Escape closes it, then puts focus back
 * where `restore` points. A field keeps its own Escape, which leaves the field first.
 */
export function sheetKeys(onClose: () => void, restore: () => HTMLElement | null) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      if (FIELDS.includes((event.target as HTMLElement).tagName)) return;
      event.stopPropagation();
      onClose();
      requestAnimationFrame(() => restore()?.focus());
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null,
    );
    const [first, last] = [items[0], items[items.length - 1]];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
}

/** The sidebar's way back: its open button when it is closed, else its selected tab. */
export function sidebarControl(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-testid="sidebar-open"], [data-testid="sidebar"] [role="tab"][aria-selected="true"]',
  );
}
