import { useEffect, useRef } from 'react';
import type { SidebarTab } from '../../state/display';
import { useApp } from '../../state/store';
import type { ParseResult } from '../../workers/protocol/graph';
import { ChevronLeftIcon, ChevronRightIcon } from '../controls/Icons';
import { Tabs } from '../controls/Tabs';
import { SHEET_QUERY, useMedia } from '../useMedia';
import { sheetKeys, sidebarControl } from '../useSheetFocus';
import { Display } from './Display';
import { Find } from './Find';
import { Overview } from './Overview';
import { Paths } from './Paths';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'display', label: 'Display' },
  { id: 'find', label: 'Find' },
  { id: 'paths', label: 'Paths' },
] as const satisfies readonly { id: SidebarTab; label: string }[];

export function Sidebar({ result }: { result: ParseResult }) {
  const { open, tab } = useApp((s) => s.sidebar);
  const showSidebar = useApp((s) => s.showSidebar);
  const toggleSidebar = useApp((s) => s.toggleSidebar);
  const sheet = useMedia(SHEET_QUERY);
  const infoShown = useApp((s) => s.infoOpen && s.selection.count > 0);
  const aside = useRef<HTMLElement>(null);
  const userOpened = useRef(false);
  // A sheet the user opens takes focus; one that is open from the start leaves it alone.
  useEffect(() => {
    if (!open || !sheet || !userOpened.current) return;
    userOpened.current = false;
    aside.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [open, sheet]);
  // One sheet at a time: a selection's details take the place of the sidebar until it is cleared.
  if (sheet && infoShown) return null;
  if (!open) {
    return (
      <button
        type="button"
        className="sidebar-open"
        data-testid="sidebar-open"
        data-inset="left"
        aria-label="Show the sidebar"
        onClick={() => {
          userOpened.current = true;
          toggleSidebar();
        }}
      >
        <ChevronRightIcon />
      </button>
    );
  }
  return (
    <aside
      className="sidebar floating-panel"
      aria-label="Sidebar"
      data-inset={sheet ? 'bottom' : 'left'}
      data-testid="sidebar"
      ref={aside}
      onKeyDown={sheet ? sheetKeys(toggleSidebar, sidebarControl) : undefined}
    >
      <header>
        <Tabs label="Sidebar" tabs={TABS} selected={tab} onSelect={showSidebar} />
        <button
          type="button"
          className="icon"
          aria-label="Hide the sidebar"
          onClick={() => {
            toggleSidebar();
            if (sheet) requestAnimationFrame(() => sidebarControl()?.focus());
          }}
        >
          <ChevronLeftIcon />
        </button>
      </header>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tab-panel">
        {tab === 'overview' && <Overview result={result} />}
        {tab === 'display' && <Display />}
        {tab === 'find' && <Find />}
        {tab === 'paths' && <Paths />}
      </div>
    </aside>
  );
}
