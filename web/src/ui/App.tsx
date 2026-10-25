import { useCallback, useEffect, useState } from 'react';
import { detectBackend, type Backend } from '../engine/detect';
import type { Engine } from '../engine/Engine';
import { DEFAULT_OPTIONS, useLayout } from '../state/layout';
import type { LayoutOptions } from '../workers/protocol';
import { useLoader } from '../state/load';
import { EmptyState } from './EmptyState';
import { EngineHost } from './EngineHost';
import { LayoutControls } from './LayoutControls';
import { usePanelInsets } from './insets';
import { Overview } from './Overview';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import { Unsupported } from './Unsupported';
import { Warnings } from './Warnings';

export function App() {
  const [backend, setBackend] = useState<Backend | 'detecting'>('detecting');
  const [engineError, setEngineError] = useState<string>();
  const [showWarnings, setShowWarnings] = useState(false);
  const { core, load, open, cancel } = useLoader();
  const openFile = useCallback(
    (file: File) => {
      setShowWarnings(false);
      open(file);
    },
    [open],
  );
  const dragging = useFileDrop(openFile);
  const [engine, setEngine] = useState<Engine>();
  const [fps, setFps] = useState<number>();
  useEffect(
    () =>
      engine?.on((event) => {
        if (event.type === 'frame-stats') setFps(event.fps);
        if (event.type === 'error') console.error(`GPU error: ${event.message}`);
      }),
    [engine],
  );
  const resetFps = useCallback(() => {
    setFps(undefined);
  }, []);
  const [layoutOptions, setLayoutOptions] = useState<LayoutOptions>(DEFAULT_OPTIONS);
  const gpuLayout = backend === 'webgpu';
  const layout = useLayout(
    load.state === 'loaded' ? load.result.topology : undefined,
    engine,
    gpuLayout,
    layoutOptions,
    resetFps,
  );
  usePanelInsets(engine, load.state);

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
  const file = load.state === 'idle' ? undefined : load.file;

  return (
    <main className="app">
      {backend === 'webgpu' && !engineError && <EngineHost onError={setEngineError} onEngine={setEngine} />}
      <TopBar file={file} onOpen={openFile} />
      {unsupported && <Unsupported detail={engineError} />}
      {!unsupported && (load.state === 'idle' || load.state === 'parsing') && <EmptyState dragging={dragging} />}
      {load.state === 'failed' && (
        <div className="load-error" role="alert" data-testid="load-error">
          <strong>Could not open {load.file.name}</strong>
          <p>{load.message}</p>
        </div>
      )}
      {load.state === 'loaded' && (
        <Overview result={load.result}>
          <LayoutControls
            options={layoutOptions}
            status={layout.status}
            paused={layout.paused}
            canPause={gpuLayout}
            onOptions={setLayoutOptions}
            onPause={layout.setPaused}
          />
        </Overview>
      )}
      {load.state === 'loaded' && showWarnings && (
        <Warnings
          warnings={load.result.warnings}
          onClose={() => {
            setShowWarnings(false);
          }}
        />
      )}
      <StatusBar
        backend={backend}
        core={core}
        load={load}
        layout={layout.status}
        paused={layout.paused}
        fps={fps}
        onCancel={cancel}
        onToggleWarnings={() => {
          setShowWarnings((shown) => !shown);
        }}
      />
    </main>
  );
}

/** Accepts a file dropped anywhere on the page; returns whether one is being dragged. */
function useFileDrop(onDrop: (file: File) => void): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer?.files[0];
      if (file) onDrop(file);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [onDrop]);
  return dragging;
}
