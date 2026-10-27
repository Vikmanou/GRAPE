// The id texture against a CPU rasteriser of the same capsules: every texel
// whose centre is clearly inside or outside every capsule holds the id of the
// last piece drawn over it. Picker reads single texels of the same texture.

import { DEFAULT_DISPLAY } from '../../src/engine/style/display';
import { Buffers, readBuffer } from '../../src/engine/webgpu/layout/gpu';
import type { Kernels } from '../../src/engine/webgpu/layout/kernels';
import { idView, Picker } from '../../src/engine/webgpu/pick';
import { ID_FORMAT, Renderer, type View } from '../../src/engine/webgpu/renderer';
import { assert, plainSegments, random } from './reference';

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const [dx, dy] = [bx - ax, by - ay];
  const length2 = dx * dx + dy * dy;
  const t = length2 > 1e-12 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export async function picking(device: GPUDevice, kernels: Kernels): Promise<void> {
  const next = random(11);
  const pieceCount = 400;
  const positions = Float32Array.from({ length: pieceCount * 4 }, () => next() * 240 - 120);
  const pieces = Uint32Array.from({ length: pieceCount * 2 }, (_, k) => (k % 2 === 0 ? k : Math.floor(k / 6)));
  const segments = Math.ceil(pieceCount / 3);
  const view: View = {
    centerX: 0.37,
    centerY: -0.21,
    zoom: 2,
    width: 400,
    height: 300,
    ribbonHalf: 2.5,
    linkHalf: 0.75,
    linkAlpha: 0,
    linkColor: [0, 0, 0, 1],
    outline: [0, 0, 1, 1],
    hoverOutline: [0, 0, 1, 0.5],
    outlineWidth: 1,
    hover: undefined,
    strand: 0,
  };
  const ids = idView(view);
  // Texture copy rows are multiples of 256 bytes.
  const rowBytes = Math.ceil((ids.width * 4) / 256) * 256;
  device.pushErrorScope('validation');
  const renderer = new Renderer(device, 'rgba8unorm', kernels);
  const picker = new Picker(device);
  const buffers = new Buffers(device);
  try {
    renderer.setGeometry(
      {
        segments,
        points: pieceCount * 2,
        pieces,
        links: new Uint32Array(0),
        segmentStarts: new Uint32Array(segments),
        segmentPieces: new Uint8Array(segments),
      },
      plainSegments(segments),
      1,
    );
    // The capsules have no chains to measure, so none may turn into a dot.
    renderer.setStyle({ theme: 'light', display: { ...DEFAULT_DISPLAY, spritePx: 0 } });
    renderer.setPositions(positions);
    const texture = device.createTexture({
      size: { width: ids.width, height: ids.height },
      format: ID_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const readback = buffers.storage('ids', rowBytes * ids.height);
    const encoder = device.createCommandEncoder();
    renderer.cull(encoder, view);
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store' }],
    });
    renderer.drawIds(pass, ids);
    pass.end();
    encoder.copyTextureToBuffer(
      { texture },
      { buffer: readback, bytesPerRow: rowBytes },
      { width: ids.width, height: ids.height },
    );
    device.queue.submit([encoder.finish()]);
    const texels = new Uint32Array(await readBuffer(device, readback));
    const error = await device.popErrorScope();
    assert(!error, `validation: ${error?.message ?? ''}`);
    texture.destroy();

    const half = Math.max(view.ribbonHalf, 0.5 / ids.zoom);
    const margin = 0.02;
    let checked = 0;
    let covered = 0;
    for (let ty = 0; ty < ids.height; ty++) {
      for (let tx = 0; tx < ids.width; tx++) {
        const wx = view.centerX + (tx + 0.5 - ids.width / 2) / ids.zoom;
        const wy = view.centerY + (ty + 0.5 - ids.height / 2) / ids.zoom;
        let want = 0;
        let ambiguous = false;
        for (let i = 0; i < pieceCount; i++) {
          const p = (k: number) => positions[i * 4 + k] ?? 0;
          const d = distanceToSegment(wx, wy, p(0), p(1), p(2), p(3));
          if (Math.abs(d - half) < margin) ambiguous = true;
          if (d < half) want = (pieces[i * 2 + 1] ?? 0) + 1;
        }
        if (ambiguous) continue;
        checked++;
        if (want) covered++;
        const got = texels[ty * (rowBytes / 4) + tx];
        assert(got === want, `texel ${tx},${ty}: id ${got}, expected ${want}`);
      }
    }
    assert(covered > checked / 10 && covered < checked, `${covered} of ${checked} texels covered`);

    for (const [x, y] of [
      [10, 10],
      [200, 150],
      [399, 299],
      [123, 45],
      [301, 222],
    ] as const) {
      const pickEncoder = device.createCommandEncoder();
      renderer.cull(pickEncoder, view);
      const staging = picker.staging();
      assert(picker.encode(pickEncoder, renderer, view, x, y, staging), `pick ${x},${y} is outside`);
      device.queue.submit([pickEncoder.finish()]);
      const picked = await picker.read(staging);
      const texel = texels[Math.floor(y / 2) * (rowBytes / 4) + Math.floor(x / 2)] ?? 0;
      assert(picked === (texel === 0 ? undefined : texel - 1), `pick ${x},${y}: ${picked} vs texel ${texel}`);
    }
  } finally {
    picker.destroy();
    renderer.destroy();
    buffers.destroy();
  }
}
