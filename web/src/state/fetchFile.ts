/** The file a URL names, from its last path segment, for showing and for saving exports under. */
export function fileNameOf(url: URL): string {
  const last = url.pathname.split('/').filter(Boolean).at(-1);
  try {
    return last ? decodeURIComponent(last) : url.hostname;
  } catch {
    return last ?? url.hostname;
  }
}

/**
 * Downloads `url` straight from the browser, as the user asked: no proxy,
 * no cookies, no referrer. Reports the fraction read when the server gives
 * a length, otherwise undefined.
 */
export async function fetchFile(
  url: URL,
  signal: AbortSignal,
  progress: (fraction: number | undefined) => void,
): Promise<File> {
  let response: Response;
  try {
    response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors' });
  } catch (error) {
    if (signal.aborted) throw error;
    // Browsers report a CORS refusal and an unreachable host alike, with no detail.
    throw new Error(
      `The download did not start. The server may be unreachable, or it does not allow other sites to fetch this file (CORS).`,
      { cause: error },
    );
  }
  if (!response.ok) throw new Error(`The server answered ${String(response.status)} ${response.statusText}`.trim());
  const total = Number(response.headers.get('content-length') ?? NaN);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let read = 0;
  const reader = response.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      read += value.byteLength;
      progress(total > 0 ? Math.min(read / total, 1) : undefined);
    }
  } else {
    chunks.push(new Uint8Array(await response.arrayBuffer()));
  }
  return new File(chunks, fileNameOf(url));
}
