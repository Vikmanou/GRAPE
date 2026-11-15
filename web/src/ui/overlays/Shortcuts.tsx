import { SHORTCUTS } from '../../state/shortcuts';
import { useApp } from '../../state/store';

/**
 * Where Bandage's controls live in GRAPE, for people who know Bandage. The
 * names are Bandage's own, from ui/mainwindow.ui in rrwick/Bandage.
 */
const FROM_BANDAGE: [string, string][] = [
  ['Load graph', 'Open, or drop the file on the page'],
  ['Draw graph', 'Automatic: the graph draws as it loads; Layout tab to draw it again'],
  ['Graph scope: Around nodes, Depth range', 'Display tab, Show only'],
  ['Colour by: Random colours, Uniform colour, Colour by depth', 'Display tab, Colour by'],
  ['Node labels: Name, Length, Depth', 'Display tab, Labels'],
  ['Find nodes', 'Find tab, By name'],
  ['BLAST', 'Find tab, By sequence: GRAPE searches the sequences itself'],
  ['Save image (current view)', 'Export, PNG or SVG'],
  ['Select none, Invert selection, Zoom to fit selection', 'Esc, I and Z'],
];

export function Shortcuts() {
  const open = useApp((s) => s.shortcutsOpen);
  const setOpen = useApp((s) => s.setShortcutsOpen);
  const core = useApp((s) => s.core);
  const renderer = useApp((s) => s.renderer);
  if (!open) return null;
  return (
    <section
      className="shortcuts floating-panel"
      role="dialog"
      aria-modal="false"
      aria-label="Help and keyboard shortcuts"
      data-testid="shortcuts"
    >
      <header>
        <h2>Help and keyboard shortcuts</h2>
        <button
          type="button"
          className="icon"
          aria-label="Close"
          onClick={() => {
            setOpen(false);
          }}
        >
          ×
        </button>
      </header>
      <h3>Keyboard and mouse</h3>
      <table>
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.label}>
              <td>
                <kbd>{s.label}</kbd>
              </td>
              <td>{s.action}</td>
            </tr>
          ))}
          <tr>
            <td>
              <kbd>Shift</kbd> + drag
            </td>
            <td>Select by box</td>
          </tr>
          <tr>
            <td>
              <kbd>Shift</kbd> + click
            </td>
            <td>Add a segment to the selection or remove it</td>
          </tr>
          <tr>
            <td>Drag a segment</td>
            <td>Move and pin it</td>
          </tr>
        </tbody>
      </table>
      <h3>Coming from Bandage</h3>
      <table data-testid="from-bandage">
        <tbody>
          {FROM_BANDAGE.map(([bandage, here]) => (
            <tr key={bandage}>
              <td>{bandage}</td>
              <td>{here}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>About this session</h3>
      <p className="muted small" data-testid="about">
        {core.state === 'ready'
          ? `gfa-core ${core.version} · worker round trip ${Math.round(core.roundTripMs)} ms`
          : 'The core is not ready.'}
        {` · drawing with ${renderer}`}
      </p>
    </section>
  );
}
