import { useCallback, useEffect, useRef, useState } from 'react';
import { ParseClient, WorkerTerminatedError } from '../workers/ParseClient';
import type { ParseResult } from '../workers/protocol';

export interface FileInfo {
  name: string;
  size: number;
}

export type LoadState =
  | { state: 'idle' }
  | { state: 'parsing'; file: FileInfo; fraction: number }
  | { state: 'loaded'; file: FileInfo; result: ParseResult }
  | { state: 'failed'; file: FileInfo; message: string };

export type CoreStatus =
  | { state: 'loading' }
  | { state: 'ready'; version: string; roundTripMs: number }
  | { state: 'error'; message: string };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The parse worker's lifecycle and the current file's load state. */
export function useLoader() {
  const client = useRef<ParseClient>(null);
  const parsing = useRef(false);
  const [core, setCore] = useState<CoreStatus>({ state: 'loading' });
  const [load, setLoad] = useState<LoadState>({ state: 'idle' });

  useEffect(() => {
    const created = new ParseClient();
    client.current = created;
    created.ping().then(
      (r) => {
        setCore({ state: 'ready', version: r.coreVersion, roundTripMs: r.roundTripMs });
      },
      (error: unknown) => {
        if (!(error instanceof WorkerTerminatedError)) setCore({ state: 'error', message: message(error) });
      },
    );
    return () => {
      created.terminate();
      client.current = null;
    };
  }, []);

  const open = useCallback((file: File) => {
    const parser = client.current;
    if (!parser) return;
    // A newer file replaces one still parsing.
    if (parsing.current) parser.cancel();
    parsing.current = true;
    const info = { name: file.name, size: file.size };
    setLoad({ state: 'parsing', file: info, fraction: 0 });
    parser
      .parse(file, (bytesRead, totalBytes) => {
        setLoad({ state: 'parsing', file: info, fraction: totalBytes > 0 ? bytesRead / totalBytes : 0 });
      })
      .then(
        (result) => {
          parsing.current = false;
          setLoad({ state: 'loaded', file: info, result });
        },
        (error: unknown) => {
          if (error instanceof WorkerTerminatedError) return;
          parsing.current = false;
          setLoad({ state: 'failed', file: info, message: message(error) });
        },
      );
  }, []);

  const cancel = useCallback(() => {
    client.current?.cancel();
    parsing.current = false;
    setLoad({ state: 'idle' });
  }, []);

  return { core, load, open, cancel };
}
