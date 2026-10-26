import { useApp } from '../../state/store';

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <ol className="toasts" aria-live="polite" data-testid="toasts">
      {toasts.map((t) => (
        <li key={t.id} className="toast" role="status">
          <div className="toast-row">
            <span>{t.message}</span>
            <button
              type="button"
              className="icon"
              aria-label="Dismiss"
              onClick={() => {
                dismiss(t.id);
              }}
            >
              ×
            </button>
          </div>
          {t.details && (
            <details>
              <summary>Details</summary>
              <pre>{t.details}</pre>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}
