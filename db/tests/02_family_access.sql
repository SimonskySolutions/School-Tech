-- Parents see only children they are individually authorised for.
BEGIN;
\ir _fixtures.sql
\echo '# 02 family access'

RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok((SELECT array_agg(id ORDER BY id) FROM people.person) = ARRAY[:P, :K1, :K2]::uuid[],
  'parent P sees exactly themself and children K1 (School A) and K2 (Kindergarten C)');
SELECT test.ok((SELECT array_agg(student_person_id ORDER BY student_person_id) FROM people.enrolment) = ARRAY[:K1, :K2]::uuid[],
  'parent P sees the enrolments of both children across two schools');
SELECT test.ok((SELECT count(*) FROM people.guardian_relationship) = 2,
  'parent P sees only their own two guardian relationships, not other guardians of the same children');
SELECT test.ok((SELECT count(*) FROM sensitive.dietary_requirement) = 2,
  'parent P sees the dietary records of their own children');
SELECT test.ok((SELECT count(*) FROM people.person WHERE id = :K3) = 0, 'parent P cannot see K3 from another family');
SELECT test.expect_error(format(
  'INSERT INTO people.guardian_relationship (group_id, guardian_person_id, student_person_id, relationship) VALUES (%L, %L, %L, %L)',
  :G, :P, :K3, 'parent'), '42501', 'parent P cannot create a guardian relationship for themself');
-- RLS filters the rows a parent may update to none, so the update is a no-op.
UPDATE people.guardian_relationship SET can_consent = true WHERE guardian_person_id = :P;
RESET ROLE;
SELECT test.ok(NOT EXISTS (SELECT 1 FROM people.guardian_relationship WHERE guardian_person_id = :P AND can_consent),
  'parent P cannot widen their own guardian capabilities');

RESET ROLE; SELECT test.as_person(:Q);
SELECT test.ok((SELECT array_agg(id ORDER BY id) FROM people.person) = ARRAY[:Q, :K3]::uuid[],
  'parent Q sees only themself and K3');
SELECT test.ok((SELECT count(*) FROM sensitive.dietary_requirement) = 0,
  'parent Q cannot see other children''s dietary records');

RESET ROLE; SELECT test.as_person(:R);
SELECT test.ok((SELECT array_agg(id) FROM people.person) = ARRAY[:R]::uuid[],
  'R, sharing P''s family name and e-mail domain, sees only themself');
SELECT test.ok((SELECT count(*) FROM people.enrolment) = 0, 'R sees no enrolments');

RESET ROLE; SELECT test.as_person(:S);
SELECT test.ok((SELECT array_agg(id) FROM people.person) = ARRAY[:S]::uuid[],
  'a pending, unverified guardian sees no child');
SELECT test.ok((SELECT count(*) FROM scheduling.booking) = 0 AND (SELECT count(*) FROM people.enrolment) = 0,
  'a pending guardian sees no bookings or enrolments');

RESET ROLE; SELECT test.as_person(:T);
SELECT test.ok((SELECT array_agg(id) FROM people.person) = ARRAY[:T]::uuid[],
  'a revoked guardian sees no child');

-- Expired relationships stop granting access.
RESET ROLE;
UPDATE people.guardian_relationship SET valid_from = current_date - 30, valid_until = current_date - 1
 WHERE guardian_person_id = :Q AND student_person_id = :K3;
SELECT test.as_person(:Q);
SELECT test.ok((SELECT count(*) FROM people.person WHERE id = :K3) = 0, 'an expired relationship grants nothing');

RESET ROLE; SELECT test.as_anonymous();
SELECT test.ok((SELECT count(*) FROM people.person) = 0 AND (SELECT count(*) FROM people.enrolment) = 0,
  'an anonymous request sees no personal data');
SELECT test.ok((SELECT count(*) FROM org.school) = 3 AND (SELECT count(*) FROM catalog.school_offering) = 4,
  'an anonymous request sees active schools and published offerings only');

ROLLBACK;
