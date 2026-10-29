-- Group roles see across schools, each limited to what the role needs.
BEGIN;
\ir _fixtures.sql
\echo '# 04 group roles'

RESET ROLE; SELECT test.as_person(:CEO);
SELECT test.ok((SELECT count(*) FROM people.enrolment) = 3, 'the CEO sees enrolments at all three schools');
SELECT test.ok((SELECT count(*) FROM people.person) = 16, 'the CEO sees every person in the group');
SELECT test.ok((SELECT count(*) FROM sensitive.dietary_requirement) = 0,
  'the CEO does not see children''s health data (data minimisation)');
SELECT test.ok((SELECT count(*) FROM catalog.school_offering) = 5, 'the CEO sees all offerings, including drafts');

RESET ROLE; SELECT test.as_person(:SL);
SELECT test.ok((SELECT count(*) FROM sensitive.dietary_requirement) = 2,
  'the School Life coordinator sees dietary needs at every school');
SELECT test.ok((SELECT count(*) FROM people.enrolment) = 3, 'the School Life coordinator sees enrolments at every school');
SELECT test.ok((SELECT count(*) FROM audit.change_log) = 0, 'the School Life coordinator cannot read the audit log');

RESET ROLE; SELECT test.as_person(:DPO);
SELECT test.ok((SELECT count(*) FROM people.enrolment) = 0, 'the privacy officer has no enrolment access');
SELECT test.ok((SELECT count(*) FROM audit.change_log) > 0, 'the privacy officer can read the audit log');

RESET ROLE; SELECT test.as_person(:FIN);
SELECT test.ok((SELECT count(*) FROM sensitive.dietary_requirement) = 0, 'group finance sees no health data');

ROLLBACK;
