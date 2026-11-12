-- Finding an existing parent by e-mail, to link them to a child at another school.
BEGIN;
\ir _fixtures.sql
\echo '# 13 finding a person by e-mail'

-- The principal of School A cannot see Parent Q (whose child is at School B)...
SELECT test.as_person(:PRA);
SELECT test.ok((SELECT count(*) FROM people.person WHERE id = :Q) = 0,
  'the principal of School A cannot read Parent Q');
-- ...but can learn Q's id from Q's exact address, to record Q as a guardian at School A.
SELECT test.ok(people.find_person_by_email(' Q@Other.Example.test ', :A) = :Q::uuid,
  'the principal finds an existing parent by exact e-mail (case and spaces ignored)');
SELECT test.ok(people.find_person_by_email('nobody@example.test', :A) IS NULL, 'an unknown address finds nothing');
SELECT test.ok(people.find_person_by_email('q@other.example.test', :B) IS NULL,
  'the principal of School A cannot look up for School B');
SELECT test.ok((SELECT count(*) FROM people.person WHERE id = :Q) = 0,
  'the lookup returns only the id; Q stays unreadable');

RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.ok(people.find_person_by_email('q@other.example.test', :B) IS NULL,
  'a teacher (no guardians.manage) finds nothing');

RESET ROLE; SELECT test.as_anonymous();
SELECT test.ok(people.find_person_by_email('q@other.example.test', :A) IS NULL, 'no person context finds nothing');

RESET ROLE;
SELECT test.ok((SELECT count(*) FROM audit.access_log
                 WHERE actor_person_id = :PRA AND resource = 'people.person:find_by_email') = 2
           AND (SELECT count(*) FROM audit.access_log
                 WHERE actor_person_id = :PRA AND subject_person_id = :Q AND record_count = 1) = 1,
  'every allowed lookup is in the access log, with what it found (refused ones return before looking)');

ROLLBACK;
