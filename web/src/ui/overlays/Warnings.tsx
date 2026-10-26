import type { ParseWarnings } from '../../workers/protocol/graph';
import { formatCount } from '../format';

interface Props {
  warnings: ParseWarnings;
  onClose: () => void;
}

export function Warnings({ warnings, onClose }: Props) {
  const { lines, severities, messages, total } = warnings;
  return (
    <section className="warnings-panel floating-panel" aria-label="Parse warnings" data-testid="warnings-panel">
      <header>
        <h2>Warnings</h2>
        <button type="button" onClick={onClose} aria-label="Close warnings">
          ×
        </button>
      </header>
      <ol>
        {messages.map((text, i) => (
          <li key={i} className={severities[i] === 1 ? 'error' : undefined}>
            <span className="line">{lines[i] ? `line ${formatCount(lines[i])}` : 'file'}</span>
            <span>{text}</span>
          </li>
        ))}
      </ol>
      {total > messages.length && (
        <p className="muted">
          Showing the first {formatCount(messages.length)} of {formatCount(total)}.
        </p>
      )}
    </section>
  );
}
