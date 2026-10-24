import { useEffect, useRef } from 'react';
import { Engine } from '../engine/Engine';
import { onSystemThemeChange, systemTheme } from '../state/theme';

interface Props {
  onError: (message: string) => void;
}

/** An empty host element; the engine creates and owns the canvas. */
export function EngineHost({ onError }: Props) {
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
