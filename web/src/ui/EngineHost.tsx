import { useEffect, useRef } from 'react';
import { useApp } from '../state/store';

/** An empty host element; the engine creates and owns the canvas inside it. */
export function EngineHost() {
  const hostRef = useRef<HTMLDivElement>(null);
  const attach = useApp((s) => s.attachEngine);
  const detach = useApp((s) => s.detachEngine);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    void attach(host);
    return detach;
  }, [attach, detach]);

  return <div ref={hostRef} className="engine-host" data-testid="engine-host" />;
}
