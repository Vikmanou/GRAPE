import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { BackendKind } from '../engine/core/detect';
import type { GraphClient } from '../workers/graph/GraphClient';
import type { Topology } from '../workers/protocol/graph';
import type { LayoutControl, LayoutOptions, LayoutResponse } from '../workers/protocol/layout';
import type { WithoutId, WorkerMemory } from '../workers/rpc';
import type { SequenceClient } from '../workers/sequence/SequenceClient';
import { Bridge, type EngineLike } from './bridge';
import { createDetailsSlice, type DetailsSlice } from './details';
import { createDisplaySlice, type DisplaySlice } from './display';
import { createDisplayOptionsSlice, type DisplayOptionsSlice } from './displayOptions';
import { createLabelSlice, type LabelSlice } from './labels';
import { createLayoutSlice, type LayoutSlice } from './layout';
import { createFindSlice, type FindSlice } from './find';
import { createFileSlice, type FileSlice } from './load';
import { createSelectionSlice, type SelectionSlice } from './selection';
import { exposeForTests } from './testHooks';
import { createToastSlice, type ToastSlice } from './toasts';

export type GraphService = Pick<
  GraphClient,
  'ping' | 'parse' | 'cancel' | 'info' | 'summary' | 'find' | 'exportRecords' | 'labelSizes' | 'labelText' | 'memory'
>;

export type SequenceService = Pick<SequenceClient, 'load' | 'preview' | 'sequence' | 'rawLine' | 'fasta' | 'memory'>;

export interface LayoutService {
  start(
    mode: 'cpu' | 'gpu',
    topology: Topology,
    options: LayoutOptions,
    listener: (response: LayoutResponse) => void,
  ): void;
  pack(boxes: Float32Array<ArrayBuffer>): Promise<Float32Array>;
  /** Steers a running CPU layout. */
  send(request: WithoutId<LayoutControl>): void;
  memory(): Promise<WorkerMemory>;
  cancel(): void;
}

/** What the store reaches outside itself; tests pass fakes. */
export interface Services {
  graph: GraphService;
  sequence: SequenceService;
  layoutClient(): LayoutService;
  createEngine(host: HTMLElement, kind: 'webgpu' | 'webgl2'): Promise<EngineLike>;
  detectBackend(): Promise<BackendKind>;
  /** The page's query string, for `?layout=cpu` and `?renderer=webgl2`. */
  search: string;
}

export type AppState = FileSlice &
  LayoutSlice &
  DisplaySlice &
  DisplayOptionsSlice &
  ToastSlice &
  SelectionSlice &
  DetailsSlice &
  FindSlice &
  LabelSlice;

export type AppStore = StoreApi<AppState>;

export interface Context {
  set: AppStore['setState'];
  get: AppStore['getState'];
  services: Services;
  bridge: Bridge;
  /** The running layout's worker, if any. */
  layout?: LayoutService | undefined;
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
      ...createDisplayOptionsSlice(ctx),
      ...createToastSlice(ctx),
      ...createSelectionSlice(ctx),
      ...createDetailsSlice(ctx),
      ...createFindSlice(ctx),
      ...createLabelSlice(ctx),
    };
  });
  ctx.bridge = new Bridge(ctx, (host) => {
    const { renderer } = ctx.get();
    return services.createEngine(host, renderer === 'webgpu' ? 'webgpu' : 'webgl2');
  });
  exposeForTests(store, ctx);
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
