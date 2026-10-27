import { useState } from 'react';
import { useApp } from '../../state/store';
import { formatCount } from '../format';

/** Missing names listed before the rest are summarised. */
const SHOWN_MISSING = 50;

export function Find() {
  const [text, setText] = useState('');
  const [regex, setRegex] = useState(false);
  const find = useApp((s) => s.find);
  const result = useApp((s) => s.findResult);
  const submit = () => {
    find(text, regex);
  };
  return (
    <section className="find" aria-label="Find">
      <label htmlFor="find-names">{regex ? 'Regular expression' : 'Names, separated by commas or spaces'}</label>
      <textarea
        id="find-names"
        data-testid="find-input"
        rows={3}
        spellCheck={false}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="row">
        <label>
          <input
            type="checkbox"
            data-testid="find-regex"
            checked={regex}
            onChange={(event) => {
              setRegex(event.target.checked);
            }}
          />{' '}
          Regex
        </label>
        <button type="button" data-testid="find-submit" onClick={submit}>
          Find
        </button>
      </div>
      <div data-testid="find-result" aria-live="polite">
        {result.state === 'searching' && <p className="muted">Searching…</p>}
        {result.state === 'failed' && <p className="notice">{result.message}</p>}
        {result.state === 'done' && (
          <>
            <p>
              {result.found === 0
                ? 'No segment matches.'
                : `Selected ${formatCount(result.found)} ${result.found === 1 ? 'segment' : 'segments'}.`}
            </p>
            {result.missing.length > 0 && (
              <>
                <p className="notice">Not found ({formatCount(result.missing.length)}):</p>
                <ul className="missing mono" data-testid="find-missing">
                  {result.missing.slice(0, SHOWN_MISSING).map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
                {result.missing.length > SHOWN_MISSING && (
                  <p className="muted">and {formatCount(result.missing.length - SHOWN_MISSING)} more</p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
