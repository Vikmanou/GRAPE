// Parse worker: owns the WASM module that parses GFA and runs graph
// algorithms, so heavy work never blocks the main thread.

import init, { coreVersion, countLines } from '../wasm/pkg/gfa_wasm';
import wasmUrl from '../wasm/pkg/gfa_wasm_bg.wasm?url';
import type { ParseRequest, ParseResponse } from './protocol';

const ready = init({ module_or_path: wasmUrl });

function post(message: ParseResponse): void {
  self.postMessage(message);
}

async function handle(request: ParseRequest): Promise<void> {
  try {
    await ready;
    post({
      type: 'pong',
      id: request.id,
      coreVersion: coreVersion(),
      lines: countLines(request.sample),
    });
  } catch (error) {
    post({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

self.addEventListener('message', (event: MessageEvent<ParseRequest>) => {
  void handle(event.data);
});
