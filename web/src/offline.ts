/** Registers the worker that keeps the app available without a network; only in a production build. */
export function registerOffline(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error: unknown) => {
      console.warn('The offline copy could not be set up', error);
    });
  });
}
