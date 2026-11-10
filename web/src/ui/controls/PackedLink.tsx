import { useState } from 'react';
import { useApp } from '../../state/store';
import { copyText } from '../files';
import { formatCount } from '../format';

type Packing =
  | { state: 'idle' }
  | { state: 'packing' }
  | { state: 'ready'; link: string; copied: boolean | undefined }
  | { state: 'too-big' }
  | { state: 'failed'; message: string };

/** Message limits: Discord 2,000 characters, Teams about 28 KB, Slack 40,000. */
export function linkFit(chars: number): string {
  if (chars <= 2000) return 'Short enough for any chat app.';
  if (chars <= 28_000) return 'Fits a Slack or Teams message; too long for Discord (2,000 characters).';
  if (chars <= 40_000) return 'Fits a Slack message (40,000 characters); too long for Teams and Discord.';
  return 'Too long for chat apps: send it by email or in a document. Pasting it into Open URL also opens it.';
}

/** The share menu's link that carries the whole graph, so it opens with nothing else. */
export function PackedLink({ ready }: { ready: boolean }) {
  const packLink = useApp((s) => s.packLink);
  const cancelPack = useApp((s) => s.cancelPack);
  const [packing, setPacking] = useState<Packing>({ state: 'idle' });

  const pack = () => {
    setPacking({ state: 'packing' });
    packLink().then(
      (made) => {
        if (made.state === 'cancelled') setPacking({ state: 'idle' });
        else if (made.state === 'too-big') setPacking({ state: 'too-big' });
        else setPacking({ state: 'ready', link: made.link, copied: undefined });
      },
      (error: unknown) => {
        setPacking({ state: 'failed', message: error instanceof Error ? error.message : String(error) });
      },
    );
  };

  const copy = (link: string) => {
    copyText(Promise.resolve(link)).then(
      () => {
        setPacking({ state: 'ready', link, copied: true });
      },
      () => {
        setPacking({ state: 'ready', link, copied: false });
      },
    );
  };

  return (
    <>
      <h3 className="menu-heading muted small">Link with the graph</h3>
      <p className="small">
        The whole graph and the view in one link, so it opens with nothing else to find. Anyone with the link gets every
        sequence in it.
      </p>
      {packing.state === 'packing' ? (
        <p className="small" role="status" data-testid="share-packing">
          Packing the graph…{' '}
          <button type="button" className="link" onClick={cancelPack}>
            Cancel
          </button>
        </p>
      ) : (
        <button type="button" data-testid="share-pack-link" disabled={!ready} onClick={pack}>
          Make link with the graph
        </button>
      )}
      {packing.state === 'ready' && (
        <div className="share-packed" role="status" data-testid="share-packed" data-chars={packing.link.length}>
          <p className="small">
            {formatCount(packing.link.length)} characters. {linkFit(packing.link.length)}
          </p>
          <button
            type="button"
            data-testid="share-copy-packed"
            onClick={() => {
              copy(packing.link);
            }}
          >
            Copy link with the graph
          </button>
          {packing.copied === true && <p className="small">Copied.</p>}
          {packing.copied === false && (
            <p className="small">
              The clipboard refused the link; copy it from here:
              <input
                readOnly
                className="share-link"
                value={packing.link}
                onFocus={(e) => {
                  e.target.select();
                }}
              />
            </p>
          )}
        </div>
      )}
      {packing.state === 'too-big' && (
        <p className="small" role="status" data-testid="share-too-big">
          This graph is too large to fit in a link, even packed: browsers refuse links over 2 MB. Share the link to the
          view and send the file itself, or a session file.
        </p>
      )}
      {packing.state === 'failed' && (
        <p className="small" role="status">
          The graph could not be packed: {packing.message}
        </p>
      )}
    </>
  );
}
