import { useApp } from '../../state/store';
import type { Quality } from '../../workers/protocol/layout';

const QUALITIES: [Quality, string][] = [
  ['fast', 'Fast'],
  ['balanced', 'Balanced'],
  ['best', 'Best'],
];

const MAX_SEED = 0xffffffff;

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
}

export function LayoutControls() {
  const options = useApp((s) => s.layoutOptions);
  const running = useApp((s) => s.layoutStatus.state === 'running');
  const paused = useApp((s) => s.layoutPaused);
  const onOptions = useApp((s) => s.setLayoutOptions);
  const onPause = useApp((s) => s.setLayoutPaused);
  return (
    <section className="controls" aria-label="Layout">
      <h3>Layout</h3>
      <div className="row">
        <button
          type="button"
          data-testid="layout-pause"
          disabled={!running}
          onClick={() => {
            onPause(!paused);
          }}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          data-testid="layout-restart"
          onClick={() => {
            onOptions({ ...options, seed: randomSeed() });
          }}
        >
          Restart with new seed
        </button>
      </div>
      <div className="row">
        <label>
          Seed{' '}
          <SeedField
            key={options.seed}
            seed={options.seed}
            onSeed={(seed) => {
              onOptions({ ...options, seed });
            }}
          />
        </label>
        <label>
          Quality{' '}
          <select
            data-testid="layout-quality"
            value={options.quality}
            onChange={(event) => {
              const quality = QUALITIES.find(([q]) => q === event.target.value)?.[0];
              if (quality) onOptions({ ...options, quality });
            }}
          >
            {QUALITIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

/** Applies on Enter or when focus leaves; anything but a u32 restores the seed. */
function SeedField({ seed, onSeed }: { seed: number; onSeed: (seed: number) => void }) {
  const apply = (input: HTMLInputElement) => {
    const value = Number(input.value);
    if (Number.isInteger(value) && value >= 0 && value <= MAX_SEED) {
      if (value !== seed) onSeed(value);
    } else {
      input.value = String(seed);
    }
  };
  return (
    <input
      data-testid="layout-seed"
      className="seed"
      inputMode="numeric"
      defaultValue={seed}
      onBlur={(event) => {
        apply(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') apply(event.currentTarget);
      }}
    />
  );
}
