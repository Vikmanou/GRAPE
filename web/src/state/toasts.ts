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
/** A toast without details is a confirmation and goes away by itself. */
const CONFIRMATION_MS = 4000;

export function createToastSlice({ set, get }: Context): ToastSlice {
  let nextId = 1;
  return {
    toasts: [],
    toast(message, details) {
      const id = nextId++;
      set({ toasts: [...get().toasts, { id, message, details }].slice(-MAX_TOASTS) });
      if (details === undefined) {
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
