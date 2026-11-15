import type { Context } from './store';

export interface Toast {
  id: number;
  message: string;
  /** Shown behind a "details" expander. */
  details?: string | undefined;
  /** A button in the toast; a toast with one stays until dismissed. */
  action?: { label: string; run: () => void } | undefined;
}

export interface ToastSlice {
  toasts: Toast[];
  toast: (message: string, details?: string, action?: Toast['action']) => void;
  dismissToast: (id: number) => void;
}

/** Older toasts give way so a burst of errors cannot fill the screen. */
const MAX_TOASTS = 4;
/** A toast without details is a confirmation and goes away by itself. */
const CONFIRMATION_MS = 4000;

export function createToastSlice({ set, get }: Context): ToastSlice {
  let nextId = 1;
  return {
    toasts: [],
    toast(message, details, action) {
      const id = nextId++;
      set({ toasts: [...get().toasts, { id, message, details, action }].slice(-MAX_TOASTS) });
      if (details === undefined && action === undefined) {
        setTimeout(() => {
          get().dismissToast(id);
        }, CONFIRMATION_MS);
      }
    },
    dismissToast(id) {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },
  };
}
