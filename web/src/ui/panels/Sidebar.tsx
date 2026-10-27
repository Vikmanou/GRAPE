import type { SidebarTab } from '../../state/display';
import { useApp } from '../../state/store';
import type { ParseResult } from '../../workers/protocol/graph';
import { Tabs } from '../controls/Tabs';
import { Display } from './Display';
import { Find } from './Find';
import { Overview } from './Overview';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'display', label: 'Display' },
  { id: 'find', label: 'Find' },
] as const satisfies readonly { id: SidebarTab; label: string }[];

export function Sidebar({ result }: { result: ParseResult }) {
  const { open, tab } = useApp((s) => s.sidebar);
  const showSidebar = useApp((s) => s.showSidebar);
  const toggleSidebar = useApp((s) => s.toggleSidebar);
  if (!open) {
    return (
      <button
        type="button"
        className="sidebar-open"
        data-testid="sidebar-open"
        data-inset="left"
        aria-label="Show the sidebar"
        onClick={toggleSidebar}
      >
        ›
      </button>
    );
  }
  return (
    <aside className="sidebar floating-panel" aria-label="Sidebar" data-inset="left" data-testid="sidebar">
      <header>
        <Tabs label="Sidebar" tabs={TABS} selected={tab} onSelect={showSidebar} />
        <button type="button" className="icon" aria-label="Hide the sidebar" onClick={toggleSidebar}>
          ‹
        </button>
      </header>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tab-panel">
        {tab === 'overview' && <Overview result={result} />}
        {tab === 'display' && <Display />}
        {tab === 'find' && <Find />}
      </div>
    </aside>
  );
}
