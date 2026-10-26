import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../state/store';
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
  const renderer = useApp((s) => s.renderer);
  const engineError = useApp((s) => s.engineError);
  const load = useApp((s) => s.load);
  const open = useApp((s) => s.open);
  const [showWarnings, setShowWarnings] = useState(false);
  const openFile = useCallback(
    (file: File) => {
      setShowWarnings(false);
      open(file);
    },
    [open],
  );
  const dragging = useFileDrop(openFile);
  usePanelInsets(load.state);

  const unsupported = renderer === 'none' || engineError !== undefined;
  const file = load.state === 'idle' ? undefined : load.file;

  return (
    <main className="app">
      {renderer === 'webgpu' && !engineError && <EngineHost />}
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
          <LayoutControls />
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
