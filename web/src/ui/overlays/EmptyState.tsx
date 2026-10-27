import { ExampleList } from '../controls/ExampleMenu';

interface Props {
  dragging: boolean;
}

export function EmptyState({ dragging }: Props) {
  return (
    <div className={`empty-state${dragging ? ' dragging' : ''}`} data-testid="empty-state">
      <div className="drop-zone">
        <p className="drop-title">Drop an assembly graph here</p>
        <p>GFA 1.0 / 1.1 or FASTG, plain or gzipped</p>
        <p className="muted">Files are processed on your computer and never uploaded.</p>
        <div className="empty-examples">
          <p>Or try an example:</p>
          <ExampleList />
        </div>
      </div>
    </div>
  );
}
