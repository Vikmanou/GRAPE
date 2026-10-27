interface Props {
  value: number;
  onValue: (value: number) => void;
  label: string;
  testId?: string;
  /** Rejects values that fail it, restoring the last one. */
  valid?: (value: number) => boolean;
}

/** Applies on Enter or when focus leaves. */
export function NumberField({ value, onValue, label, testId, valid = Number.isFinite }: Props) {
  const apply = (input: HTMLInputElement) => {
    const next = Number(input.value);
    if (input.value.trim() !== '' && valid(next)) {
      if (next !== value) onValue(next);
    } else {
      input.value = String(value);
    }
  };
  return (
    <input
      key={value}
      className="number"
      inputMode="decimal"
      aria-label={label}
      data-testid={testId}
      defaultValue={Number(value.toPrecision(6))}
      onBlur={(event) => {
        apply(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') apply(event.currentTarget);
      }}
    />
  );
}
