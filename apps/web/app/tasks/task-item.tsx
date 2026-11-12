import { type Task, type TaskStatus } from '@pythagoras/shared';
import { STATUS_LABELS } from '../../lib/tasks';

const ACTION = '/tasks/actions';
const inline = { display: 'inline', marginLeft: '0.5rem' } as const;

// The moves offered from each state; cancelling is for whoever manages the task.
const MOVES: Record<TaskStatus, [TaskStatus, string][]> = {
  open: [
    ['in_progress', 'Start'],
    ['done', 'Done'],
  ],
  in_progress: [
    ['open', 'Back to to-do'],
    ['done', 'Done'],
  ],
  done: [['open', 'Reopen']],
  cancelled: [],
};

function Move({
  task,
  status,
  label,
  back,
}: {
  task: Task;
  status: TaskStatus;
  label: string;
  back: string;
}) {
  return (
    <form method="post" action={ACTION} style={inline}>
      <input type="hidden" name="action" value="status" />
      <input type="hidden" name="task_id" value={task.id} />
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="back" value={back} />
      <button type="submit">{label}</button>
    </form>
  );
}

/**
 * One task (M6.7): what, who, when and where it stands; its moves for whoever
 * may make them, and for those who manage it a form to change it.
 */
export function TaskItem({
  task,
  canMove,
  back,
  assignees,
}: {
  task: Task;
  canMove: boolean;
  back: string;
  /** Whom it may be handed to, for those who manage it. */
  assignees: { personId: string; name: string }[];
}) {
  const about = [
    STATUS_LABELS[task.status],
    task.dueOn ? `due ${task.dueOn}` : null,
    task.overdue ? 'OVERDUE' : null,
    `for ${task.assignee.name}`,
    `set by ${task.createdBy.name}`,
    task.projectName ? `project: ${task.projectName}` : null,
    task.schoolName ?? 'the group',
  ].filter(Boolean);
  const open = task.status === 'open' || task.status === 'in_progress';
  return (
    <li data-testid={`task-${task.id}`} style={{ marginBottom: '0.5rem' }}>
      <strong>{task.title}</strong>
      {` · ${about.join(' · ')}`}
      {task.details ? <div style={{ marginLeft: '1rem' }}>{task.details}</div> : null}
      {canMove || task.mayManage
        ? MOVES[task.status].map(([status, label]) => (
            <Move key={status} task={task} status={status} label={label} back={back} />
          ))
        : null}
      {task.mayManage && open ? <Move task={task} status="cancelled" label="Cancel" back={back} /> : null}
      {task.mayManage && open ? (
        <details>
          <summary>Change</summary>
          <form method="post" action={ACTION} style={{ display: 'grid', gap: '0.5rem', maxWidth: '32rem' }}>
            <input type="hidden" name="action" value="update" />
            <input type="hidden" name="task_id" value={task.id} />
            <input type="hidden" name="back" value={back} />
            <label>
              Title <input name="title" defaultValue={task.title} required maxLength={200} />
            </label>
            <label>
              Details <textarea name="details" defaultValue={task.details ?? ''} maxLength={4000} rows={2} />
            </label>
            <label>
              Due <input name="due_on" type="date" defaultValue={task.dueOn ?? ''} />
            </label>
            <label>
              For{' '}
              <select name="assignee_id" defaultValue={task.assignee.personId}>
                {[
                  task.assignee,
                  ...assignees.filter((person) => person.personId !== task.assignee.personId),
                ].map((person) => (
                  <option key={person.personId} value={person.personId}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Save</button>
          </form>
        </details>
      ) : null}
    </li>
  );
}
