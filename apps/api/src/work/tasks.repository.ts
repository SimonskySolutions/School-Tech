import {
  type AssignablePlace,
  type MyTasks,
  type ProjectRequestBody,
  type ProjectSummary,
  type ProjectView,
  type SchoolId,
  type Task,
  type TaskRequestBody,
  type TaskStatus,
  type TaskUpdateBody,
} from '@pythagoras/shared';
import { type PersonTransaction } from '../database/database';

// Tasks and projects (M6.7). work.visible_tasks() and work.visible_projects()
// decide what the signed-in person sees; every write is a work.* function
// that checks who may do it.

export class TasksRejected extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

const DATABASE_REFUSALS: Record<string, [TasksRejected['status'], string]> = {
  P0002: [404, 'no such task, project or colleague here'],
  '42501': [403, 'not permitted'],
  '23514': [422, 'a value is not allowed here'],
  PY001: [409, 'not possible in its present state'],
};

export async function refusalsAsTasks<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
    const refusal = typeof code === 'string' ? DATABASE_REFUSALS[code] : undefined;
    if (!refusal) throw error;
    // The functions' own messages say why ("tasks are still open in the project").
    const own = (code === 'PY001' || code === '23514') && typeof message === 'string';
    throw new TasksRejected(refusal[0], own ? message : refusal[1]);
  }
}

interface TaskRow {
  id: string;
  project_id: string | null;
  project_name: string | null;
  school_id: SchoolId | null;
  school_name: string | null;
  title: string;
  details: string | null;
  assignee_person_id: string;
  assignee_name: string;
  created_by_person_id: string;
  created_by_name: string;
  due_on: string | null;
  status: TaskStatus;
  completed_at: Date | null;
  created_at: Date;
  overdue: boolean;
  may_manage: boolean;
}

const taskOf = (row: TaskRow): Task => ({
  id: row.id,
  title: row.title,
  details: row.details,
  status: row.status,
  dueOn: row.due_on,
  overdue: row.overdue,
  completedAt: row.completed_at?.toISOString() ?? null,
  createdAt: row.created_at.toISOString(),
  projectId: row.project_id,
  projectName: row.project_name,
  schoolId: row.school_id,
  schoolName: row.school_name,
  assignee: { personId: row.assignee_person_id, name: row.assignee_name },
  createdBy: { personId: row.created_by_person_id, name: row.created_by_name },
  mayManage: row.may_manage,
});

// Unfinished first, then the soonest due (no date last), then the newest.
const TASK_SELECT = `SELECT id, project_id, project_name, school_id, school_name, title, details, assignee_person_id,
         assignee_name, created_by_person_id, created_by_name, to_char(due_on, 'YYYY-MM-DD') AS due_on, status,
         completed_at, created_at, overdue, may_manage
    FROM work.visible_tasks()`;
const TASK_ORDER = `ORDER BY status NOT IN ('open', 'in_progress'), due_on NULLS LAST, created_at DESC`;

interface ProjectRow {
  id: string;
  school_id: SchoolId | null;
  school_name: string | null;
  name: string;
  description: string | null;
  owner_person_id: string;
  owner_name: string;
  status: 'active' | 'closed';
  created_at: Date;
  closed_at: Date | null;
  open_tasks: string;
  overdue_tasks: string;
  done_tasks: string;
  may_manage: boolean;
}

const projectOf = (row: ProjectRow): ProjectSummary => ({
  id: row.id,
  name: row.name,
  description: row.description,
  schoolId: row.school_id,
  schoolName: row.school_name,
  owner: { personId: row.owner_person_id, name: row.owner_name },
  status: row.status,
  createdAt: row.created_at.toISOString(),
  closedAt: row.closed_at?.toISOString() ?? null,
  openTasks: Number(row.open_tasks),
  overdueTasks: Number(row.overdue_tasks),
  doneTasks: Number(row.done_tasks),
  mayManage: row.may_manage,
});

async function assignablePlaces(tx: PersonTransaction): Promise<AssignablePlace[]> {
  const rows = await tx.query<{
    school_id: SchoolId | null;
    school_name: string | null;
    person_id: string;
    name: string;
  }>(
    `SELECT a.school_id, s.name AS school_name, a.person_id, a.name
       FROM work.assignable_people() a LEFT JOIN org.school s ON s.id = a.school_id`,
  );
  const places = new Map<string, AssignablePlace>();
  for (const row of rows) {
    const key = row.school_id ?? '';
    const place = places.get(key) ?? { schoolId: row.school_id, schoolName: row.school_name, people: [] };
    place.people.push({ personId: row.person_id, name: row.name });
    places.set(key, place);
  }
  return [...places.values()];
}

