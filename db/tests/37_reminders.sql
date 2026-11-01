-- Reminders (M7.3, ADR 0031).
BEGIN;
\ir _fixtures.sql
\echo '# 37 reminders'

CREATE TEMP TABLE k (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT, INSERT ON k TO pyth_api, pyth_worker;
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM k WHERE name = p $$;
CREATE FUNCTION pg_temp.run(p_day date) RETURNS jsonb LANGUAGE sql
AS $$ SELECT jsonb_object_agg(kind, queued) FROM notify.queue_reminders(p_day) $$;
CREATE FUNCTION pg_temp.told(p_kind text) RETURNS uuid[] LANGUAGE sql
AS $$ SELECT coalesce(array_agg(person_id ORDER BY person_id), '{}') FROM notify.message WHERE kind_code = p_kind $$;

-- Tasks: one due tomorrow, one later, two overdue for the kitchen.
SELECT test.as_person(:PRA);
INSERT INTO k SELECT 'tomorrow', work.create_task(:A, NULL, 'Order bread (synthetic)', NULL, current_date + 1, :KITA);
INSERT INTO k SELECT 'later', work.create_task(:A, NULL, 'Order flour (synthetic)', NULL, current_date + 5, :KITA);
INSERT INTO k SELECT 'late1', work.create_task(:A, NULL, 'Clean the ovens (synthetic)', NULL, current_date, :KITA);
INSERT INTO k SELECT 'late2', work.create_task(:A, NULL, 'Count the forks (synthetic)', NULL, current_date, :KITA);
INSERT INTO k SELECT 'done', work.create_task(:A, NULL, 'Mop the floor (synthetic)', NULL, current_date, :KITA);
RESET ROLE;
UPDATE work.task SET due_on = current_date - 3 WHERE id = pg_temp.id('late1');
UPDATE work.task SET due_on = current_date - 1 WHERE id IN (pg_temp.id('late2'), pg_temp.id('done'));
UPDATE work.task SET status = 'done', completed_at = now() WHERE id = pg_temp.id('done');
DELETE FROM notify.message;

-- The School A kitchen's food hygiene certificate ends in ten days.
INSERT INTO staff.qualification (group_id, person_id, kind, title, awarded_on, expires_on, recorded_by_person_id)
VALUES (:G, :KITA, 'food_hygiene', 'Food hygiene (synthetic)', current_date - 700, current_date + 10, :PRA);

-- Offers: one with two days left, one with ten.
SELECT test.as_person(:DPO);
SELECT admissions.publish_privacy_notice(repeat('Synthetic admissions notice. ', 3), 'News about open days (synthetic)');
RESET ROLE; SELECT test.as_person(:PRA);
INSERT INTO k SELECT 'intake', admissions.open_intake(:A, '2027/28', '2', 5, current_date - 1, current_date + 30);
RESET ROLE; SELECT test.as_person(:P);
INSERT INTO k SELECT 'soon', admissions.submit_application(pg_temp.id('intake'), (SELECT id FROM admissions.privacy_notice WHERE group_id = :G), NULL, 'Xenia', 'Ivanova', DATE '2020-01-01', NULL, NULL);
RESET ROLE; SELECT test.as_person(:Q);
INSERT INTO k SELECT 'far', admissions.submit_application(pg_temp.id('intake'), (SELECT id FROM admissions.privacy_notice WHERE group_id = :G), NULL, 'Zara', 'Georgieva', DATE '2020-01-01', NULL, NULL);
RESET ROLE; SELECT test.as_person(:PRA);
SELECT admissions.make_offer(pg_temp.id('soon'), current_date + 2);
SELECT admissions.make_offer(pg_temp.id('far'), current_date + 10);
RESET ROLE;

-- Only the worker queues reminders.
SELECT test.as_person(:PRA);
SELECT test.expect_error('SELECT * FROM notify.queue_reminders(current_date)', '42501', 'the API queues no reminder');
RESET ROLE; SELECT test.as_worker();
SELECT test.ok(pg_temp.run(current_date) = '{"task.due": 1, "task.overdue": 1, "staff.renewals": 1, "offer.expiring": 1}',
  'today: the bread due tomorrow, the kitchen''s overdue summary, School A''s staff, the offer about to expire');
SELECT test.ok(pg_temp.run(current_date) = '{"task.due": 0, "task.overdue": 0, "staff.renewals": 0, "offer.expiring": 0}',
  'the same day again queues nothing');
SELECT test.ok(pg_temp.told('task.due') = ARRAY[:KITA::uuid] AND pg_temp.told('task.overdue') = ARRAY[:KITA::uuid],
  'the kitchen is reminded of its tasks');
SELECT test.ok((SELECT params ->> 'title' FROM notify.message WHERE kind_code = 'task.due') = 'Order bread (synthetic)',
  'of the one due tomorrow, not the one due later');
SELECT test.ok((SELECT params -> 'count' = '2' AND params -> 'titles' = '["Clean the ovens (synthetic)", "Count the forks (synthetic)"]'
                  FROM notify.message WHERE kind_code = 'task.overdue'),
  'and of the two overdue, oldest first, not the one done');
SELECT test.ok(pg_temp.told('staff.renewals') = ARRAY[:PRA::uuid]
               AND (SELECT params ->> 'people' = '1' AND params ->> 'schoolName' = 'School A' FROM notify.message WHERE kind_code = 'staff.renewals'),
  'the principal of School A hears that one member of staff needs seeing to');
SELECT test.ok(pg_temp.told('offer.expiring') = ARRAY[:P::uuid]
               AND (SELECT params ->> 'answerBy' FROM notify.message WHERE kind_code = 'offer.expiring') = to_char(current_date + 2, 'YYYY-MM-DD'),
  'the parent whose offer ends in two days is told the last day; the other is not yet');

-- Tomorrow: a new overdue summary. The staff reminder: once a week, whatever the
-- weekday (weeks from the Monday two weeks ahead, untouched by the runs above).
SELECT test.ok((pg_temp.run(current_date + 1) ->> 'task.overdue') = '1', 'the next day brings a new summary of overdue tasks');
CREATE TEMP TABLE w ON COMMIT DROP AS SELECT date_trunc('week', current_date)::date + 14 AS monday;
GRANT SELECT ON w TO pyth_worker;
SELECT test.ok((pg_temp.run((SELECT monday FROM w)) ->> 'staff.renewals') = '1', 'the staff reminder comes in a new week');
SELECT test.ok((pg_temp.run((SELECT monday FROM w) + 3) ->> 'staff.renewals') = '0', 'not again later that week');
SELECT test.ok((pg_temp.run((SELECT monday FROM w) + 7) ->> 'staff.renewals') = '1', 'and again the week after');
RESET ROLE;

ROLLBACK;
