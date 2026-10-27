import { useRef } from 'react';
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

/** "Load example" in the top bar. */
export function ExampleMenu() {
  const menu = useRef<HTMLDetailsElement>(null);
  return (
    <details className="example-menu" ref={menu} data-testid="example-menu">
      <summary>Load example</summary>
      <div className="example-popup">
        <ExampleList
          onPick={() => {
            if (menu.current) menu.current.open = false;
          }}
        />
      </div>
    </details>
  );
}
