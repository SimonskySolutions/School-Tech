import {
  type ProjectRequestBody,
  type TaskRequestBody,
  type TaskStatus,
  type TaskUpdateBody,
  TASK_STATUSES,
} from '@pythagoras/shared';
import { FormProblem, text } from './admin';

// Tasks and projects (M6.7): labels, notices and the forms read into the
// API's request bodies. The API and the database check everything again.

type Form = Pick<FormData, 'get'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const TASK_NOTICES: Record<string, string> = {
  task: 'The task is added.',
  status: 'The task is updated.',
  updated: 'The task is changed.',
  project: 'The project is started. Add its tasks below.',
  closed: 'The project is closed.',
};

/** The value of an assignee option: "<school id or group>:<person id>". */
export const assigneeValue = (schoolId: string | null, personId: string) =>
  `${schoolId ?? 'group'}:${personId}`;

const titleOf = (form: Form) => {
  const title = text(form, 'title');
  if (!title || title.length > 200) throw new FormProblem('give the task a title');
  return title;
};
const detailsOf = (form: Form) => {
  const details = text(form, 'details');
  if (details.length > 4000) throw new FormProblem('the details are at most 4000 characters');
  return details;
};
const dueOf = (form: Form) => {
  const due = text(form, 'due_on');
  if (due && !DAY.test(due)) throw new FormProblem('give the due date as a date');
  return due;
};

/** A new task: alone (the assignee option names the school) or in a project. */
export function taskBody(form: Form): TaskRequestBody {
  const title = titleOf(form);
  const details = detailsOf(form);
  const due = dueOf(form);
  const [place, assigneeId] = text(form, 'assignee').split(':');
  if (!assigneeId || !UUID.test(assigneeId) || (place !== 'group' && !UUID.test(place ?? ''))) {
    throw new FormProblem('choose who does it');
  }
  const projectId = text(form, 'project_id');
  if (projectId && !UUID.test(projectId)) throw new FormProblem('no such project');
  return {
    title,
    ...(details ? { details } : {}),
    ...(due ? { dueOn: due } : {}),
    assigneeId,
    ...(place !== 'group' ? { schoolId: place } : {}),
    ...(projectId ? { projectId } : {}),
  };
}

export function taskUpdateBody(form: Form): TaskUpdateBody {
  const title = titleOf(form);
  const details = detailsOf(form);
  const assigneeId = text(form, 'assignee_id');
  if (!UUID.test(assigneeId)) throw new FormProblem('choose who does it');
  return { title, ...(details ? { details } : {}), dueOn: dueOf(form) || null, assigneeId };
}

export function taskStatus(form: Form): TaskStatus {
  const status = text(form, 'status');
  if (!(TASK_STATUSES as readonly string[]).includes(status)) throw new FormProblem('no such state');
  return status as TaskStatus;
}

export function projectBody(form: Form): ProjectRequestBody {
  const name = text(form, 'name');
  if (!name || name.length > 200) throw new FormProblem('give the project a name');
  const description = text(form, 'description');
  if (description.length > 2000) throw new FormProblem('the description is at most 2000 characters');
  const place = text(form, 'school_id');
  if (place !== 'group' && !UUID.test(place)) throw new FormProblem('choose the school');
  return { name, ...(description ? { description } : {}), ...(place !== 'group' ? { schoolId: place } : {}) };
}
