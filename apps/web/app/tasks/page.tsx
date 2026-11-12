import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchMyTasks } from '../../lib/api-client';
import { currentSession, runtime } from '../../lib/server';
import { assigneeValue, TASK_NOTICES } from '../../lib/tasks';
import { DevelopmentBanner } from '../development-banner';
import { TaskItem } from './task-item';

export const dynamic = 'force-dynamic';

const grid = { display: 'grid', gap: '0.5rem', maxWidth: '32rem', marginTop: '0.5rem' } as const;

/** My tasks, the tasks I set, overdue tasks I see as a leader, and projects (M6.7). */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');
  const { config } = runtime();
  const result = await fetchMyTasks(config.API_INTERNAL_URL, session.accessToken);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') redirect('/');
  const view = result.value;
  const done = typeof query.done === 'string' ? (TASK_NOTICES[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;
  const back = '/tasks';
  const assigneesAt = (schoolId: string | null) =>
    view.assignable.find((place) => place.schoolId === schoolId)?.people ?? [];
  const unfinished = view.assigned.filter((task) => task.status === 'open' || task.status === 'in_progress');
  const finished = view.assigned.filter((task) => !unfinished.includes(task));

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>Tasks</h1>
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

      <section aria-labelledby="mine" data-testid="my-tasks">
        <h2 id="mine">{`My tasks (${unfinished.length} to do${unfinished.some((task) => task.overdue) ? `, ${unfinished.filter((task) => task.overdue).length} overdue` : ''})`}</h2>
        {unfinished.length === 0 ? <p>Nothing to do.</p> : null}
        <ul>
          {unfinished.map((task) => (
            <TaskItem key={task.id} task={task} canMove back={back} assignees={assigneesAt(task.schoolId)} />
          ))}
        </ul>
        {finished.length > 0 ? (
          <details>
            <summary>{`Finished (${finished.length})`}</summary>
            <ul>
              {finished.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  canMove
                  back={back}
                  assignees={assigneesAt(task.schoolId)}
                />
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {view.overdue.length > 0 ? (
        <section aria-labelledby="overdue" data-testid="overdue">
          <h2 id="overdue">Overdue at your schools</h2>
          <ul>
            {view.overdue.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                canMove={false}
                back={back}
                assignees={assigneesAt(task.schoolId)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {view.setByMe.length > 0 ? (
        <section aria-labelledby="set" data-testid="set-by-me">
          <h2 id="set">Set by me</h2>
          <ul>
            {view.setByMe.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                canMove={false}
                back={back}
                assignees={assigneesAt(task.schoolId)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {view.assignable.length > 0 ? (
        <section aria-labelledby="add-task">
          <h2 id="add-task">Add a task</h2>
          <form method="post" action="/tasks/actions" style={grid}>
            <input type="hidden" name="action" value="task" />
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
                {view.assignable.map((place) => (
                  <optgroup key={place.schoolId ?? 'group'} label={place.schoolName ?? 'The group'}>
                    {place.people.map((person) => (
                      <option key={person.personId} value={assigneeValue(place.schoolId, person.personId)}>
                        {person.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <button type="submit" data-testid="add-task">
              Add the task
            </button>
          </form>
        </section>
      ) : null}

      <section aria-labelledby="projects" data-testid="projects">
        <h2 id="projects">Projects</h2>
        {view.projects.length === 0 ? <p>None.</p> : null}
        <ul>
          {view.projects.map((project) => (
            <li key={project.id}>
              <Link href={`/projects/${project.id}`}>{project.name}</Link>
              {` · ${[
                project.schoolName ?? 'the group',
                project.status === 'closed' ? 'closed' : `${project.openTasks} to do`,
                project.overdueTasks > 0 ? `${project.overdueTasks} overdue` : null,
                `${project.doneTasks} done`,
                `led by ${project.owner.name}`,
              ]
                .filter(Boolean)
                .join(' · ')}`}
            </li>
          ))}
        </ul>
        {view.projectPlaces.length > 0 ? (
          <details>
            <summary>Start a project</summary>
            <form method="post" action="/tasks/actions" style={grid}>
              <input type="hidden" name="action" value="project" />
              <label>
                Name <input name="name" required maxLength={200} />
              </label>
              <label>
                Description (optional) <textarea name="description" maxLength={2000} rows={2} />
              </label>
              <label>
                For{' '}
                <select name="school_id">
                  {view.projectPlaces.map((place) => (
                    <option key={place.schoolId ?? 'group'} value={place.schoolId ?? 'group'}>
                      {place.schoolName ?? 'The group'}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" data-testid="start-project">
                Start the project
              </button>
            </form>
          </details>
        ) : null}
      </section>
    </main>
  );
}
