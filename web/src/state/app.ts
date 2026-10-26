import { Engine } from '../engine/Engine';
import { detectBackend } from '../engine/core/detect';
import { GraphClient } from '../workers/graph/GraphClient';
import { LayoutClient } from '../workers/layout/LayoutClient';
import { createAppStore, installStore, type AppStore } from './store';
import { onSystemThemeChange, systemTheme } from './theme';

export function startApp(): AppStore {
  const store = installStore(
    createAppStore({
      graph: new GraphClient(),
      layoutClient: () => new LayoutClient(),
      createEngine: (host) => Engine.create(host),
      detectBackend: () => detectBackend(),
      search: location.search,
    }),
  );
  const app = store.getState();
  app.setTheme(systemTheme());
  onSystemThemeChange(app.setTheme);
  app.startCore();
  void app.detectRenderer();
  return store;
}
