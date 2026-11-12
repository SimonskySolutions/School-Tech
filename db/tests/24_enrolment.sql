-- The enrolment hand-off (M5.4).
BEGIN;
\ir _fixtures.sql
\echo '# 24 admissions enrolment'

SELECT test.as_person(:DPO);
SELECT admissions.publish_privacy_notice(repeat('Synthetic admissions notice. ', 3), 'News about open days (synthetic)');
RESET ROLE;
CREATE TEMP TABLE notice ON COMMIT DROP AS SELECT id FROM admissions.privacy_notice WHERE group_id = :G;
GRANT SELECT ON notice TO pyth_api;
UPDATE people.guardian_relationship SET can_consent = true WHERE guardian_person_id = :P AND student_person_id = :K2;
SELECT test.as_person(:PRA);
CREATE TEMP TABLE intake ON COMMIT DROP AS
SELECT admissions.open_intake(:A, '2027/28', '1', 3, current_date - 1, current_date + 30) AS id;
GRANT SELECT ON intake TO pyth_api;
RESET ROLE;

-- Q applies for a child new to the group, P for K2 (at C); both accept their offers.
CREATE TEMP TABLE app (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT, INSERT ON app TO pyth_api;
SELECT test.as_person(:Q);
INSERT INTO app SELECT 'new', admissions.submit_application((SELECT id FROM intake), (SELECT id FROM notice), NULL, 'Nova', 'Georgieva', DATE '2021-03-03', 'Kindergarten 5 (synthetic)', NULL);
RESET ROLE; SELECT test.as_person(:P);
INSERT INTO app SELECT 'known', admissions.submit_application((SELECT id FROM intake), (SELECT id FROM notice), :K2, NULL, NULL, NULL, NULL, NULL);
INSERT INTO app SELECT 'pending', admissions.submit_application((SELECT id FROM intake), (SELECT id FROM notice), NULL, 'Pen', 'Ivanov', DATE '2021-01-01', NULL, NULL);
RESET ROLE; SELECT test.as_person(:PRA);
SELECT admissions.make_offer(id, current_date + 7) FROM app;
RESET ROLE; SELECT test.as_person(:Q);
SELECT admissions.answer_offer((SELECT id FROM app WHERE name = 'new'), true);
RESET ROLE; SELECT test.as_person(:P);
SELECT admissions.answer_offer((SELECT id FROM app WHERE name = 'known'), true);
RESET ROLE;

-- Who may enrol: the school's admissions staff who also manage enrolments and guardians.
SELECT test.as_person(:TEAB);
SELECT test.expect_error('SELECT admissions.enrol_application((SELECT id FROM app WHERE name = ''new''), current_date, NULL, ''mother'')',
  'P0002', 'staff at another school cannot enrol');
RESET ROLE; SELECT test.as_person(:SL);
SELECT test.expect_error('SELECT admissions.enrol_application((SELECT id FROM app WHERE name = ''new''), current_date, NULL, ''mother'')',
  'P0002', 'School Life cannot enrol');
RESET ROLE; SELECT test.as_person(:Q);
SELECT test.expect_error('SELECT admissions.enrol_application((SELECT id FROM app WHERE name = ''new''), current_date, NULL, ''mother'')',
  'P0002', 'the family cannot enrol themselves');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.expect_error('SELECT admissions.enrol_application((SELECT id FROM app WHERE name = ''pending''), current_date, NULL, ''father'')',
  'PY001', 'only an accepted place is enrolled');
SELECT test.expect_error('SELECT admissions.enrol_application((SELECT id FROM app WHERE name = ''new''), current_date, NULL, NULL)',
  '23514', 'for a new child the relationship must be stated');
SELECT test.expect_error('SELECT admissions.enrol_application((SELECT id FROM app WHERE name = ''new''), current_date, NULL, ''neighbour'')',
  '23514', 'only known relationships');

-- A child new to the group.
CREATE TEMP TABLE nova ON COMMIT DROP AS
SELECT admissions.enrol_application((SELECT id FROM app WHERE name = 'new'), DATE '2027-09-15', '1B', 'mother') AS id;
GRANT SELECT ON nova TO pyth_api;
RESET ROLE;
SELECT test.ok((SELECT given_name = 'Nova' AND family_name = 'Georgieva' AND date_of_birth = DATE '2021-03-03' AND registered_school_id = :A
                  FROM people.person WHERE id = (SELECT id FROM nova)),
  'the new child becomes a person with the details from the application');
SELECT test.ok((SELECT status = 'active' AND relationship = 'mother' AND can_consent AND verified_by_person_id = :PRA AND verified_at IS NOT NULL
                  FROM people.guardian_relationship WHERE student_person_id = (SELECT id FROM nova) AND guardian_person_id = :Q),
  'the parent who applied becomes the guardian, verified by the principal');
SELECT test.ok((SELECT count(*) FROM people.guardian_relationship WHERE student_person_id = (SELECT id FROM nova)) = 1,
  'and nobody else does');
SELECT test.ok((SELECT academic_year = '2027/2028' AND grade_level = '1' AND class_label = '1B' AND status = 'active' AND start_date = DATE '2027-09-15'
                  FROM people.enrolment WHERE student_person_id = (SELECT id FROM nova) AND school_id = :A),
  'the child is enrolled for the intake''s year and grade');
SELECT test.ok((SELECT status = 'enrolled' AND enrolment_id IS NOT NULL AND enrolled_by_person_id = :PRA
                       AND student_person_id = (SELECT id FROM nova) AND child_given_name IS NULL AND child_birth_date IS NULL
                  FROM admissions.application WHERE id = (SELECT id FROM app WHERE name = 'new')),
  'the application is enrolled and no longer holds the child''s details');

-- Exactly once.
SELECT test.as_person(:PRA);
SELECT test.expect_error('SELECT admissions.enrol_application((SELECT id FROM app WHERE name = ''new''), current_date, NULL, ''mother'')',
  'PY001', 'an application is enrolled once');
RESET ROLE; SELECT test.as_person(:Q);
SELECT test.expect_error('SELECT admissions.withdraw_application((SELECT id FROM app WHERE name = ''new''))',
  'PY001', 'an enrolled application cannot be withdrawn');
SELECT test.ok(access.is_guardian_of((SELECT id FROM nova), 'pay') AND access.is_guardian_of((SELECT id FROM nova), 'consent'),
  'the parent can now pay and consent for the child');
SELECT test.ok((SELECT count(*) FROM people.enrolment WHERE student_person_id = (SELECT id FROM nova)) = 1, 'and sees the enrolment');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok(NOT EXISTS (SELECT 1 FROM people.person WHERE id = (SELECT id FROM nova)), 'another parent does not see the child');

-- A child of the group: enrolled as they are, with no new relationship.
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.ok(admissions.enrol_application((SELECT id FROM app WHERE name = 'known'), DATE '2027-09-15', NULL, NULL) = :K2,
  'a known child is enrolled as themselves');
RESET ROLE;
SELECT test.ok((SELECT count(*) FROM people.guardian_relationship WHERE student_person_id = :K2) = 2,
  'their guardians stay as they were');
SELECT test.ok((SELECT count(*) FROM people.enrolment WHERE student_person_id = :K2 AND school_id = :A AND academic_year = '2027/2028') = 1,
  'with an enrolment at the new school');

-- The enrolled places stay taken.
SELECT test.ok((SELECT count(*) FROM admissions.application WHERE intake_id = (SELECT id FROM intake) AND status IN ('offered', 'accepted', 'enrolled')) = 3,
  'enrolled places count against the intake');
SELECT test.as_person(:Q);
INSERT INTO app SELECT 'late', admissions.submit_application((SELECT id FROM intake), (SELECT id FROM notice), NULL, 'Late', 'Georgiev', DATE '2021-02-02', NULL, NULL);
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.expect_error('SELECT admissions.make_offer((SELECT id FROM app WHERE name = ''late''), current_date + 7)',
  'PY024', 'so no fourth offer for three places');
RESET ROLE;
SELECT test.ok(NOT EXISTS (SELECT 1 FROM audit.change_log WHERE changes::text LIKE '%Nova%' OR changes::text LIKE '%2021-03-03%'),
  'the child''s name and date of birth never reach the audit log');

ROLLBACK;
