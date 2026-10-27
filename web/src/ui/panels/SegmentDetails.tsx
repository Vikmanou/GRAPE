import type { Details } from '../../state/details';
import { useApp } from '../../state/store';
import type { SegmentLink } from '../../workers/protocol/graph';
import { formatBases, formatCount, formatDepth, formatPercent } from '../format';

type Segment = Extract<Details, { state: 'segment' }>;

const sign = (reverse: boolean) => (reverse ? '-' : '+');

function LinkRow({ link, name, onShow }: { link: SegmentLink; name: string; onShow: (segment: number) => void }) {
  const [from, to] =
    link.from === link.to ? [name, name] : link.from === link.other ? [link.otherName, name] : [name, link.otherName];
  return (
    <li>
      <button
        type="button"
        className="link"
        data-testid="neighbour"
        onClick={() => {
          onShow(link.other);
        }}
      >
        {link.otherName}
      </button>{' '}
      <span className="muted mono">
        {from}
        {sign(link.fromReverse)} → {to}
        {sign(link.toReverse)}
      </span>
    </li>
  );
}

export function SegmentDetails({ details }: { details: Segment }) {
  const { info, preview, rawLine, sequenceError } = details;
  const select = useApp((s) => s.select);
  const zoom = useApp((s) => s.zoomToSelection);
  const show = (segment: number) => {
    select(Uint32Array.of(segment), 'replace');
    zoom();
  };
  const rows: [string, string, string][] = [
    ['length', 'Length', formatBases(info.length)],
    ['depth', 'Depth', Number.isNaN(info.depth) ? 'unknown' : formatDepth(info.depth)],
    ['gc', 'GC content', formatPercent(info.gc)],
    ['component', 'Component', `#${formatCount(info.component + 1)}`],
    ['degree', 'Links at start / end', `${formatCount(info.degreeStart)} / ${formatCount(info.degreeEnd)}`],
  ];
  return (
    <>
      <p className="segment-name mono" data-testid="info-name">
        {info.name}
      </p>
      <dl className="stats">
        {rows.map(([id, label, value]) => (
          <div key={id}>
            <dt>{label}</dt>
            <dd data-testid={`info-${id}`}>{value}</dd>
          </div>
        ))}
      </dl>
      {info.links.length > 0 && (
        <>
          <h3>Neighbours</h3>
          <ul className="neighbours" data-testid="neighbours">
            {info.links.map((link, i) => (
              <LinkRow key={i} link={link} name={info.name} onShow={show} />
            ))}
          </ul>
          {info.totalLinks > info.links.length && (
            <p className="muted">and {formatCount(info.totalLinks - info.links.length)} more</p>
          )}
        </>
      )}
      <h3>Sequence</h3>
      {sequenceError && <p className="notice">{sequenceError}</p>}
      {preview?.missing && <p className="muted">The file gives no sequence for this segment.</p>}
      {preview && !preview.missing && (
        <p className="sequence mono" data-testid="info-sequence">
          {preview.head}
          {preview.tail && (
            <>
              <span className="muted">
                {' '}
                … {formatBases(preview.length - preview.head.length - preview.tail.length)} …{' '}
              </span>
              {preview.tail}
            </>
          )}
        </p>
      )}
      <h3>Line in the file</h3>
      {rawLine ? (
        <pre className="raw-line" data-testid="info-raw-line">
          {rawLine.text}
        </pre>
      ) : (
        <p className="muted">Gzipped files cannot be read at an offset, so the line is not shown.</p>
      )}
      {rawLine && rawLine.elided > 0 && (
        <p className="muted small">{formatBases(rawLine.elided)} of sequence cut from the middle.</p>
      )}
    </>
  );
}
