import { type Camera, type Insets, NO_INSETS } from '../engine/core/camera';
import type { BackendKind } from '../engine/core/detect';
import type { Theme } from '../engine/style/palette';
import type { Context } from './store';

export type SidebarTab = 'overview' | 'display' | 'find';

export interface DisplaySlice {
  renderer: BackendKind | 'detecting';
  /** Set when the engine could not start or lost its device. */
  engineError: string | undefined;
  theme: Theme;
  /** The GPU runs the layout; `?layout=cpu` draws the CPU reference instead. */
  gpuLayout: boolean;
  /** Frames per second over the last second of continuous drawing. */
  fps: number | undefined;
  /** CSS pixels of the canvas covered by panels, kept clear when fitting. */
  insets: Insets;
  /** The engine's camera, mirrored at most ten times a second. */
  camera: Camera | undefined;
  sidebar: { open: boolean; tab: SidebarTab };
  showSidebar: (tab: SidebarTab) => void;
  toggleSidebar: () => void;
  /** Whether the info panel shows while something is selected. */
  infoOpen: boolean;
  toggleInfo: () => void;
  /** The Find panel should take focus when it next renders. */
  findFocus: boolean;
  focusFind: () => void;
  findFocused: () => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  fit: () => void;
  /** Pans by fractions of the view. */
  panView: (fx: number, fy: number) => void;
  zoomView: (factor: number) => void;
  detectRenderer: () => Promise<void>;
  attachEngine: (host: HTMLElement) => Promise<void>;
  detachEngine: () => void;
  engineFailed: (message: string) => void;
  setTheme: (theme: Theme) => void;
  setInsets: (insets: Insets) => void;
}

export function createDisplaySlice(ctx: Context): DisplaySlice {
  const { set, get, services } = ctx;
  return {
    renderer: 'detecting',
    engineError: undefined,
    theme: 'light',
    gpuLayout: false,
    fps: undefined,
    insets: NO_INSETS,
    camera: undefined,
    sidebar: { open: true, tab: 'overview' },

    showSidebar(tab) {
      set({ sidebar: { open: true, tab } });
    },

    toggleSidebar() {
      const { sidebar } = get();
      set({ sidebar: { ...sidebar, open: !sidebar.open } });
    },

    infoOpen: true,
    toggleInfo() {
      set({ infoOpen: !get().infoOpen });
    },

    findFocus: false,
    focusFind() {
      set({ sidebar: { open: true, tab: 'find' }, findFocus: true });
    },
    findFocused() {
      set({ findFocus: false });
    },

    shortcutsOpen: false,
    setShortcutsOpen(shortcutsOpen) {
      set({ shortcutsOpen });
    },

    fit() {
      ctx.bridge.send({ type: 'fit' });
    },
    panView(fx, fy) {
      ctx.bridge.send({ type: 'pan-view', fx, fy });
    },
    zoomView(factor) {
      ctx.bridge.send({ type: 'zoom-view', factor });
    },

    async detectRenderer() {
      const renderer = await services.detectBackend();
      const cpu = new URLSearchParams(services.search).get('layout') === 'cpu';
      set({ renderer, gpuLayout: renderer === 'webgpu' && !cpu });
      get().restartLayout();
    },

    async attachEngine(host) {
      try {
        if (await ctx.bridge.attach(host)) get().restartLayout();
      } catch (error) {
        set({ engineError: error instanceof Error ? error.message : String(error) });
      }
    },

    detachEngine() {
      ctx.bridge.detach();
      get().stopLayout();
    },

    engineFailed(message) {
      set({ engineError: message });
      get().detachEngine();
    },

    setTheme(theme) {
      set({ theme });
      ctx.bridge.send({ type: 'set-theme', theme });
    },

    setInsets(insets) {
      set({ insets });
      ctx.bridge.send({ type: 'set-insets', insets });
    },
  };
}
