import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { BackendKind } from '../engine/core/detect';
import type { GraphClient } from '../workers/graph/GraphClient';
import type { Topology } from '../workers/protocol/graph';
import type { LayoutOptions, LayoutResponse } from '../workers/protocol/layout';
import type { SequenceClient } from '../workers/sequence/SequenceClient';
import { Bridge, type EngineLike } from './bridge';
import { createDisplaySlice, type DisplaySlice } from './display';
import { createLayoutSlice, type LayoutSlice } from './layout';
import { createFileSlice, type FileSlice } from './load';
import { createSelectionSlice, type SelectionSlice } from './selection';
import { exposeForTests } from './testHooks';
import { createToastSlice, type ToastSlice } from './toasts';

export type GraphService = Pick<
  GraphClient,
  'ping' | 'parse' | 'cancel' | 'info' | 'summary' | 'find' | 'exportRecords'
>;

export type SequenceService = Pick<SequenceClient, 'load' | 'preview' | 'sequence' | 'rawLine' | 'fasta'>;

export interface LayoutService {
  start(
    mode: 'cpu' | 'gpu',
    topology: Topology,
    options: LayoutOptions,
    listener: (response: LayoutResponse) => void,
  ): void;
  pack(boxes: Float32Array<ArrayBuffer>): Promise<Float32Array>;
  cancel(): void;
}

/** What the store reaches outside itself; tests pass fakes. */
export interface Services {
  graph: GraphService;
  sequence: SequenceService;
  layoutClient(): LayoutService;
  createEngine(host: HTMLElement): Promise<EngineLike>;
  detectBackend(): Promise<BackendKind>;
  /** The page's query string, for `?layout=cpu`. */
  search: string;
}

export type AppState = FileSlice & LayoutSlice & DisplaySlice & ToastSlice & SelectionSlice;

export type AppStore = StoreApi<AppState>;

export interface Context {
  set: AppStore['setState'];
  get: AppStore['getState'];
  services: Services;
  bridge: Bridge;
}

export function createAppStore(services: Services): AppStore {
  const ctx = { services } as Context;
  const store = createStore<AppState>()((set, get) => {
    ctx.set = set;
    ctx.get = get;
    return {
      ...createFileSlice(ctx),
      ...createLayoutSlice(ctx),
      ...createDisplaySlice(ctx),
      ...createToastSlice(ctx),
      ...createSelectionSlice(),
    };
  });
  ctx.bridge = new Bridge(ctx, (host) => services.createEngine(host));
  exposeForTests(store, ctx.bridge);
  return store;
}

let appStore: AppStore | undefined;

/** The page's one store; the app installs it before rendering. */
export function installStore(store: AppStore): AppStore {
  appStore = store;
  return store;
}

export function useApp<T>(selector: (state: AppState) => T): T {
  if (!appStore) throw new Error('the store is not installed');
  return useStore(appStore, selector);
}
