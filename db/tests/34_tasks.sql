-- Tasks and projects (M6.7).
BEGIN;
\ir _fixtures.sql
\echo '# 34 tasks and projects'

CREATE TEMP TABLE k (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT, INSERT ON k TO pyth_api;
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM k WHERE name = p $$;

-- The principal of School A starts a project and gives the kitchen a task in it.
SELECT test.as_person(:PRA);
INSERT INTO k SELECT 'fair', work.create_project(:A, 'Spring fair (synthetic)', 'Stalls, menu and stage');
SELECT test.expect_error(format('SELECT work.create_project(%L, ''x'', NULL)', :B), 'P0002', 'not at another school');
SELECT test.expect_error('SELECT work.create_project(NULL, ''x'', NULL)', 'P0002', 'nor for the group');
INSERT INTO k SELECT 'menu', work.create_task(:A, pg_temp.id('fair'), 'Plan the fair menu (synthetic)', NULL, current_date + 5, :KITA);
SELECT test.expect_error(format('SELECT work.create_task(%L, %L, ''x'', NULL, NULL, %L)', :A, pg_temp.id('fair'), :TEAB),
  'P0002', 'nobody from another school is given the task');
SELECT test.expect_error(format('SELECT work.create_task(%L, NULL, ''x'', NULL, NULL, %L)', :A, :P),
  'P0002', 'nor a parent');
SELECT test.expect_error(format('SELECT work.create_task(%L, %L, ''x'', NULL, current_date - 1, %L)', :A, pg_temp.id('fair'), :KITA),
  '23514', 'a task is not due in the past');
SELECT test.expect_error(format('SELECT work.create_task(%L, %L, ''x'', NULL, NULL, %L)', :B, pg_temp.id('fair'), :KITA),
  '23514', 'a project''s task is for the project''s school');
INSERT INTO k SELECT 'stage', work.create_task(:A, pg_temp.id('fair'), 'Book the stage (synthetic)', NULL, current_date + 1, :PRA);

-- Everyone keeps their own list; only leaders give others tasks.
RESET ROLE; SELECT test.as_person(:KITA);
INSERT INTO k SELECT 'own', work.create_task(:A, NULL, 'Order aprons (synthetic)', NULL, NULL, :KITA);
SELECT test.expect_error(format('SELECT work.create_task(%L, NULL, ''x'', NULL, NULL, %L)', :A, :PRA),
  'P0002', 'the kitchen gives the principal no task');
SELECT test.expect_error(format('SELECT work.create_task(%L, %L, ''x'', NULL, NULL, %L)', :A, pg_temp.id('fair'), :KITA),
  'P0002', 'nor adds to the principal''s project');
SELECT test.expect_error(format('SELECT work.create_project(%L, ''x'', NULL)', :A), 'P0002', 'nor starts a project');
SELECT test.expect_error(format('SELECT work.create_task(%L, NULL, ''x'', NULL, NULL, %L)', :B, :KITA),
  'P0002', 'nor gives itself a task at a school where it does not work');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.expect_error(format('SELECT work.create_task(NULL, NULL, ''x'', NULL, NULL, %L)', :P), 'P0002', 'a parent keeps no task list here');
SELECT test.expect_error(format('INSERT INTO work.task (group_id, title, assignee_person_id, created_by_person_id) VALUES (%L, ''x'', %L, %L)', :G, :P, :P),
  '42501', 'nobody writes tasks except through the functions');
RESET ROLE; SELECT test.as_person(:CEO);
INSERT INTO k SELECT 'group', work.create_project(NULL, 'Group handbook (synthetic)', NULL);
INSERT INTO k SELECT 'review', work.create_task(NULL, pg_temp.id('group'), 'Review the handbook (synthetic)', NULL, NULL, :ADM);

-- Seen by those involved and the school's leaders.
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.ok((SELECT array_agg(title ORDER BY title) FROM work.task) = ARRAY['Order aprons (synthetic)', 'Plan the fair menu (synthetic)'],
  'the kitchen sees its own tasks, not the principal''s in the same project');
SELECT test.ok((SELECT array_agg(name) FROM work.project) = ARRAY['Spring fair (synthetic)'], 'and the project it has a task in');
SELECT test.ok((SELECT owner_name = 'Petar Principal' AND open_tasks = 2 AND NOT may_manage FROM work.visible_projects()),
  'with its owner and how far along it is, to look at only');
SELECT test.ok((SELECT created_by_name FROM work.visible_tasks() WHERE id = pg_temp.id('menu')) = 'Petar Principal',
  'with who set it');
SELECT test.ok((SELECT array_agg(name) FROM work.assignable_people()) = ARRAY['Kalina Kitchen', 'Kalina Kitchen'],
  'it gives tasks only to itself (at the school or for the group)');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.ok((SELECT count(*) FROM work.task) = 3, 'the principal sees the school''s tasks, the kitchen''s own list included');
SELECT test.ok((SELECT count(*) FROM work.assignable_people() WHERE school_id = :A AND person_id = :KITA) = 1
               AND NOT EXISTS (SELECT 1 FROM work.assignable_people() WHERE person_id = :TEAB),
  'and gives tasks to those who work at School A');
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.ok((SELECT count(*) FROM work.task) = 0 AND (SELECT count(*) FROM work.project) = 0, 'a teacher at School B sees none');
RESET ROLE; SELECT test.as_person(:SL);
SELECT test.ok((SELECT count(*) FROM work.task) = 0, 'School Life sees none it is not part of');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok((SELECT count(*) FROM work.visible_tasks()) = 0, 'nor does a parent');
RESET ROLE; SELECT test.as_person(:CEO);
SELECT test.ok((SELECT count(*) FROM work.task) = 4 AND (SELECT count(*) FROM work.project) = 2, 'the CEO sees them all');

-- Overdue: due before today and not finished.
RESET ROLE;
UPDATE work.task SET due_on = current_date - 2 WHERE id = pg_temp.id('stage');
SELECT test.as_person(:PRA);
SELECT test.ok((SELECT array_agg(title) FROM work.visible_tasks() WHERE overdue) = ARRAY['Book the stage (synthetic)'], 'the stage is overdue');

-- Moving along: the assignee and those who manage the task.
RESET ROLE; SELECT test.as_person(:KITA);
SELECT work.set_task_status(pg_temp.id('menu'), 'in_progress');
SELECT test.expect_error(format('SELECT work.set_task_status(%L, ''in_progress'')', pg_temp.id('menu')), 'PY001', 'once');
SELECT test.expect_error(format('SELECT work.set_task_status(%L, ''cancelled'')', pg_temp.id('menu')),
  'P0002', 'the assignee does not cancel what someone else set');
SELECT test.expect_error(format('SELECT work.update_task(%L, ''x'', NULL, NULL, %L)', pg_temp.id('menu'), :KITA),
  'P0002', 'nor changes it');
SELECT work.set_task_status(pg_temp.id('menu'), 'done');
SELECT test.ok((SELECT completed_at IS NOT NULL FROM work.task WHERE id = pg_temp.id('menu')), 'done, with when');
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.expect_error(format('SELECT work.set_task_status(%L, ''open'')', pg_temp.id('menu')), 'P0002', 'others leave it alone');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.expect_error(format('SELECT work.set_task_status(%L, ''cancelled'')', pg_temp.id('menu')), 'PY001', 'a done task is not cancelled');
SELECT test.expect_error(format('SELECT work.update_task(%L, ''x'', NULL, NULL, %L)', pg_temp.id('menu'), :KITA),
  'PY001', 'nor changed');
SELECT test.expect_error(format('SELECT work.update_task(%L, ''Book the stage (synthetic)'', NULL, NULL, %L)', pg_temp.id('stage'), :TEAB),
  'P0002', 'nor given to someone from another school');
SELECT work.update_task(pg_temp.id('stage'), 'Book the stage and sound (synthetic)', 'Two quotes', current_date + 3, :KITA);
SELECT test.ok((SELECT assignee_person_id = :KITA AND NOT overdue FROM work.visible_tasks() WHERE id = pg_temp.id('stage')),
  'the principal hands the stage to the kitchen with a new date');

-- A project closes once nothing is left to do in it.
SELECT test.expect_error(format('SELECT work.close_project(%L)', pg_temp.id('fair')), 'PY001', 'not while tasks are open');
SELECT work.set_task_status(pg_temp.id('stage'), 'cancelled');
SELECT work.close_project(pg_temp.id('fair'));
SELECT test.expect_error(format('SELECT work.close_project(%L)', pg_temp.id('fair')), 'PY001', 'closed once');
SELECT test.expect_error(format('SELECT work.create_task(%L, %L, ''x'', NULL, NULL, %L)', :A, pg_temp.id('fair'), :KITA),
  'PY001', 'a closed project takes no new task');
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.expect_error(format('SELECT work.close_project(%L)', pg_temp.id('group')), 'P0002', 'the kitchen closes no project');
RESET ROLE;

ROLLBACK;
