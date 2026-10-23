import { useEffect, useRef, useState } from 'react';
import { detectBackend, type Backend } from '../engine/detect';
import { Engine } from '../engine/Engine';
import { onSystemThemeChange, systemTheme } from '../state/theme';
import { StatusBar } from './StatusBar';
import { Unsupported } from './Unsupported';

export function App() {
  const [backend, setBackend] = useState<Backend | 'detecting'>('detecting');
  const [engineError, setEngineError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void detectBackend().then((result) => {
      if (!cancelled) setBackend(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const unsupported = backend === 'none' || engineError !== undefined;

  return (
    <main className="app">
      {backend === 'webgpu' && !engineError && <EngineHost onError={setEngineError} />}
      {unsupported ? (
        <Unsupported detail={engineError} />
      ) : (
        <p className="empty-note">Files are processed on your computer and never uploaded.</p>
      )}
      <StatusBar backend={backend} />
    </main>
  );
}

interface EngineHostProps {
  onError: (message: string) => void;
}

/** Mounts an empty host element; the engine creates and owns the canvas. */
function EngineHost({ onError }: EngineHostProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let engine: Engine | undefined;
    let cancelled = false;
    let unsubscribeTheme: (() => void) | undefined;

    Engine.create(host).then(
      (created) => {
        if (cancelled) {
          created.destroy();
          return;
        }
        engine = created;
        engine.on((event) => {
          if (event.type === 'device-lost') onError(`GPU device lost: ${event.message}`);
        });
        engine.send({ type: 'set-theme', theme: systemTheme() });
        unsubscribeTheme = onSystemThemeChange((theme) => {
          engine?.send({ type: 'set-theme', theme });
        });
      },
      (error: unknown) => {
        if (!cancelled) onError(error instanceof Error ? error.message : String(error));
      },
    );

    return () => {
      cancelled = true;
      unsubscribeTheme?.();
      engine?.destroy();
    };
  }, [onError]);

  return <div ref={hostRef} className="engine-host" data-testid="engine-host" />;
}
