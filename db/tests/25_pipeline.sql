-- The admissions pipeline in numbers (M5.5).
BEGIN;
\ir _fixtures.sql
\echo '# 25 admissions pipeline'

SELECT test.as_person(:DPO);
SELECT admissions.publish_privacy_notice(repeat('Synthetic admissions notice. ', 3), 'News about open days (synthetic)');
RESET ROLE;
CREATE TEMP TABLE notice ON COMMIT DROP AS SELECT id FROM admissions.privacy_notice WHERE group_id = :G;
GRANT SELECT ON notice TO pyth_api;

-- A website for School A, three inquiries (one erased), an intake with applications in several states.
\set WA '''c9000000-0000-7000-8000-0000000000a5'''
INSERT INTO org.website (id, group_id, code, name, purpose, cms_tenant_key, status) VALUES (:WA, :G, 'test-a5', 'School A site', 'school', 'test-a5', 'live');
INSERT INTO admissions.inquiry (group_id, school_id, website_id, notice_id, parent_name, email, status, outcome, closed_at, erased_at) VALUES
  (:G, :A, :WA, (SELECT id FROM notice), 'One Test', 'one@example.test', 'new', NULL, NULL, NULL),
  (:G, :A, :WA, (SELECT id FROM notice), 'Two Test', 'two@example.test', 'closed', 'applied', now(), NULL),
  (:G, :A, :WA, (SELECT id FROM notice), NULL, NULL, 'closed', 'not_interested', now(), now());
SELECT test.as_person(:PRA);
CREATE TEMP TABLE intake ON COMMIT DROP AS SELECT admissions.open_intake(:A, '2027/28', '1', 2, current_date - 1, current_date + 30) AS id;
GRANT SELECT ON intake TO pyth_api;
RESET ROLE; SELECT test.as_person(:Q);
CREATE TEMP TABLE app ON COMMIT DROP AS
SELECT admissions.submit_application((SELECT id FROM intake), (SELECT id FROM notice), NULL, v.name, 'Georgieva', DATE '2021-01-01', NULL, NULL) AS id, v.name
  FROM (VALUES ('Ana'), ('Bea'), ('Cia')) AS v (name);
GRANT SELECT ON app TO pyth_api;
RESET ROLE; SELECT test.as_person(:PRA);
SELECT admissions.make_offer((SELECT id FROM app WHERE name = 'Ana'), current_date + 7);
SELECT admissions.decide_application((SELECT id FROM app WHERE name = 'Bea'), 'waitlisted');
RESET ROLE;

-- The school's admissions staff see their school's numbers.
SELECT test.as_person(:PRA);
SELECT test.ok((SELECT (places, submitted, waitlisted, offered) = (2, 1, 1, 1) FROM admissions.intake_counts()),
  'the principal sees the intake''s applications by state');
SELECT test.ok((SELECT (received, waiting, closed, applied) = (3, 1, 2, 1) FROM admissions.inquiry_counts(NULL) WHERE website_id = :WA),
  'and the inquiries by website, an erased one still counted');
SELECT test.ok((SELECT count(*) FROM admissions.inquiry_counts(current_date + 1)) = 0, 'counted from a day on');

-- The CEO sees the numbers for every school, and still no record.
RESET ROLE; SELECT test.as_person(:CEO);
SELECT test.ok((SELECT submitted + waitlisted + offered FROM admissions.intake_counts() WHERE intake_id = (SELECT id FROM intake)) = 3,
  'the CEO sees the application numbers');
SELECT test.ok((SELECT received FROM admissions.inquiry_counts(NULL) WHERE website_id = :WA) = 3, 'and the inquiry numbers');
SELECT test.ok((SELECT count(*) FROM admissions.application) = 0 AND (SELECT count(*) FROM admissions.inquiry) = 0,
  'but reads no application or inquiry');

-- Nobody else.
RESET ROLE; SELECT test.as_person(:SL);
SELECT test.ok((SELECT count(*) FROM admissions.intake_counts()) = 0 AND (SELECT count(*) FROM admissions.inquiry_counts(NULL)) = 0,
  'School Life sees no numbers');
RESET ROLE; SELECT test.as_person(:FIN);
SELECT test.ok((SELECT count(*) FROM admissions.intake_counts()) = 0, 'nor does group finance');
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.ok((SELECT count(*) FROM admissions.intake_counts()) = 0, 'nor a teacher');
RESET ROLE; SELECT test.as_person(:Q);
SELECT test.ok((SELECT count(*) FROM admissions.intake_counts()) = 0 AND (SELECT count(*) FROM admissions.inquiry_counts(NULL)) = 0,
  'nor a parent who applied');
RESET ROLE; SELECT test.as_anonymous();
SELECT test.ok((SELECT count(*) FROM admissions.intake_counts()) = 0, 'nor a visitor without sign-in');
RESET ROLE;

ROLLBACK;
