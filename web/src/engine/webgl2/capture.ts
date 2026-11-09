/** Resolves once the GPU has passed `sync`, polling so the main thread never waits on it. */
export async function signalled(gl: WebGL2RenderingContext, sync: WebGLSync | null): Promise<void> {
  while (sync && gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  if (gl.isContextLost()) throw new Error('the WebGL context was lost');
}

/**
 * Runs `draw` into an offscreen RGBA8 target of `width × height` and reads it
 * back through a pixel buffer, as RGBA8 rows from the top.
 */
export async function capture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  draw: () => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const target = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, target);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, width, height);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, target);
  gl.viewport(0, 0, width, height);
  draw();
  const row = width * 4;
  const staging = gl.createBuffer();
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, staging);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, row * height, gl.STREAM_READ);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(framebuffer);
  gl.deleteRenderbuffer(target);
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  try {
    await signalled(gl, sync);
    const bottomUp = new Uint8Array(row * height);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, staging);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, bottomUp);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    // GL counts rows from the bottom.
    const out = new Uint8Array(row * height);
    for (let y = 0; y < height; y++) out.set(bottomUp.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    return out;
  } finally {
    gl.deleteSync(sync);
    gl.deleteBuffer(staging);
  }
}
