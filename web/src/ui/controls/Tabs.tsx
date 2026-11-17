import { useRef, type KeyboardEvent } from 'react';

export interface Tab<Id extends string> {
  id: Id;
  label: string;
}

interface Props<Id extends string> {
  label: string;
  tabs: readonly Tab<Id>[];
  selected: Id;
  onSelect: (id: Id) => void;
}

/** A tab list with arrow, Home and End focus moves, as the WAI-ARIA tabs pattern describes. */
export function Tabs<Id extends string>({ label, tabs, selected, onSelect }: Props<Id>) {
  const list = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent, index: number) => {
    const to = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length];
    if (!next) return;
    onSelect(next.id);
    list.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} ref={list}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          data-tab={tab.id}
          data-testid={`tab-${tab.id}`}
          aria-selected={tab.id === selected}
          aria-controls={`panel-${tab.id}`}
          tabIndex={tab.id === selected ? 0 : -1}
          onClick={() => {
            onSelect(tab.id);
          }}
          onKeyDown={(event) => {
            move(event, index);
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
