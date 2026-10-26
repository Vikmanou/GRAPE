import type { Context } from './store';

export interface Toast {
  id: number;
  message: string;
  /** Shown behind a "details" expander. */
  details?: string | undefined;
}

export interface ToastSlice {
  toasts: Toast[];
  toast: (message: string, details?: string) => void;
  dismissToast: (id: number) => void;
}

/** Older toasts give way so a burst of errors cannot fill the screen. */
const MAX_TOASTS = 4;

export function createToastSlice({ set, get }: Context): ToastSlice {
  let nextId = 1;
  return {
    toasts: [],
    toast(message, details) {
      set({ toasts: [...get().toasts, { id: nextId++, message, details }].slice(-MAX_TOASTS) });
    },
    dismissToast(id) {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },
  };
}
