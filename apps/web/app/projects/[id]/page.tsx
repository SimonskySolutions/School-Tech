import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchProject } from '../../../lib/api-client';
import { currentSession, runtime } from '../../../lib/server';
import { assigneeValue, TASK_NOTICES } from '../../../lib/tasks';
import { DevelopmentBanner } from '../../development-banner';
import { TaskItem } from '../../tasks/task-item';

export const dynamic = 'force-dynamic';

/** A project of a school or of the group, with its tasks (M6.7). */
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');
  const { config } = runtime();
  const result = await fetchProject(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Project</h1>
        <p data-testid="not-permitted">This project is not yours to see.</p>
        <p>
          <Link href="/tasks">Tasks</Link>
        </p>
      </main>
    );
  }
  const { project, tasks, assignable } = result.value;
  const done = typeof query.done === 'string' ? (TASK_NOTICES[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;
  const back = `/projects/${project.id}`;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href="/tasks">Tasks</Link>
      </p>
      <h1>{project.name}</h1>
      <p data-testid="project-summary">
        {[
          project.schoolName ?? 'The group',
          `led by ${project.owner.name}`,
          project.status === 'closed'
            ? `closed ${project.closedAt!.slice(0, 10)}`
            : `${project.openTasks} to do`,
          project.overdueTasks > 0 ? `${project.overdueTasks} overdue` : null,
          `${project.doneTasks} done`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {project.description ? <p>{project.description}</p> : null}
      {done ? (
        <p role="status" data-testid="done">
          {done}
        </p>
      ) : null}
      {error ? (
        <p role="alert" data-testid="error">
          {error}
        </p>
      ) : null}
      <ul data-testid="project-tasks">
        {tasks.map((task) => (
          <TaskItem key={task.id} task={task} canMove={false} back={back} assignees={assignable} />
        ))}
      </ul>
      {tasks.length === 0 ? <p>No tasks yet.</p> : null}
      {project.mayManage && project.status === 'active' ? (
        <>
          <h2>Add a task</h2>
          <form
            method="post"
            action="/tasks/actions"
            style={{ display: 'grid', gap: '0.5rem', maxWidth: '32rem' }}
          >
            <input type="hidden" name="action" value="task" />
            <input type="hidden" name="project_id" value={project.id} />
            <input type="hidden" name="back" value={back} />
            <label>
              Task <input name="title" required maxLength={200} />
            </label>
            <label>
              Details (optional) <textarea name="details" maxLength={4000} rows={2} />
            </label>
            <label>
              Due (optional) <input name="due_on" type="date" />
            </label>
            <label>
              For{' '}
              <select name="assignee" required>
                {assignable.map((person) => (
                  <option key={person.personId} value={assigneeValue(project.schoolId, person.personId)}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" data-testid="add-project-task">
              Add the task
            </button>
          </form>
          <form method="post" action="/tasks/actions" style={{ marginTop: '1rem' }}>
            <input type="hidden" name="action" value="close" />
            <input type="hidden" name="project_id" value={project.id} />
            <input type="hidden" name="back" value={back} />
            <button type="submit" data-testid="close-project">
              Close the project
            </button>
          </form>
        </>
      ) : null}
    </main>
  );
}
