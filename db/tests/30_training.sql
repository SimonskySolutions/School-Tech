-- Professional development (M6.3, ADR 0028).
BEGIN;
\ir _fixtures.sql
\echo '# 30 staff training'

SELECT test.ok(staff.school_year(DATE '2026-09-01') = '2026/27' AND staff.school_year(DATE '2027-08-31') = '2026/27'
               AND staff.school_year(DATE '2026-08-31') = '2025/26' AND staff.school_year(DATE '2099-12-01') = '2099/00',
  'the school year runs from September to August');

-- A teacher records their own training; the principal records it for their staff.
SELECT test.as_person(:TEAB);
CREATE TEMP TABLE t (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT, INSERT ON t TO pyth_api;
INSERT INTO t SELECT 'own', staff.record_training(:TEAB, 'Teaching fractions (synthetic)', 'Regional centre', 'course', current_date - 20, current_date - 19, 8, 'attended');
INSERT INTO t SELECT 'planned', staff.record_training(:TEAB, 'Maths conference (synthetic)', NULL, 'conference', current_date + 30, current_date + 31, 12, 'planned');
SELECT test.expect_error(format('SELECT staff.record_training(%L, ''x'', NULL, ''course'', current_date, current_date, 2, ''planned'')', :KITA),
  'P0002', 'a teacher records nothing for a colleague');
SELECT test.expect_error(format('SELECT staff.record_training(%L, ''x'', NULL, ''course'', current_date + 5, current_date + 5, 2, ''attended'')', :TEAB),
  '23514', 'training in the future is planned, not attended');
SELECT test.expect_error(format('SELECT staff.record_training(%L, ''x'', NULL, ''course'', current_date, current_date - 1, 2, ''planned'')', :TEAB),
  '23514', 'it ends on or after the day it starts');
SELECT test.expect_error(format('SELECT staff.record_training(%L, ''x'', NULL, ''course'', current_date, current_date, 0, ''planned'')', :TEAB),
  '23514', 'it takes some hours');
SELECT test.expect_error(format('SELECT staff.record_training(%L, ''x'', NULL, ''course'', current_date, current_date, 2, ''cancelled'')', :TEAB),
  '23514', 'it is recorded as planned or attended');
RESET ROLE; SELECT test.as_person(:PRA);
INSERT INTO t SELECT 'kitchen', staff.record_training(:KITA, 'Allergen awareness (synthetic)', NULL, 'in_school', current_date - 3, current_date - 3, 2.5, 'attended');
SELECT test.expect_error(format('SELECT staff.record_training(%L, ''x'', NULL, ''course'', current_date, current_date, 2, ''planned'')', :TEAB),
  'P0002', 'the principal records only for their own school''s staff');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.expect_error(format('SELECT staff.record_training(%L, ''x'', NULL, ''course'', current_date - 1, current_date - 1, 2, ''attended'')', :P),
  'P0002', 'a parent keeps no development record');
SELECT test.expect_error(format('INSERT INTO staff.training (group_id, person_id, title, kind, starts_on, ends_on, hours, status) VALUES (%L, %L, ''x'', ''course'', current_date, current_date, 1, ''planned'')', :G, :P),
  '42501', 'nobody writes training except through the functions');

-- Who reads it.
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.ok((SELECT count(*) FROM staff.training) = 2, 'the teacher sees their own two');
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.ok((SELECT count(*) FROM staff.training) = 1, 'the kitchen sees its own');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.ok((SELECT array_agg(title) FROM staff.training) = ARRAY['Allergen awareness (synthetic)'], 'the principal sees School A''s staff only');
RESET ROLE; SELECT test.as_person(:CEO);
SELECT test.ok((SELECT count(*) FROM staff.training) = 3, 'the CEO sees all of it');
SELECT test.ok((SELECT sum(hours) FROM staff.training WHERE status = 'attended' AND school_year = staff.school_year(current_date - 20)) >= 8,
  'hours add up per school year');
RESET ROLE; SELECT test.as_person(:SL);
SELECT test.ok((SELECT count(*) FROM staff.training) = 0, 'School Life sees none');

-- Planned training is attended once started, or cancelled; nothing else changes.
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.expect_error('SELECT staff.set_training_status((SELECT id FROM t WHERE name = ''planned''), ''attended'')', '23514',
  'not attended before it starts');
SELECT staff.set_training_status((SELECT id FROM t WHERE name = 'planned'), 'cancelled');
SELECT test.expect_error('SELECT staff.set_training_status((SELECT id FROM t WHERE name = ''planned''), ''planned'')', 'PY001',
  'cancelled training stays cancelled');
SELECT test.expect_error('SELECT staff.set_training_status((SELECT id FROM t WHERE name = ''own''), ''cancelled'')', 'PY001',
  'attended training stays attended');
SELECT test.expect_error('SELECT staff.set_training_status((SELECT id FROM t WHERE name = ''kitchen''), ''cancelled'')', 'P0002',
  'a colleague''s training is not theirs to change');
RESET ROLE;

ROLLBACK;
