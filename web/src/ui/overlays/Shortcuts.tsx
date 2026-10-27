import { SHORTCUTS } from '../../state/shortcuts';
import { useApp } from '../../state/store';

export function Shortcuts() {
  const open = useApp((s) => s.shortcutsOpen);
  const setOpen = useApp((s) => s.setShortcutsOpen);
  if (!open) return null;
  return (
    <section
      className="shortcuts floating-panel"
      role="dialog"
      aria-modal="false"
      aria-label="Keyboard shortcuts"
      data-testid="shortcuts"
    >
      <header>
        <h2>Keyboard shortcuts</h2>
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
    </section>
  );
}
