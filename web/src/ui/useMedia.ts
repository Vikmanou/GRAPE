import { useSyncExternalStore } from 'react';

/** Whether a media query matches now, and again when it changes. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => {
        list.removeEventListener('change', notify);
      };
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Below this width the sidebar and the info panel become bottom sheets (sheets.css). */
export const SHEET_QUERY = '(max-width: 899px)';
