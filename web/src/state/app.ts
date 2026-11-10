import { Engine } from '../engine/Engine';
import { detectBackend } from '../engine/core/detect';
import { GraphClient } from '../workers/graph/GraphClient';
import { LayoutClient } from '../workers/layout/LayoutClient';
import { PackClient } from '../workers/pack/PackClient';
import { SequenceClient } from '../workers/sequence/SequenceClient';
import { handleKey } from './shortcuts';
import { createAppStore, installStore, type AppStore } from './store';
import { persistSettings } from './settings';
import { onSystemThemeChange } from './theme';

export function startApp(): AppStore {
  const store = installStore(
    createAppStore({
      graph: new GraphClient(),
      sequence: new SequenceClient(),
      pack: new PackClient(),
      layoutClient: () => new LayoutClient(),
      createEngine: (host, kind) => Engine.create(host, kind),
      detectBackend: () => detectBackend(),
      search: location.search,
    }),
  );
  const app = store.getState();
  persistSettings(store);
  onSystemThemeChange((theme) => {
    if (store.getState().themeChoice === 'system') store.getState().setTheme(theme);
  });
  app.startCore();
  window.addEventListener('keydown', (event) => {
    if (handleKey(event, store.getState())) event.preventDefault();
  });
  void app.detectRenderer();
  void app.readShareLink(location.hash);
  // A link pasted into a tab already on GRAPE changes only the fragment, without a reload.
  window.addEventListener('hashchange', () => {
    void store.getState().readShareLink(location.hash);
  });
  return store;
}
