import { Engine } from '../engine/Engine';
import { detectBackend } from '../engine/core/detect';
import { GraphClient } from '../workers/graph/GraphClient';
import { LayoutClient } from '../workers/layout/LayoutClient';
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
      layoutClient: () => new LayoutClient(),
      createEngine: (host) => Engine.create(host),
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
  return store;
}
