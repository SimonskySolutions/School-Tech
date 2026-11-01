-- Staff records (M6.1, ADR 0028).
BEGIN;
\ir _fixtures.sql
\echo '# 28 staff records'

-- The principal of School A records the kitchen's employment.
SELECT test.as_person(:PRA);
CREATE TEMP TABLE job ON COMMIT DROP AS
SELECT staff.record_employment(:KITA, :E1, :A, 'Cook', 'permanent', 1.0, DATE '2026-09-01', NULL, 'Kitchen.A@school-a.test', '+359888000001') AS id;
GRANT SELECT ON job TO pyth_api;
SELECT test.ok((SELECT work_email = 'kitchen.a@school-a.test' AND working_time = 1.00 FROM staff.employment WHERE id = (SELECT id FROM job)),
  'an employment is recorded, the work address in lower case');
SELECT test.expect_error(format('SELECT staff.record_employment(%L, %L, %L, ''Teacher'', ''permanent'', 1, current_date, NULL, NULL, NULL)', :TEAB, :E1, :A),
  'P0002', 'only for someone who works at the school');
SELECT test.expect_error(format('SELECT staff.record_employment(%L, %L, %L, ''Teacher'', ''permanent'', 1, current_date, NULL, NULL, NULL)', :TEAB, :E1, :B),
  '42501', 'a principal records employments at their own school only');
SELECT test.expect_error(format('SELECT staff.record_employment(%L, %L, %L, ''Cook'', ''fixed_term'', 1, current_date, NULL, NULL, NULL)', :KITA, :E1, :A),
  '23514', 'a fixed-term contract has a planned end');
SELECT test.expect_error(format('SELECT staff.record_employment(%L, %L, %L, ''Cook'', ''permanent'', 1.5, current_date, NULL, NULL, NULL)', :KITA, :E1, :A),
  '23514', 'working time is at most full time');
SELECT test.expect_error(format('SELECT staff.record_employment(%L, %L, %L, ''Cook'', ''permanent'', 0, current_date, NULL, NULL, NULL)', :KITA, :E1, :A),
  '23514', 'and more than nothing');
SELECT test.expect_error(format('SELECT staff.record_employment(%L, %L, %L, ''Cook'', ''permanent'', 0.5, current_date, NULL, NULL, ''0888'')', :KITA, :E1, :A),
  '23514', 'a work telephone in international form');
SELECT test.expect_error(format('INSERT INTO staff.employment (group_id, person_id, employer_id, school_id, position, contract_kind, working_time, start_date) VALUES (%L, %L, %L, %L, ''x'', ''permanent'', 1, current_date)', :G, :KITA, :E1, :A),
  '42501', 'nobody writes employments except through the functions');
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.expect_error(format('SELECT staff.record_employment(%L, %L, %L, ''Teacher'', ''permanent'', 1, current_date, NULL, NULL, NULL)', :TEAB, :E1, :B),
  '42501', 'a teacher records no employments');

-- A group-wide employment, by the group administrator.
RESET ROLE; SELECT test.as_person(:ADM);
CREATE TEMP TABLE group_job ON COMMIT DROP AS
SELECT staff.record_employment(:SL, :E1, NULL, 'School Life coordinator', 'fixed_term', 0.8, DATE '2026-09-01', DATE '2027-08-31', NULL, NULL) AS id;
GRANT SELECT ON group_job TO pyth_api;
SELECT test.ok((SELECT count(*) FROM staff.employment) = 2, 'the group administrator reads every employment');

-- Who reads them.
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.ok((SELECT array_agg(id) FROM staff.employment) = ARRAY[(SELECT id FROM job)], 'the member of staff sees their own employment');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.ok((SELECT array_agg(id) FROM staff.employment) = ARRAY[(SELECT id FROM job)],
  'the principal sees School A''s, not the group-wide one');
RESET ROLE; SELECT test.as_person(:CEO);
SELECT test.ok((SELECT count(*) FROM staff.employment) = 2, 'the CEO sees both');
RESET ROLE; SELECT test.as_person(:SL);
SELECT test.ok((SELECT array_agg(id) FROM staff.employment) = ARRAY[(SELECT id FROM group_job)], 'School Life sees only their own');
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.ok((SELECT count(*) FROM staff.employment) = 0, 'a teacher sees no colleague''s');
RESET ROLE; SELECT test.as_person(:FIN);
SELECT test.ok((SELECT count(*) FROM staff.employment) = 0, 'nor does group finance');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok((SELECT count(*) FROM staff.employment) = 0, 'nor a parent');

-- The staff page's list: names and roles, to staff.read only.
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.ok((SELECT array_agg(given_name ORDER BY given_name) FROM staff.school_staff(:A)) = ARRAY['Kalina', 'Petar'],
  'the principal lists School A''s staff');
SELECT test.ok((SELECT roles FROM staff.school_staff(:A) WHERE person_id = :KITA) = ARRAY['kitchen'], 'with their roles there');
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.ok((SELECT count(*) FROM staff.school_staff(:A)) = 0, 'the kitchen lists nobody');
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.ok((SELECT count(*) FROM staff.school_staff(:A)) = 0, 'nor does a teacher at another school');

-- Ending an employment.
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.expect_error('SELECT staff.end_employment((SELECT id FROM job), DATE ''2027-06-30'')', 'P0002', 'others cannot end it');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT staff.end_employment((SELECT id FROM job), DATE '2027-06-30');
SELECT test.expect_error('SELECT staff.end_employment((SELECT id FROM job), DATE ''2027-07-31'')', 'PY001', 'an end is not pushed later');
SELECT staff.end_employment((SELECT id FROM job), DATE '2027-03-31');
SELECT test.ok((SELECT end_date FROM staff.employment WHERE id = (SELECT id FROM job)) = DATE '2027-03-31', 'but may come earlier');
SELECT test.expect_error('SELECT staff.end_employment((SELECT id FROM group_job), DATE ''2027-03-31'')', 'P0002',
  'a principal does not end a group-wide employment');
RESET ROLE;
SELECT test.ok((SELECT count(*) FROM access.role_assignment WHERE person_id = :KITA AND revoked_at IS NULL) = 1,
  'ending an employment leaves the role as it is');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM audit.change_log WHERE changes::text LIKE '%+359888000001%' OR changes::text LIKE '%kitchen.a@school-a%'),
  'work contacts are redacted from the audit log');

ROLLBACK;
