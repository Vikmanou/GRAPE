import type { ReactNode } from 'react';

/** Controls most people never touch, folded under a heading. */
export function Disclosure({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <details className="disclosure" data-testid={testId}>
      <summary>{title}</summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}
