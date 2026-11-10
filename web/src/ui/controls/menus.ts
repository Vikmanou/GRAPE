import { useEffect } from 'react';

function openMenus(): HTMLDetailsElement[] {
  return Array.from(document.querySelectorAll<HTMLDetailsElement>('details.menu[open]'));
}

/**
 * The top bar's menus (`details.menu`) act as one group: opening one closes
 * the others, and a press outside the open one or Escape closes it.
 */
export function useMenuGroup(): void {
  useEffect(() => {
    // `toggle` does not bubble, so it is caught on the way down.
    const onToggle = (event: Event) => {
      const menu = event.target;
      if (!(menu instanceof HTMLDetailsElement) || !menu.open || !menu.classList.contains('menu')) return;
      for (const other of openMenus()) if (other !== menu) other.open = false;
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      for (const menu of openMenus()) if (!menu.contains(target)) menu.open = false;
    };
    // Before the app's shortcuts, so Escape only closes the menu.
    const onKeyDown = (event: KeyboardEvent) => {
      const menus = openMenus();
      if (event.key !== 'Escape' || menus.length === 0) return;
      for (const menu of menus) menu.open = false;
      menus[0]?.querySelector('summary')?.focus();
      event.stopPropagation();
    };
    document.addEventListener('toggle', onToggle, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('toggle', onToggle, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);
}
