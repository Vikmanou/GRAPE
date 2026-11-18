import { useRef, useState } from 'react';
import type { ExportScope } from '../../state/export';
import { useApp } from '../../state/store';
import { download, fileStem } from '../lib/files';

interface Item {
  id: string;
  label: string;
  title: string;
  /** One line under the label, in the menu. */
  hint: string;
  /** Why the item is off, shown instead of the hint. */
  reason?: string | undefined;
  /** What the saved file's name adds to the graph's. */
  suffix: string;
  save: () => Promise<Blob>;
  /** Replaces saving a file, for items that do something else with the blob. */
  act?: (blob: Blob) => Promise<void>;
  disabled?: boolean;
}

/** The engine canvas size in pixels, which a PNG at scale 1 matches. */
function canvasPixels(): [number, number] | undefined {
  const canvas = document.querySelector('canvas');
  return canvas ? [canvas.width, canvas.height] : undefined;
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
  const exportSvg = useApp((s) => s.exportSvg);
  const exportLayout = useApp((s) => s.exportLayout);
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
    hint:
      scope === 'selection'
        ? `The selected segments${kind === 'gfa' ? ', with the links among them' : ''}`
        : `The segments the filters leave shown${kind === 'gfa' ? ', with the links among them' : ''}`,
    reason: scope === 'selection' && selected === 0 ? 'Select segments first' : undefined,
    suffix: `.${scope === 'selection' ? 'selection' : 'shown'}.${kind}`,
    save: () => (kind === 'gfa' ? exportGfa(scope) : exportFasta(scope)),
    disabled: scope === 'selection' && selected === 0,
  });
  const pixels = canvasPixels();
  const png = (scale: number): Item => ({
    id: `export-png-${String(scale)}`,
    label: scale === 1 ? 'PNG, screen size' : `PNG, ${String(scale)}× screen size`,
    title: 'The current view as a picture, drawn larger for print when asked',
    hint: pixels
      ? `${String(pixels[0] * scale)} × ${String(pixels[1] * scale)} px`
      : scale === 1
        ? 'The view as it is in the window'
        : 'Larger, for print',
    suffix: scale === 1 ? '.png' : `.${String(scale)}x.png`,
    save: () => exportPng(scale),
  });
  const groups: [string, Item[]][] = [
    [
      'Image',
      [
        png(1),
        png(2),
        png(4),
        ...(typeof ClipboardItem === 'undefined'
          ? []
          : [
              {
                id: 'export-copy-image',
                label: 'Copy image',
                title: 'Put the current view on the clipboard as a picture',
                hint: 'The view as it is in the window, to paste elsewhere',
                suffix: '',
                save: () => exportPng(1),
                act: async (blob: Blob) => {
                  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                  toast('Image copied');
                },
              },
            ]),
        {
          id: 'export-svg',
          label: 'SVG',
          title: 'The current view as vector shapes, up to 50,000 segments in view',
          hint: 'Vector shapes, up to 50,000 segments in view',
          suffix: '.svg',
          save: exportSvg,
        },
      ],
    ],
    [
      'GFA',
      [
        {
          id: 'export-gfa-all',
          label: 'Whole graph',
          title: 'Every segment and link, as Bandage saves the entire graph',
          hint: 'Every segment and link',
          suffix: '.gfa',
          save: shownGfa,
        },
        scoped('visible', 'gfa'),
        scoped('selection', 'gfa'),
      ],
    ],
    ['FASTA', [scoped('visible', 'fasta'), scoped('selection', 'fasta')]],
    [
      'Layout',
      [
        {
          id: 'export-layout',
          label: 'Bandage layout',
          title: 'Where every segment is drawn, as BandageNG exports it; open it with the graph to draw it again',
          hint: 'Where every segment is drawn; open it with the graph',
          suffix: '.layout',
          save: () => exportLayout('layout'),
        },
        {
          id: 'export-layout-tsv',
          label: 'TSV, one point per segment',
          title: 'Each segment and the middle of its line, as BandageNG exports TSV',
          hint: 'One line per segment, at the middle of its line',
          suffix: '.tsv',
          save: () => exportLayout('tsv'),
        },
      ],
    ],
  ];

  const run = (item: Item) => {
    if (menu.current) menu.current.open = false;
    setBusy(true);
    item
      .save()
      .then(async (blob) => {
        if (item.act) await item.act(blob);
        else download(blob, `${stem}${item.suffix}`);
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
      <div className="menu-popup menu-popup-end">
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
                    <span>{item.label}</span>
                    <span className="menu-hint muted small">{item.reason ?? item.hint}</span>
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
