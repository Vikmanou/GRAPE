import { useApp } from '../../state/store';

/** Shown in the Overview of the first graph a person opens, until they dismiss it. */
export function Welcome() {
  const welcomed = useApp((s) => s.welcomed);
  const setWelcomed = useApp((s) => s.setWelcomed);
  const setShortcutsOpen = useApp((s) => s.setShortcutsOpen);
  if (welcomed) return null;
  return (
    <section className="welcome" aria-label="Getting started" data-testid="welcome">
      <h3>Getting started</h3>
      <ul>
        <li>
          <strong>Look:</strong> the Display tab colours segments by depth or length and shows their names.
        </li>
        <li>
          <strong>Find:</strong> the Find tab selects segments by name or by sequence.
        </li>
        <li>
          <strong>Select:</strong> click a segment, or Shift and drag a box. Its details open on the right.
        </li>
        <li>
          <strong>Save:</strong> Export writes a picture, GFA, FASTA or a layout that Bandage can open.
        </li>
      </ul>
      <div className="row">
        <button
          type="button"
          className="primary"
          data-testid="welcome-dismiss"
          onClick={() => {
            setWelcomed(true);
          }}
        >
          Got it
        </button>
        <button
          type="button"
          onClick={() => {
            setShortcutsOpen(true);
            setWelcomed(true);
          }}
        >
          Help and shortcuts
        </button>
      </div>
    </section>
  );
}
