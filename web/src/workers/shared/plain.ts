// wasm-bindgen copies results out of WASM memory onto plain ArrayBuffers.
export function plain<T extends ArrayBufferLike>(array: Uint32Array<T>): Uint32Array<ArrayBuffer>;
export function plain<T extends ArrayBufferLike>(array: Float32Array<T>): Float32Array<ArrayBuffer>;
export function plain<T extends ArrayBufferLike>(array: Uint8Array<T>): Uint8Array<ArrayBuffer>;
export function plain<T extends ArrayBufferLike>(array: Float64Array<T>): Float64Array<ArrayBuffer>;
export function plain(array: Uint32Array | Float32Array | Float64Array | Uint8Array): ArrayBufferView<ArrayBuffer> {
  if (!(array.buffer instanceof ArrayBuffer)) throw new Error('expected a plain ArrayBuffer');
  return array as ArrayBufferView<ArrayBuffer>;
}
