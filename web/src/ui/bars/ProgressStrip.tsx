import { useApp } from '../../state/store';
import { formatPercent } from '../format';

interface Task {
  testId: string;
  label: string;
  /** 0 to 1; undefined while the length of the task is not known. */
  fraction: number | undefined;
  title?: string;
  action?: { label: string; run: () => void; testId?: string };
}

/** What is running now, under the top bar: a bar for the first task and a chip with its action for each. */
export function ProgressStrip() {
  const load = useApp((s) => s.load);
  const layout = useApp((s) => s.layoutStatus);
  const paused = useApp((s) => s.layoutPaused);
  const setPaused = useApp((s) => s.setLayoutPaused);
  const refining = useApp((s) => s.refining);
  const search = useApp((s) => s.searchRun);
  const cancelLoad = useApp((s) => s.cancelLoad);
  const cancelSearch = useApp((s) => s.cancelSearch);
  const tasks: Task[] = [];
  const cancel = (run: () => void) => ({ label: 'Cancel', run });
  if (load.state === 'fetching') {
    tasks.push({ testId: 'status-task', label: 'Downloading', fraction: load.fraction, action: cancel(cancelLoad) });
  } else if (load.state === 'unpacking') {
    tasks.push({
      testId: 'status-task',
      label: 'Unpacking the graph from the link',
      fraction: undefined,
      action: cancel(cancelLoad),
    });
  } else if (load.state === 'parsing') {
    tasks.push({ testId: 'status-task', label: 'Parsing', fraction: load.fraction, action: cancel(cancelLoad) });
  }
  if (layout.state === 'running') {
    const detail =
      layout.level !== undefined && layout.levels !== undefined
        ? `Level ${layout.levels - layout.level} of ${layout.levels}${layout.energy === undefined ? '' : `, energy ${layout.energy.toFixed(2)}`}`
        : undefined;
    tasks.push({
      testId: 'progress-layout',
      label: paused ? 'Layout paused' : 'Laying out',
      fraction: layout.total > 0 ? layout.iteration / layout.total : 0,
      ...(detail && { title: detail }),
      action: {
        label: paused ? 'Resume' : 'Pause',
        run: () => {
          setPaused(!paused);
        },
        testId: 'progress-pause',
      },
    });
  }
  if (search.state === 'indexing') {
    tasks.push({
      testId: 'status-indexing',
      label: 'Indexing sequences',
      fraction: search.fraction,
      action: cancel(cancelSearch),
    });
  }
  if (refining) tasks.push({ testId: 'status-refining', label: 'Refining the layout', fraction: undefined });
  const lead = tasks[0];
  if (!lead) return null;
  return (
    <div className="progress" role="status" data-testid="progress">
      <progress
        className="progress-bar"
        max={1}
        {...(lead.fraction !== undefined && { value: lead.fraction })}
        aria-label={lead.label}
      />
      <div className="progress-tasks">
        {tasks.map((task) => (
          <span key={task.testId} className="progress-task" data-testid={task.testId} title={task.title}>
            {task.label}
            {task.fraction !== undefined && ` · ${formatPercent(task.fraction)}`}
            {task.action && (
              <button type="button" data-testid={task.action.testId} onClick={task.action.run}>
                {task.action.label}
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
