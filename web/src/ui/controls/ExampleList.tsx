import { EXAMPLES } from '../../state/examples';
import { useApp } from '../../state/store';

/** The bundled example graphs, each with its credit and licence. */
export function ExampleList({ onPick }: { onPick?: () => void }) {
  const openExample = useApp((s) => s.openExample);
  return (
    <ul className="examples" data-testid="examples">
      {EXAMPLES.map((example) => (
        <li key={example.id}>
          <button
            type="button"
            data-testid={`example-${example.id}`}
            onClick={() => {
              openExample(example.id);
              onPick?.();
            }}
          >
            <span className="example-title">{example.title}</span>
            <span className="muted"> · {example.shows}</span>
          </button>
          <span className="example-credit muted">
            <a href={example.source} target="_blank" rel="noreferrer">
              {example.credit}
            </a>
            , {example.licence}
          </span>
        </li>
      ))}
    </ul>
  );
}
