-- Intakes, applications and invitations to apply (M5.2, ADR 0027).
BEGIN;
\ir _fixtures.sql
\echo '# 22 admissions applications'

SELECT test.as_person(:DPO);
SELECT admissions.publish_privacy_notice(repeat('Synthetic admissions notice. ', 3), 'News about open days (synthetic)');
RESET ROLE;
CREATE TEMP TABLE notice ON COMMIT DROP AS SELECT id FROM admissions.privacy_notice WHERE group_id = :G AND version = 1;
GRANT SELECT ON notice TO pyth_api;

-- Intakes: the school's admissions staff open them.
SELECT test.as_person(:PRA);
CREATE TEMP TABLE intake ON COMMIT DROP AS
SELECT admissions.open_intake(:A, '2027/28', '3', 2, current_date - 1, current_date + 30) AS id;
GRANT SELECT ON intake TO pyth_api;
SELECT test.expect_error(format('SELECT admissions.open_intake(%L, ''2027/28'', ''3'', 2, current_date, current_date + 30)', :A),
  '23505', 'one intake per school, school year and grade');
SELECT test.expect_error(format('SELECT admissions.open_intake(%L, ''2027/29'', ''4'', 2, current_date, current_date + 30)', :A),
  '23514', 'the school year is two consecutive years');
SELECT test.expect_error(format('SELECT admissions.open_intake(%L, ''2027/28'', ''4'', 2, current_date, current_date - 1)', :A),
  '23514', 'an intake closes after it opens');
SELECT test.expect_error(format('SELECT admissions.open_intake(%L, ''2027/28'', ''4'', 2, current_date, current_date + 30)', :B),
  '42501', 'a principal opens intakes only at their own school');
CREATE TEMP TABLE later ON COMMIT DROP AS
SELECT admissions.open_intake(:A, '2027/28', '1', 20, current_date + 10, current_date + 40) AS id;
GRANT SELECT ON later TO pyth_api;
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.expect_error(format('SELECT admissions.open_intake(%L, ''2027/28'', ''5'', 2, current_date, current_date + 30)', :B),
  '42501', 'a teacher opens no intakes');
RESET ROLE; SELECT test.as_person(:Q);
SELECT test.ok((SELECT count(*) FROM admissions.intake WHERE school_id = :A) = 2, 'any signed-in parent sees open intakes');
RESET ROLE; SELECT test.as_anonymous();
SELECT test.ok((SELECT count(*) FROM admissions.intake) = 0, 'visitors without sign-in see no intakes');

-- Applications for one's own child.
RESET ROLE; SELECT test.as_person(:P);
SELECT test.expect_error(format('SELECT admissions.submit_application((SELECT id FROM intake), (SELECT id FROM notice), %L, NULL, NULL, NULL, NULL, NULL)', :K2),
  'P0002', 'a guardian who may not consent for the child cannot apply');
RESET ROLE;
UPDATE people.guardian_relationship SET can_consent = true WHERE guardian_person_id = :P;
SELECT test.as_person(:P);
SELECT test.expect_error(format('SELECT admissions.submit_application((SELECT id FROM intake), (SELECT id FROM notice), %L, NULL, NULL, NULL, NULL, NULL)', :K1),
  '23505', 'no application to the school the child already attends');
CREATE TEMP TABLE app_k2 ON COMMIT DROP AS
SELECT admissions.submit_application((SELECT id FROM intake), (SELECT id FROM notice), :K2, 'Ignored', 'Ignored', DATE '2019-01-01', NULL, 'Moving up from the kindergarten.') AS id;
GRANT SELECT ON app_k2 TO pyth_api;
SELECT test.ok((SELECT child_given_name IS NULL AND child_birth_date IS NULL FROM admissions.application WHERE id = (SELECT id FROM app_k2)),
  'for a known child the application adds no details about them');
SELECT test.expect_error(format('SELECT admissions.submit_application((SELECT id FROM intake), (SELECT id FROM notice), %L, NULL, NULL, NULL, NULL, NULL)', :K2),
  '23505', 'one live application per child and intake');
RESET ROLE; SELECT test.as_person(:Q);
SELECT test.expect_error(format('SELECT admissions.submit_application((SELECT id FROM intake), (SELECT id FROM notice), %L, NULL, NULL, NULL, NULL, NULL)', :K2),
  'P0002', 'nobody applies for someone else''s child');

-- Applications for a child the group does not know yet.
SELECT test.expect_error('SELECT admissions.submit_application((SELECT id FROM intake), (SELECT id FROM notice), NULL, ''Nia'', ''Georgieva'', NULL, NULL, NULL)',
  '23514', 'a new child needs a date of birth');
