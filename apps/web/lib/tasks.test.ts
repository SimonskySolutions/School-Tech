import { describe, expect, it } from 'vitest';
import { assigneeValue, projectBody, taskBody, taskStatus, taskUpdateBody } from './tasks';

const SCHOOL = 'b1000000-0000-7000-8000-00000000000a';
const PERSON = 'c1000000-0000-7000-8000-000000000009';
const PROJECT = 'e3000000-0000-7000-8000-000000000001';
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

describe('the task forms', () => {
  it('say who does the task, where, and when it is due', () => {
    expect(
      taskBody(
        form({
          title: ' Book the stage ',
          details: '',
          due_on: '2026-12-01',
          assignee: assigneeValue(SCHOOL, PERSON),
        }),
      ),
    ).toEqual({ title: 'Book the stage', dueOn: '2026-12-01', assigneeId: PERSON, schoolId: SCHOOL });
    expect(
      taskBody(
        form({ title: 'Read the handbook', assignee: assigneeValue(null, PERSON), project_id: PROJECT }),
      ),
    ).toEqual({
      title: 'Read the handbook',
      assigneeId: PERSON,
      projectId: PROJECT,
    });
    expect(() => taskBody(form({ title: 'x', assignee: `somewhere:${PERSON}` }))).toThrow('who');
    expect(() => taskBody(form({ title: '', assignee: assigneeValue(SCHOOL, PERSON) }))).toThrow('title');
    expect(() =>
      taskBody(form({ title: 'x', due_on: 'soon', assignee: assigneeValue(SCHOOL, PERSON) })),
    ).toThrow('date');
  });

  it('change a task, clearing its due date when left empty', () => {
    expect(taskUpdateBody(form({ title: 'Book', due_on: '', assignee_id: PERSON }))).toEqual({
      title: 'Book',
      dueOn: null,
      assigneeId: PERSON,
    });
    expect(taskStatus(form({ status: 'done' }))).toBe('done');
    expect(() => taskStatus(form({ status: 'later' }))).toThrow('state');
  });

  it('start a project for a school or the group', () => {
    expect(projectBody(form({ name: 'Fair', school_id: SCHOOL }))).toEqual({
      name: 'Fair',
      schoolId: SCHOOL,
    });
    expect(projectBody(form({ name: 'Handbook', school_id: 'group', description: 'For all' }))).toEqual({
      name: 'Handbook',
      description: 'For all',
    });
    expect(() => projectBody(form({ name: 'Fair', school_id: 'nowhere' }))).toThrow('school');
  });
});
