import type { LayoutStatus } from '../state/layout';
import type { LayoutOptions, Quality } from '../workers/protocol';

interface Props {
  options: LayoutOptions;
  status: LayoutStatus;
  paused: boolean;
  /** Only the GPU layout can pause. */
  canPause: boolean;
  onOptions: (options: LayoutOptions) => void;
  onPause: (paused: boolean) => void;
}

const QUALITIES: [Quality, string][] = [
  ['fast', 'Fast'],
  ['balanced', 'Balanced'],
  ['best', 'Best'],
];

const MAX_SEED = 0xffffffff;

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
}

export function LayoutControls({ options, status, paused, canPause, onOptions, onPause }: Props) {
  const running = status.state === 'running';
  return (
    <section className="layout-controls" aria-label="Layout">
      <h3>Layout</h3>
      <div className="row">
        <button
          type="button"
          data-testid="layout-pause"
          disabled={!canPause || !running}
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