CREATE TEMP TABLE app_new ON COMMIT DROP AS
SELECT admissions.submit_application((SELECT id FROM intake), (SELECT id FROM notice), NULL, 'Nia', 'Georgieva', DATE '2018-05-04', 'Sofia Primary 9 (synthetic)', NULL) AS id;
GRANT SELECT ON app_new TO pyth_api;
SELECT test.expect_error('SELECT admissions.submit_application((SELECT id FROM intake), (SELECT id FROM notice), NULL, ''NIA'', ''georgieva'', DATE ''2018-05-04'', NULL, NULL)',
  '23505', 'the same new child once per intake');
SELECT test.expect_error('SELECT admissions.submit_application((SELECT id FROM later), (SELECT id FROM notice), NULL, ''Nia'', ''Georgieva'', DATE ''2018-05-04'', NULL, NULL)',
  'PY022', 'no applications before the intake opens');
SELECT test.expect_error('SELECT admissions.submit_application((SELECT id FROM intake), gen_random_uuid(), NULL, ''Ana'', ''Georgieva'', DATE ''2018-05-04'', NULL, NULL)',
  'PY020', 'an application needs the current privacy notice');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM people.person WHERE given_name = 'Nia'), 'a new child is no person until enrolment');
SELECT test.expect_error(format('INSERT INTO admissions.application (group_id, school_id, intake_id, applicant_person_id, student_person_id, notice_id) VALUES (%L, %L, (SELECT id FROM intake), %L, %L, (SELECT id FROM notice))', :G, :A, :Q, :K3),
  '42501', 'nobody writes applications except through the functions');

-- Who reads them: the parent who applied and the school's admissions staff.
RESET ROLE; SELECT test.as_person(:Q);
SELECT test.ok((SELECT array_agg(id) FROM admissions.application) = ARRAY[(SELECT id FROM app_new)], 'a parent sees only their own application');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok((SELECT array_agg(id) FROM admissions.application) = ARRAY[(SELECT id FROM app_k2)], 'and the other parent only theirs');
RESET ROLE; SELECT test.as_person(:S);
SELECT test.ok((SELECT count(*) FROM admissions.application) = 0, 'a pending guardian sees none');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.ok((SELECT count(*) FROM admissions.application) = 2, 'the principal of School A sees both');
SELECT test.ok(EXISTS (SELECT 1 FROM people.person WHERE id = :K2) AND EXISTS (SELECT 1 FROM people.person WHERE id = :Q),
  'and the person records of the child and the parent applying, though they belong to other schools');
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.ok(NOT EXISTS (SELECT 1 FROM people.person WHERE id = :K2), 'other staff at the school do not');
RESET ROLE; SELECT test.as_person(:PRA);
RESET ROLE; SELECT test.as_person(:ADM);
SELECT test.ok((SELECT count(*) FROM admissions.application) = 2, 'the group administrator sees both');
RESET ROLE; SELECT test.as_person(:CEO);
SELECT test.ok((SELECT count(*) FROM admissions.application) = 0, 'the CEO sees none');
RESET ROLE; SELECT test.as_person(:SL);
SELECT test.ok((SELECT count(*) FROM admissions.application) = 0, 'School Life sees none');
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.ok((SELECT count(*) FROM admissions.application) = 0, 'a teacher at another school sees none');

-- Review and withdrawal.
SELECT test.expect_error('SELECT admissions.review_application((SELECT id FROM app_k2))', 'P0002', 'staff at another school cannot review it');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT admissions.review_application((SELECT id FROM app_k2));
SELECT test.ok((SELECT status FROM admissions.application WHERE id = (SELECT id FROM app_k2)) = 'under_review', 'the principal reviews it');
RESET ROLE; SELECT test.as_person(:Q);
SELECT test.expect_error('SELECT admissions.withdraw_application((SELECT id FROM app_k2))', 'P0002', 'another parent cannot withdraw it');
RESET ROLE; SELECT test.as_person(:P);
SELECT admissions.withdraw_application((SELECT id FROM app_k2));
SELECT test.ok((SELECT status FROM admissions.application WHERE id = (SELECT id FROM app_k2)) = 'withdrawn', 'the parent withdraws it');
SELECT test.expect_error('SELECT admissions.withdraw_application((SELECT id FROM app_k2))', 'PY001', 'a withdrawn application stays withdrawn');
SELECT test.ok(admissions.submit_application((SELECT id FROM intake), (SELECT id FROM notice), :K2, NULL, NULL, NULL, NULL, NULL) IS NOT NULL,
  'after withdrawing, the parent can apply again');

