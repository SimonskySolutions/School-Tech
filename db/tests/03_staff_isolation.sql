-- School staff see their own school only; roles are granted within scope.
BEGIN;
\ir _fixtures.sql
\echo '# 03 staff isolation'

RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.ok((SELECT array_agg(student_person_id) FROM people.enrolment) = ARRAY[:K1]::uuid[],
  'principal of School A sees only School A enrolments');
SELECT test.ok((SELECT count(*) FROM people.person WHERE id IN (:K2, :K3, :Q)) = 0,
  'principal of School A cannot see children or parents of other schools');
SELECT test.ok((SELECT count(*) FROM people.person WHERE id IN (:K1, :P, :S, :KITA)) = 4,
  'principal of School A sees its student, the student''s guardians and its staff');
SELECT test.ok((SELECT count(*) FROM sensitive.dietary_requirement) = 1,
  'principal of School A sees dietary data of School A students only');
SELECT test.ok((SELECT count(*) FROM catalog.school_offering WHERE id = :DRAFTB) = 0,
  'principal of School A cannot see School B''s draft offerings');
SELECT test.expect_error(format(
  'INSERT INTO people.enrolment (group_id, student_person_id, school_id, academic_year, start_date) VALUES (%L, %L, %L, %L, %L)',
  :G, :K3, :B, '2026/2027', '2026-09-15'), '42501', 'principal of School A cannot enrol a student at School B');
SELECT test.expect_error(format(
  'INSERT INTO access.role_assignment (group_id, person_id, role_code, school_id, granted_by_person_id) VALUES (%L, %L, %L, NULL, %L)',
  :G, :KITA, 'group_ceo', :PRA), '42501', 'principal cannot grant a group-wide role');
SELECT test.expect_error(format(
  'INSERT INTO access.role_assignment (group_id, person_id, role_code, school_id, granted_by_person_id) VALUES (%L, %L, %L, %L, %L)',
  :G, :KITA, 'teacher', :B, :PRA), '42501', 'principal of School A cannot grant roles at School B');
SELECT test.expect_error(format(
  'INSERT INTO access.role_assignment (group_id, person_id, role_code, school_id, granted_by_person_id) VALUES (%L, %L, %L, %L, %L)',
  :G, :PRA, 'kitchen', :A, :PRA), '42501', 'nobody can grant a role to themself');
INSERT INTO access.role_assignment (group_id, person_id, role_code, school_id, granted_by_person_id)
VALUES (:G, :KITA, 'teacher', :A, :PRA);
SELECT test.ok(true, 'principal of School A can grant a School A role to a colleague');

RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.ok((SELECT array_agg(student_person_id) FROM sensitive.dietary_requirement) = ARRAY[:K1]::uuid[],
  'kitchen of School A sees School A dietary needs only');
SELECT test.ok((SELECT count(*) FROM commerce.customer_order) = 0, 'kitchen staff cannot read orders');

RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.ok((SELECT array_agg(student_person_id) FROM people.enrolment) = ARRAY[:K3]::uuid[],
  'teacher of School B sees only School B enrolments');
SELECT test.ok((SELECT count(*) FROM sensitive.dietary_requirement) = 0,
  'a teacher without the dietary permission sees no health data');

-- A revoked role stops working immediately.
RESET ROLE;
UPDATE access.role_assignment SET revoked_at = now() WHERE person_id = :TEAB;
SELECT test.as_person(:TEAB);
SELECT test.ok((SELECT count(*) FROM people.enrolment) = 0, 'a revoked role grants nothing');

ROLLBACK;
