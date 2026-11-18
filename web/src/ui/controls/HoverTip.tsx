import { useEffect, useState } from 'react';
import { useApp } from '../../state/store';
import type { SegmentInfo } from '../../workers/protocol/graph';
import { formatBases, formatDepth } from '../lib/format';

const DELAY_MS = 120;
const OFFSET = 14;

/** Name, length and depth of the segment under the pointer. */
export function HoverTip() {
  const hovered = useApp((s) => s.hovered);
  const describe = useApp((s) => s.describeSegment);
  const [at, setAt] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [known, setKnown] = useState<ReadonlyMap<number, SegmentInfo>>(new Map());

  useEffect(() => {
    const move = (event: PointerEvent) => {
      setAt({ x: event.clientX, y: event.clientY });
    };
    window.addEventListener('pointermove', move);
    return () => {
      window.removeEventListener('pointermove', move);
    };
  }, []);

  useEffect(() => {
    if (hovered === undefined || known.has(hovered)) return;
    const timer = setTimeout(() => {
      void describe(hovered).then((found) => {
        if (!found) return;
        setKnown((before) => new Map(before).set(hovered, found));
      });
    }, DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [hovered, known, describe]);

  const info = hovered === undefined ? undefined : known.get(hovered);
  if (!info) return null;
  return (
    <div
      className="hover-tip"
      role="tooltip"
      style={{ left: at.x + OFFSET, top: at.y + OFFSET }}
      data-testid="hover-tip"
    >
      <strong className="mono">{info.name}</strong>
      <span>{formatBases(info.length)}</span>
      <span>{formatDepth(info.depth)}</span>
    </div>
  );
}