-- A closed intake takes no more applications and disappears for parents.
RESET ROLE; SELECT test.as_person(:PRA);
SELECT admissions.close_intake((SELECT id FROM intake));
RESET ROLE; SELECT test.as_person(:Q);
SELECT test.ok((SELECT count(*) FROM admissions.intake WHERE id = (SELECT id FROM intake)) = 0, 'parents no longer see a closed intake');
SELECT test.expect_error('SELECT admissions.submit_application((SELECT id FROM intake), (SELECT id FROM notice), NULL, ''Ivo'', ''Georgiev'', DATE ''2018-01-01'', NULL, NULL)',
  'PY022', 'a closed intake takes no applications');
RESET ROLE;
SELECT test.ok(NOT EXISTS (SELECT 1 FROM audit.change_log WHERE changes::text LIKE '%Nia%' OR changes::text LIKE '%2018-05-04%'
                            OR changes::text LIKE '%Sofia Primary%' OR changes::text LIKE '%kindergarten.%'),
  'the child''s details and the message never reach the audit log');

-- Invitations: the sender of an inquiry becomes a parent who can sign in.
\set WA '''c9000000-0000-7000-8000-0000000000a2'''
INSERT INTO org.website (id, group_id, code, name, purpose, cms_tenant_key, status) VALUES (:WA, :G, 'test-a2', 'School A test', 'school', 'test-a2', 'live');
INSERT INTO admissions.inquiry (id, group_id, school_id, website_id, notice_id, parent_name, email) VALUES
  ('c9100000-0000-7000-8000-000000000001', :G, :A, :WA, (SELECT id FROM notice), 'Vera Test', 'vera.new@example.test'),
  ('c9100000-0000-7000-8000-000000000002', :G, :A, :WA, (SELECT id FROM notice), 'Parent Again', 'p@family.example.test'),
  ('c9100000-0000-7000-8000-000000000003', :G, :B, :WA, (SELECT id FROM notice), 'At B', 'at.b@example.test');
SELECT test.as_person(:PRA);
CREATE TEMP TABLE invited ON COMMIT DROP AS
SELECT * FROM admissions.invite_applicant('c9100000-0000-7000-8000-000000000001', 'Vera', 'Test');
GRANT SELECT ON invited TO pyth_api;
SELECT test.ok((SELECT email = 'vera.new@example.test' AND NOT has_login FROM invited), 'the invitation creates the parent, without a login yet');
SELECT test.ok((SELECT person_id FROM admissions.invite_applicant('c9100000-0000-7000-8000-000000000001', 'Vera', 'Test')) = (SELECT person_id FROM invited),
  'inviting again gives the same person');
SELECT test.expect_error('SELECT * FROM admissions.invite_applicant(''c9100000-0000-7000-8000-000000000002'', ''Parent'', ''Again'')',
  'PY023', 'an address the group already knows creates and links nothing');
SELECT test.expect_error('SELECT * FROM admissions.invite_applicant(''c9100000-0000-7000-8000-000000000003'', ''At'', ''B'')',
  'P0002', 'staff invite only from their own school''s inquiries');
SELECT test.expect_error(format('SELECT admissions.link_applicant_login(%L, ''kc-subject-p'')', :P),
  '42501', 'no login for a person who was not invited');
SELECT admissions.link_applicant_login((SELECT person_id FROM invited), 'kc-subject-vera');
SELECT test.expect_error('SELECT admissions.link_applicant_login((SELECT person_id FROM invited), ''kc-subject-other'')',
  '42501', 'a second login is refused');
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.expect_error('SELECT * FROM admissions.invite_applicant(''c9100000-0000-7000-8000-000000000001'', ''Vera'', ''Test'')',
  'P0002', 'the kitchen invites nobody');
RESET ROLE;
SELECT test.ok((SELECT registered_school_id = :A FROM people.person WHERE id = (SELECT person_id FROM invited))
               AND (SELECT applicant_person_id = (SELECT person_id FROM invited) FROM admissions.inquiry WHERE id = 'c9100000-0000-7000-8000-000000000001'),
  'the parent is registered at the inquiry''s school and linked to the inquiry');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM access.role_assignment WHERE person_id = (SELECT person_id FROM invited))
               AND NOT EXISTS (SELECT 1 FROM people.guardian_relationship WHERE guardian_person_id = (SELECT person_id FROM invited)),
  'an invited parent has no role and no child');
SELECT test.as_person(person_id) FROM invited;
SELECT test.ok((SELECT count(*) FROM admissions.intake) = 1, 'the invited parent sees the open intake');
RESET ROLE;
SELECT test.as_person(:PRA);
SELECT admissions.close_inquiry('c9100000-0000-7000-8000-000000000002', 'duplicate');
SELECT test.expect_error('SELECT * FROM admissions.invite_applicant(''c9100000-0000-7000-8000-000000000002'', ''P'', ''A'')',
  'PY001', 'a closed inquiry invites nobody');
RESET ROLE;

ROLLBACK;
