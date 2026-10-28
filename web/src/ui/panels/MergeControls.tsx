import { useState } from 'react';
import { useApp } from '../../state/store';
import { download } from '../files';
import { formatCount } from '../format';

/** `assembly.gfa.gz` saves as `assembly.merged.gfa`. */
function mergedName(file: string): string {
  return `${file.replace(/\.gz$/i, '').replace(/\.(gfa|fastg)$/i, '')}.merged.gfa`;
}

export function MergeControls() {
  const merged = useApp((s) => s.merged);
  const mergeOn = useApp((s) => s.mergeOn);
  const merging = useApp((s) => s.merging);
  const file = useApp((s) => (s.load.state === 'loaded' ? s.load.file.name : 'graph'));
  const setMerged = useApp((s) => s.setMerged);
  const shownGfa = useApp((s) => s.shownGfa);
  const toast = useApp((s) => s.toast);
  const [saving, setSaving] = useState(false);
  const save = () => {
    setSaving(true);
    shownGfa()
      .then((blob) => {
        download(blob, mergedName(file));
      })
      .catch((error: unknown) => {
        toast('The GFA could not be saved', error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setSaving(false);
      });
  };
  return (
    <section className="controls" aria-label="Merge chains">
      <div className="row">
        <label title="Collapse each unbranched run of segments into one, as Bandage's Merge all possible nodes does">
          <input
            type="checkbox"
            data-testid="merge-chains"
            checked={mergeOn}
            onChange={(event) => {
              setMerged(event.target.checked);
            }}
          />{' '}
          Merge simple chains
        </label>
        {merged && (
          <button type="button" data-testid="save-merged-gfa" disabled={saving} onClick={save}>
            Save as GFA
          </button>
        )}
      </div>
      {merging && <p className="muted small">Merging…</p>}
      {merged && (
        <p className="muted small" data-testid="merged-chains">
          {formatCount(merged.chains)} {merged.chains === 1 ? 'chain' : 'chains'} merged.
        </p>
      )}
    </section>
  );
}
