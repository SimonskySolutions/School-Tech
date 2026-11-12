-- Retention and requests from prospective families (M5.6, ADR 0026).
BEGIN;
\ir _fixtures.sql
\echo '# 26 admissions retention'

SELECT test.as_person(:DPO);
SELECT admissions.publish_privacy_notice(repeat('Synthetic admissions notice. ', 3), 'News about open days (synthetic)');
RESET ROLE;
CREATE TEMP TABLE notice ON COMMIT DROP AS SELECT id FROM admissions.privacy_notice WHERE group_id = :G;
GRANT SELECT ON notice TO pyth_api;
\set WA '''c9000000-0000-7000-8000-0000000000a6'''
INSERT INTO org.website (id, group_id, code, name, purpose, cms_tenant_key, status) VALUES (:WA, :G, 'test-a6', 'School A site', 'school', 'test-a6', 'live');

-- Inquiries: closed long ago, closed lately, untouched for long, and one to erase on request.
CREATE TEMP TABLE inq (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT ON inq TO pyth_api;
WITH made AS (
  INSERT INTO admissions.inquiry (group_id, school_id, website_id, notice_id, parent_name, email, message, status, outcome, closed_at, received_at, last_activity_at, news_consent_at)
  VALUES (:G, :A, :WA, (SELECT id FROM notice), 'Old Closed', 'old@example.test', 'An old question (synthetic)', 'closed', 'not_interested', now() - interval '400 days', now() - interval '410 days', now() - interval '400 days', NULL),
         (:G, :A, :WA, (SELECT id FROM notice), 'Recent Closed', 'recent@example.test', NULL, 'closed', 'no_response', now() - interval '10 days', now() - interval '20 days', now() - interval '10 days', NULL),
         (:G, :A, :WA, (SELECT id FROM notice), 'Old Open', 'idle@example.test', NULL, 'new', NULL, NULL, now() - interval '400 days', now() - interval '400 days', NULL),
         (:G, :A, :WA, (SELECT id FROM notice), 'Asks Erasure', 'erase@example.test', 'Please forget me (synthetic)', 'new', NULL, NULL, now(), now(), now())
  RETURNING id, parent_name)
INSERT INTO inq SELECT parent_name, id FROM made;
INSERT INTO admissions.inquiry_note (group_id, inquiry_id, author_person_id, kind, body)
VALUES (:G, (SELECT id FROM inq WHERE name = 'Old Closed'), :PRA, 'call', 'Called about the old question (synthetic).');

-- Applications: refused long ago (with a note), withdrawn lately, an offered one and a waiting one.
SELECT test.as_person(:PRA);
CREATE TEMP TABLE intake ON COMMIT DROP AS SELECT admissions.open_intake(:A, '2027/28', '1', 1, current_date - 1, current_date + 30) AS id;
GRANT SELECT ON intake TO pyth_api;
RESET ROLE; SELECT test.as_person(:Q);
CREATE TEMP TABLE app (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT, INSERT ON app TO pyth_api;
INSERT INTO app SELECT v.name, admissions.submit_application((SELECT id FROM intake), (SELECT id FROM notice), NULL, v.name, 'Georgieva', DATE '2021-01-01', 'Kindergarten (synthetic)', 'A message (synthetic)')
  FROM (VALUES ('Refused'), ('Withdrawn'), ('Offered'), ('Waiting')) AS v (name);
RESET ROLE; SELECT test.as_person(:PRA);
SELECT admissions.decide_application((SELECT id FROM app WHERE name = 'Refused'), 'rejected');
SELECT admissions.add_application_note((SELECT id FROM app WHERE name = 'Refused'), 'assessment', 'Not ready yet (synthetic).');
SELECT admissions.make_offer((SELECT id FROM app WHERE name = 'Offered'), current_date + 7);
SELECT admissions.decide_application((SELECT id FROM app WHERE name = 'Waiting'), 'waitlisted');
RESET ROLE; SELECT test.as_person(:Q);
SELECT admissions.withdraw_application((SELECT id FROM app WHERE name = 'Withdrawn'));
RESET ROLE;
UPDATE admissions.application SET decided_at = now() - interval '400 days' WHERE id = (SELECT id FROM app WHERE name = 'Refused');

-- Without an approved policy the worker erases nothing.
SELECT test.as_person(:PRA);
SELECT test.expect_error('SELECT admissions.apply_retention()', '42501', 'only the worker applies retention');
RESET ROLE; SELECT test.as_worker();
SELECT test.ok(admissions.apply_retention() = 0, 'no policy, nothing erased');
RESET ROLE;
INSERT INTO privacy.retention_policy (group_id, code, description, applies_to, retain_for, after_action)
VALUES (:G, 'admissions.unsuccessful', 'Inquiries and applications without an enrolment (synthetic)', 'admissions', interval '365 days', 'pseudonymise');
SELECT test.as_worker();
SELECT test.ok(admissions.apply_retention() = 0, 'a draft policy erases nothing either');
RESET ROLE;
UPDATE privacy.retention_policy SET status = 'approved', approved_at = now(), approved_by_person_id = :DPO WHERE code = 'admissions.unsuccessful';

-- With the approved policy: what is older than a year goes, the rest stays.
SELECT test.as_worker();
SELECT test.ok(admissions.apply_retention() = 3, 'the worker erases the two old inquiries and the old refusal');
SELECT test.ok(admissions.apply_retention() = 0, 'and nothing more the second time');
RESET ROLE;
SELECT test.ok((SELECT parent_name IS NULL AND email IS NULL AND message IS NULL AND erased_at IS NOT NULL AND outcome = 'not_interested'
                  FROM admissions.inquiry WHERE id = (SELECT id FROM inq WHERE name = 'Old Closed')),
  'an old closed inquiry is emptied, its outcome kept for counting');
SELECT test.ok((SELECT body IS NULL AND erased_at IS NOT NULL FROM admissions.inquiry_note
                 WHERE inquiry_id = (SELECT id FROM inq WHERE name = 'Old Closed')), 'with its contact log');
SELECT test.ok((SELECT status = 'closed' AND outcome = 'no_response' AND erased_at IS NOT NULL
                  FROM admissions.inquiry WHERE id = (SELECT id FROM inq WHERE name = 'Old Open')),
  'an inquiry nobody touched for the period is closed as no response and emptied');
SELECT test.ok((SELECT parent_name = 'Recent Closed' AND erased_at IS NULL FROM admissions.inquiry WHERE id = (SELECT id FROM inq WHERE name = 'Recent Closed')),
  'a recent inquiry stays');
SELECT test.ok((SELECT child_given_name IS NULL AND child_birth_date IS NULL AND message IS NULL AND current_school IS NULL
                       AND status = 'rejected' AND erased_at IS NOT NULL
                  FROM admissions.application WHERE id = (SELECT id FROM app WHERE name = 'Refused')),
  'an old refused application is emptied, its state kept');
SELECT test.ok((SELECT body IS NULL FROM admissions.application_note WHERE application_id = (SELECT id FROM app WHERE name = 'Refused')),
  'with its assessment note');
SELECT test.ok((SELECT child_given_name = 'Withdrawn' FROM admissions.application WHERE id = (SELECT id FROM app WHERE name = 'Withdrawn')),
  'a recent withdrawal stays');

-- Erasure on request by admissions staff.
SELECT test.as_person(:KITA);
SELECT test.expect_error('SELECT admissions.erase_inquiry((SELECT id FROM inq WHERE name = ''Asks Erasure''))', 'P0002',
  'the kitchen erases nothing');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT admissions.withdraw_news_consent((SELECT id FROM inq WHERE name = 'Asks Erasure'));
SELECT test.expect_error('SELECT admissions.withdraw_news_consent((SELECT id FROM inq WHERE name = ''Asks Erasure''))', 'PY001',
  'a withdrawn consent is withdrawn once');
SELECT admissions.erase_inquiry((SELECT id FROM inq WHERE name = 'Asks Erasure'));
SELECT test.expect_error('SELECT admissions.erase_inquiry((SELECT id FROM inq WHERE name = ''Asks Erasure''))', 'PY001',
  'an erased inquiry is erased once');
SELECT test.ok((SELECT received = 4 AND closed = 4 FROM admissions.inquiry_counts(NULL) WHERE website_id = :WA),
  'erased inquiries are still counted');
RESET ROLE;
SELECT test.ok((SELECT parent_name IS NULL AND status = 'closed' AND news_consent_at IS NULL FROM admissions.inquiry
                 WHERE id = (SELECT id FROM inq WHERE name = 'Asks Erasure')), 'the inquiry is erased at the family''s request');
SELECT test.ok((SELECT count(*) FROM privacy.data_subject_request WHERE group_id = :G AND kind = 'erasure' AND status = 'completed'
                   AND handled_by_person_id = :PRA AND completed_at IS NOT NULL) = 1,
  'and the request is recorded as completed');

-- Erasing a live application withdraws it and passes its place on.
SELECT test.as_person(:PRA);
SELECT admissions.erase_application((SELECT id FROM app WHERE name = 'Offered'));
RESET ROLE;
SELECT test.ok((SELECT status = 'withdrawn' AND erased_at IS NOT NULL AND child_given_name IS NULL FROM admissions.application
                 WHERE id = (SELECT id FROM app WHERE name = 'Offered')), 'an erased offer is withdrawn and emptied');
SELECT test.ok((SELECT status FROM admissions.application WHERE id = (SELECT id FROM app WHERE name = 'Waiting')) = 'offered',
  'and its place goes to the waiting list');

-- Export (Art. 15): everything held, logged and recorded.
SELECT test.as_person(:TEAB);
SELECT test.expect_error('SELECT admissions.export_inquiry((SELECT id FROM inq WHERE name = ''Recent Closed''))', 'P0002',
  'staff at another school export nothing');
RESET ROLE; SELECT test.as_person(:PRA);
CREATE TEMP TABLE exported ON COMMIT DROP AS SELECT admissions.export_inquiry((SELECT id FROM inq WHERE name = 'Recent Closed')) AS doc;
SELECT test.ok((SELECT doc -> 'inquiry' ->> 'parent_name' = 'Recent Closed' AND doc ->> 'school' = 'School A'
                       AND (doc ->> 'privacy_notice_version')::int = 1 AND NOT (doc -> 'inquiry' ? 'group_id') FROM exported),
  'the export holds what the family sent and the notice they saw');
SELECT test.ok((SELECT (admissions.export_application((SELECT id FROM app WHERE name = 'Withdrawn')) -> 'application' -> 'child' ->> 'given_name') = 'Withdrawn'),
  'an application exports with the child''s details');
SELECT test.ok((SELECT jsonb_array_length(admissions.export_application((SELECT id FROM app WHERE name = 'Refused')) -> 'application' -> 'notes') = 1
                       AND admissions.export_application((SELECT id FROM app WHERE name = 'Refused')) -> 'application' -> 'notes' -> 0 ->> 'text' IS NULL),
  'an erased one exports with nothing left in it');
RESET ROLE;
SELECT test.ok((SELECT count(*) FROM audit.access_log WHERE actor_person_id = :PRA AND action = 'export') >= 2, 'exports are in the access log');
SELECT test.ok((SELECT count(*) FROM privacy.data_subject_request WHERE group_id = :G AND kind = 'access' AND status = 'completed') >= 2,
  'and recorded as completed access requests');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM audit.change_log WHERE changes::text LIKE '%Please forget me%' OR changes::text LIKE '%old question%'),
  'what families wrote never reached the audit log');

-- An enrolled child's application stays with their school record.
SELECT test.as_person(:Q);
SELECT admissions.answer_offer((SELECT id FROM app WHERE name = 'Waiting'), true);
RESET ROLE; SELECT test.as_person(:PRA);
SELECT admissions.enrol_application((SELECT id FROM app WHERE name = 'Waiting'), current_date, NULL, 'mother');
SELECT test.expect_error('SELECT admissions.erase_application((SELECT id FROM app WHERE name = ''Waiting''))', 'PY001',
  'an enrolled application is not erased from admissions');
RESET ROLE;

ROLLBACK;
