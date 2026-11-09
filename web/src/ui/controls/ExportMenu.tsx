import { useRef, useState } from 'react';
import type { ExportScope } from '../../state/export';
import { useApp } from '../../state/store';
import { download, fileStem } from '../files';

interface Item {
  id: string;
  label: string;
  title: string;
  /** What the saved file's name adds to the graph's. */
  suffix: string;
  save: () => Promise<Blob>;
  disabled?: boolean;
}

/** "Export" in the top bar: files made from the graph on screen, saved through the browser. */
export function ExportMenu() {
  const menu = useRef<HTMLDetailsElement>(null);
  const file = useApp((s) => (s.load.state === 'loaded' ? s.load.file.name : undefined));
  const selected = useApp((s) => s.selection.count);
  const merged = useApp((s) => s.merged !== undefined);
  const shownGfa = useApp((s) => s.shownGfa);
  const exportGfa = useApp((s) => s.exportGfa);
  const exportFasta = useApp((s) => s.exportFasta);
  const exportPng = useApp((s) => s.exportPng);
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  if (file === undefined) return null;

  const stem = `${fileStem(file)}${merged ? '.merged' : ''}`;
  const scoped = (scope: ExportScope, kind: 'gfa' | 'fasta'): Item => ({
    id: `export-${kind}-${scope}`,
    label: scope === 'selection' ? 'Selection' : 'What is shown',
    title:
      scope === 'selection'
        ? `The selected segments${kind === 'gfa' ? ' and the links among them' : ''}`
        : `The segments the filters leave shown${kind === 'gfa' ? ' and the links among them' : ''}`,
    suffix: `.${scope === 'selection' ? 'selection' : 'shown'}.${kind}`,
    save: () => (kind === 'gfa' ? exportGfa(scope) : exportFasta(scope)),
    disabled: scope === 'selection' && selected === 0,
  });
  const png = (scale: number): Item => ({
    id: `export-png-${String(scale)}`,
    label: scale === 1 ? 'PNG, screen size' : `PNG, ${String(scale)}× screen size`,
    title: 'The current view as a picture, drawn larger for print when asked',
    suffix: scale === 1 ? '.png' : `.${String(scale)}x.png`,
    save: () => exportPng(scale),
  });
  const groups: [string, Item[]][] = [
    ['Image', [png(1), png(2), png(4)]],
    [
      'GFA',
      [
        {
          id: 'export-gfa-all',
          label: 'Whole graph',
          title: 'Every segment and link, as Bandage saves the entire graph',
          suffix: '.gfa',
          save: shownGfa,
        },
        scoped('visible', 'gfa'),
        scoped('selection', 'gfa'),
      ],
    ],
    ['FASTA', [scoped('visible', 'fasta'), scoped('selection', 'fasta')]],
  ];

  const run = (item: Item) => {
    if (menu.current) menu.current.open = false;
    setBusy(true);
    item
      .save()
      .then((blob) => {
        download(blob, `${stem}${item.suffix}`);
      })
      .catch((error: unknown) => {
        toast('The file could not be saved', error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <details className="menu" ref={menu} data-testid="export-menu">
      <summary aria-busy={busy}>{busy ? 'Exporting…' : 'Export'}</summary>
      <div className="menu-popup">
        {groups.map(([heading, items]) => (
          <section key={heading} aria-label={heading}>
            <h3 className="menu-heading muted small">{heading}</h3>
            <ul className="menu-items">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    data-testid={item.id}
                    title={item.title}
                    disabled={busy || item.disabled}
                    onClick={() => {
                      run(item);
                    }}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}
