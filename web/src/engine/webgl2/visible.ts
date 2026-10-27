import type { PositionGrid } from '../../workers/protocol/layout';
import type { Bounds } from '../core/camera';
import type { DisplayOptions } from '../style/display';
import type { DrawnView } from '../style/uniforms';
import { MAX_RIBBON_WIDTH, STRAND_SHIFT } from '../style/widths';
import { collect, coversGrid, eachBit, type Geometry, linkTouches, pieceTouches } from './grid';

/** Items to draw: every one, or the first `count` of `items`. */
export type ItemList = { every: true } | { every: false; items: Uint32Array; count: number };

const EVERY: ItemList = { every: true };

/**
 * The CPU side of `Renderer.cull` in the WebGPU backend: the view padded by
 * the widest a ribbon draws, then the pieces and links that touch it, found
 * through the layout worker's grid, in their own order.
 */
export class Visible {
  private readonly pieceMarks: Uint32Array;
  private readonly linkMarks: Uint32Array;
  private readonly pieceItems: Uint32Array;
  private readonly linkItems: Uint32Array;
  private readonly litItems: Uint32Array;

  constructor(
    private readonly g: Geometry,
    /** Index of each segment's first ribbon piece, and the total at the end. */
    private readonly firstPiece: Uint32Array,
    pieceCount: number,
    linkCount: number,
  ) {
    this.pieceMarks = new Uint32Array(Math.ceil(pieceCount / 32));
    this.linkMarks = new Uint32Array(Math.ceil(linkCount / 32));
    this.pieceItems = new Uint32Array(pieceCount);
    this.linkItems = new Uint32Array(linkCount);
    this.litItems = new Uint32Array(pieceCount);
  }

  /** The view in world units, padded as the WebGPU cull pads it. */
  static area(view: DrawnView, display: DisplayOptions): Bounds {
    const worldPerPixel = 1 / view.zoom;
    const widest =
      (display.widthByDepth ? MAX_RIBBON_WIDTH / 2 : view.ribbonHalf) + (display.double ? STRAND_SHIFT : 0);
    const pad = Math.max(widest, worldPerPixel / 2) + view.outlineWidth + 2 * worldPerPixel;
    const halfWidth = view.width / 2 / view.zoom + pad;
    const halfHeight = view.height / 2 / view.zoom + pad;
    return {
      minX: view.centerX - halfWidth,
      minY: view.centerY - halfHeight,
      maxX: view.centerX + halfWidth,
      maxY: view.centerY + halfHeight,
    };
  }

  pieces(grid: PositionGrid | undefined, area: Bounds): ItemList {
    if (!grid || coversGrid(grid, area)) return EVERY;
    const count = collect(grid, grid.pieces, area, this.pieceMarks, this.pieceItems, (p) =>
      pieceTouches(this.g, p, area),
    );
    return { every: false, items: this.pieceItems, count };
  }

  links(grid: PositionGrid | undefined, area: Bounds, ribbonHalf: number): ItemList {
    if (!grid || coversGrid(grid, area)) return EVERY;
    const count = collect(grid, grid.links, area, this.linkMarks, this.linkItems, (l) =>
      linkTouches(this.g, l, area, ribbonHalf),
    );
    return { every: false, items: this.linkItems, count };
  }

  /** Pieces of the selected or hovered segments that touch `area`, in piece order. */
  highlighted(selected: Uint32Array, hover: number | undefined, area: Bounds): ItemList {
    const segments = this.firstPiece.length - 1;
    let count = 0;
    const add = (segment: number) => {
      const end = this.firstPiece[segment + 1] ?? 0;
      for (let p = this.firstPiece[segment] ?? 0; p < end; p++) {
        if (pieceTouches(this.g, p, area)) this.litItems[count++] = p;
      }
    };
    let hoverDone = hover === undefined;
    eachBit(selected, segments, (segment) => {
      if (!hoverDone && hover !== undefined && hover < segment) {
        add(hover);
        hoverDone = true;
      }
      if (segment === hover) hoverDone = true;
      add(segment);
    });
    if (!hoverDone && hover !== undefined && hover < segments) add(hover);
    return { every: false, items: this.litItems, count };
  }
}

/** Index of each segment's first piece, from its piece counts, with the total at the end. */
export function firstPieces(segmentPieces: Uint8Array): Uint32Array {
  const out = new Uint32Array(segmentPieces.length + 1);
  for (let s = 0; s < segmentPieces.length; s++) out[s + 1] = (out[s] ?? 0) + (segmentPieces[s] ?? 0);
  return out;
}
