import { useEffect, useRef, useState } from 'react';
import { detectBackend, type Backend } from '../engine/detect';
import { Engine } from '../engine/Engine';
import { onSystemThemeChange, systemTheme } from '../state/theme';
import { ParseClient, WorkerTerminatedError } from '../workers/ParseClient';
import { StatusBar, type CoreStatus } from './StatusBar';
import { Unsupported } from './Unsupported';

export function App() {
  const [backend, setBackend] = useState<Backend | 'detecting'>('detecting');
  const [engineError, setEngineError] = useState<string>();
  const [core, setCore] = useState<CoreStatus>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void detectBackend().then((result) => {
      if (!cancelled) setBackend(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const client = new ParseClient();
    client.ping().then(
      (result) => {
        setCore({ state: 'ready', version: result.coreVersion, roundTripMs: result.roundTripMs });
      },
      (error: unknown) => {
        // Termination on unmount rejects the ping; that is not a failure.
        if (error instanceof WorkerTerminatedError) return;
        setCore({ state: 'error', message: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      client.terminate();
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
      <StatusBar backend={backend} core={core} />
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
