import { useApp } from '../../state/store';
import { PackedLink } from './PackedLink';

/** "Share" in the top bar: a link that carries the whole graph and the view. */
export function ShareMenu() {
  const loaded = useApp((s) => s.load.state === 'loaded');
  const ready = useApp((s) => s.fingerprint !== undefined);
  if (!loaded) return null;
  return (
    <details className="menu" data-testid="share-menu">
      <summary>Share</summary>
      <div className="menu-popup menu-popup-end share">
        <PackedLink ready={ready} />
      </div>
    </details>
  );
}