/** The signed-in person's tasks, those they set, the overdue ones they see as a leader, and their projects. */
export async function myTasks(tx: PersonTransaction): Promise<MyTasks> {
  const rows = (await tx.query<TaskRow>(`${TASK_SELECT} ${TASK_ORDER}`)).map(taskOf);
  const [me] = await tx.query<{ id: string }>('SELECT app.current_person_id() AS id');
  const projects = await tx.query<ProjectRow>(
    `SELECT * FROM work.visible_projects() ORDER BY status, overdue_tasks DESC, created_at DESC`,
  );
  const places = await tx.query<{ school_id: SchoolId | null; school_name: string | null }>(
    `SELECT NULL::uuid AS school_id, NULL::text AS school_name WHERE access.has_permission('tasks.assign')
     UNION ALL
     SELECT id, name FROM (SELECT id, name FROM org.school
                            WHERE status = 'active' AND group_id = access.current_group_id()
                              AND access.has_permission('tasks.assign', id) ORDER BY name) s`,
  );
  const mine = (task: Task) => task.assignee.personId === me?.id;
  return {
    assigned: rows.filter(mine),
    setByMe: rows.filter((task) => !mine(task) && task.createdBy.personId === me?.id),
    // For those who manage them (leaders, project owners), not colleagues in a project.
    overdue: rows.filter(
      (task) => task.overdue && task.mayManage && !mine(task) && task.createdBy.personId !== me?.id,
    ),
    projects: projects.map(projectOf),
    assignable: await assignablePlaces(tx),
    projectPlaces: places.map((place) => ({ schoolId: place.school_id, schoolName: place.school_name })),
  };
}

/** A project with its tasks; null when not the reader's to see. */
export async function projectView(tx: PersonTransaction, projectId: string): Promise<ProjectView | null> {
  const [project] = await tx.query<ProjectRow>('SELECT * FROM work.visible_projects() WHERE id = $1', [
    projectId,
  ]);
  if (!project) return null;
  const tasks = await tx.query<TaskRow>(`${TASK_SELECT} WHERE project_id = $1 ${TASK_ORDER}`, [projectId]);
  // Projects are started by leaders, who give tasks to anyone working at the school.
  const assignable = project.may_manage
    ? await tx.query<{ person_id: string; name: string }>(
        'SELECT person_id, name FROM work.assignable_people() WHERE school_id IS NOT DISTINCT FROM $1',
        [project.school_id],
      )
    : [];
  return {
    project: projectOf(project),
    tasks: tasks.map(taskOf),
    assignable: assignable.map((person) => ({ personId: person.person_id, name: person.name })),
  };
}

export async function createProject(
  tx: PersonTransaction,
  body: ProjectRequestBody,
): Promise<{ id: string }> {
  const [row] = await tx.query<{ id: string }>('SELECT work.create_project($1, $2, $3) AS id', [
    body.schoolId ?? null,
    body.name,
    body.description ?? null,
  ]);
  return { id: row!.id };
}

export async function closeProject(tx: PersonTransaction, projectId: string): Promise<{ closed: true }> {
  await tx.query('SELECT work.close_project($1)', [projectId]);
  return { closed: true };
}

export async function createTask(tx: PersonTransaction, body: TaskRequestBody): Promise<{ id: string }> {
  const [row] = await tx.query<{ id: string }>(
    'SELECT work.create_task($1, $2, $3, $4, $5::date, $6) AS id',
    [
      body.schoolId ?? null,
      body.projectId ?? null,
      body.title,
      body.details ?? null,
      body.dueOn ?? null,
      body.assigneeId,
    ],
  );
  return { id: row!.id };
}

export async function setTaskStatus(
  tx: PersonTransaction,
  taskId: string,
  status: TaskStatus,
): Promise<{ status: TaskStatus }> {
  await tx.query('SELECT work.set_task_status($1, $2)', [taskId, status]);
  return { status };
}

export async function updateTask(
  tx: PersonTransaction,
  taskId: string,
  body: TaskUpdateBody,
): Promise<{ updated: true }> {
  await tx.query('SELECT work.update_task($1, $2, $3, $4::date, $5)', [
    taskId,
    body.title,
    body.details ?? null,
    body.dueOn ?? null,
    body.assigneeId,
  ]);
  return { updated: true };
}
