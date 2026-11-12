-- Inquiries from school websites (M5.1, ADR 0026).
BEGIN;
\ir _fixtures.sql
\echo '# 21 admissions inquiries'

\set WA   '''c9000000-0000-7000-8000-0000000000a1'''
\set HOST '''school-a-inquiries.test'''
INSERT INTO org.website (id, group_id, code, name, purpose, cms_tenant_key, status)
VALUES (:WA, :G, 'test-a', 'School A test website', 'school', 'test-a', 'live');
INSERT INTO org.website_school (website_id, school_id, group_id, is_primary_website_for_school) VALUES (:WA, :A, :G, true);
INSERT INTO org.website_domain (website_id, group_id, hostname, is_primary, verification_method, status, verified_at)
VALUES (:WA, :G, :HOST, true, 'local_development', 'verified', now());

-- Without a notice there is no form, and nothing can be sent.
SELECT test.as_anonymous();
SELECT test.ok((SELECT count(*) FROM admissions.inquiry_form(:HOST)) = 0, 'no form before a privacy notice is published');
RESET ROLE;

-- The privacy officer publishes the notice; nobody else can.
SELECT test.as_person(:PRA);
SELECT test.expect_error('SELECT admissions.publish_privacy_notice(repeat(''n'', 60), ''News about open days'')',
  '42501', 'a principal cannot publish the privacy notice');
RESET ROLE; SELECT test.as_person(:DPO);
SELECT test.ok(admissions.publish_privacy_notice(repeat('Synthetic admissions notice. ', 3), 'Send me news about open days (synthetic)') = 1,
  'the privacy officer publishes version 1');
RESET ROLE;
SELECT test.expect_error('UPDATE admissions.privacy_notice SET notice_text = repeat(''x'', 60)', 'PY004', 'a published notice never changes');
CREATE TEMP TABLE notice ON COMMIT DROP AS SELECT id FROM admissions.privacy_notice WHERE group_id = :G AND version = 1;
GRANT SELECT ON notice TO pyth_api;

-- A family sends the form: no sign-in, no person record.
SELECT test.as_anonymous();
SELECT test.ok((SELECT school_name FROM admissions.inquiry_form(:HOST)) = 'School A' AND (SELECT notice_version FROM admissions.inquiry_form(:HOST)) = 1,
  'the form offers the website''s school and the current notice');
SELECT test.ok((SELECT count(*) FROM admissions.inquiry_form('unknown.test')) = 0, 'no form on an unknown host');
SELECT test.expect_error(format('SELECT admissions.submit_inquiry(%L, %L, (SELECT id FROM notice), ''Vera Test'', ''vera@example.test'', NULL, NULL, NULL, NULL, NULL, NULL, false)', :HOST, :B),
  'P0002', 'an inquiry goes only to a school the website serves');
SELECT test.expect_error(format('SELECT admissions.submit_inquiry(%L, %L, gen_random_uuid(), ''Vera Test'', ''vera@example.test'', NULL, NULL, NULL, NULL, NULL, NULL, false)', :HOST, :A),
  'PY020', 'a form sent with another notice than the current one is refused');
SELECT test.expect_error(format('SELECT admissions.submit_inquiry(%L, %L, (SELECT id FROM notice), ''Vera Test'', ''not an address'', NULL, NULL, NULL, NULL, NULL, NULL, false)', :HOST, :A),
  '23514', 'the e-mail address must look like one');
SELECT admissions.submit_inquiry(:HOST, :A, (SELECT id FROM notice), 'Vera Test (synthetic)', 'Vera@Example.test', '+359 2 000 0000',
  'Lia', 2019::smallint, '2', 'September 2027', 'Is there a place in grade 2 next year?', false);
SELECT test.ok((SELECT count(*) FROM admissions.inquiry) = 0, 'the sender cannot read inquiries back');
SELECT admissions.submit_inquiry(:HOST, :A, (SELECT id FROM notice), 'Vera Test (synthetic)', 'vera@example.test', NULL,
  NULL, NULL, NULL, NULL, 'Also: is there a bus from Mladost?', true);
RESET ROLE;
SELECT test.ok((SELECT count(*) FROM admissions.inquiry WHERE school_id = :A) = 1, 'the same address sends twice: one inquiry');
SELECT test.ok((SELECT body FROM admissions.inquiry_note WHERE kind = 'family_message') = 'Also: is there a bus from Mladost?',
  'the second form is added to the open inquiry');
SELECT test.ok((SELECT email = 'vera@example.test' AND news_consent_at IS NOT NULL AND status = 'new' FROM admissions.inquiry),
  'the address is kept in lower case and the news consent is recorded when ticked');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM people.person WHERE given_name = 'Vera' OR email = 'vera@example.test'),
  'an inquiry creates no person');
CREATE TEMP TABLE inq ON COMMIT DROP AS SELECT id FROM admissions.inquiry;
GRANT SELECT ON inq TO pyth_api;

-- Who reads it: the school's admissions staff only.
SELECT test.as_person(:PRA);
SELECT test.ok((SELECT count(*) FROM admissions.inquiry) = 1 AND (SELECT count(*) FROM admissions.inquiry_note) = 1,
  'the principal of School A reads the inquiry and its log');
RESET ROLE; SELECT test.as_person(:ADM);
SELECT test.ok((SELECT count(*) FROM admissions.inquiry) = 1, 'the group administrator reads it');
RESET ROLE; SELECT test.as_person(:CEO);
SELECT test.ok((SELECT count(*) FROM admissions.inquiry) = 0, 'the CEO does not');
RESET ROLE; SELECT test.as_person(:SL);
SELECT test.ok((SELECT count(*) FROM admissions.inquiry) = 0, 'School Life does not');
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.ok((SELECT count(*) FROM admissions.inquiry) = 0, 'the kitchen does not');
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.ok((SELECT count(*) FROM admissions.inquiry) = 0, 'a teacher at another school does not');
SELECT test.expect_error('SELECT admissions.add_inquiry_note((SELECT id FROM inq), ''note'', ''x'')', 'P0002',
  'staff at another school cannot write on it');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok((SELECT count(*) FROM admissions.inquiry) = 0, 'a parent does not');
SELECT test.expect_error(format('INSERT INTO admissions.inquiry (group_id, school_id, website_id, notice_id, parent_name, email) VALUES (%L, %L, %L, (SELECT id FROM notice), ''x'', ''x@example.test'')', :G, :A, :WA),
  '42501', 'nobody writes inquiries except through the functions');

-- Working on it: contacts recorded, then closed with an outcome.
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.ok(admissions.add_inquiry_note((SELECT id FROM inq), 'note', 'Grade 2 has places (synthetic).') = 'new',
  'a note keeps the inquiry new');
SELECT test.ok(admissions.add_inquiry_note((SELECT id FROM inq), 'call', 'Called; invited to the open day.') = 'contacted',
  'a call marks it contacted');
SELECT test.expect_error('SELECT admissions.add_inquiry_note((SELECT id FROM inq), ''family_message'', ''forged'')', '23514',
  'staff cannot write as the family');
SELECT test.expect_error('SELECT admissions.close_inquiry((SELECT id FROM inq), ''lost'')', '23514', 'only known outcomes');
SELECT admissions.close_inquiry((SELECT id FROM inq), 'applied');
SELECT test.ok((SELECT status = 'closed' AND outcome = 'applied' FROM admissions.inquiry), 'the principal closes it as applied');
SELECT test.expect_error('SELECT admissions.close_inquiry((SELECT id FROM inq), ''duplicate'')', 'PY001', 'a closed inquiry stays closed');
SELECT test.expect_error('SELECT admissions.add_inquiry_note((SELECT id FROM inq), ''note'', ''late'')', 'PY001', 'a closed inquiry takes no notes');

-- After closing, the same family can ask again.
RESET ROLE; SELECT test.as_anonymous();
SELECT admissions.submit_inquiry(:HOST, :A, (SELECT id FROM notice), 'Vera Test (synthetic)', 'vera@example.test', NULL,
  NULL, NULL, NULL, NULL, NULL, false);
RESET ROLE;
SELECT test.ok((SELECT count(*) FROM admissions.inquiry) = 2, 'a new inquiry after the first one is closed');

-- The log is permanent; erasure may only empty its text.
SELECT test.expect_error('UPDATE admissions.inquiry_note SET body = ''changed''', 'PY004', 'notes cannot be changed');
SELECT test.expect_error('DELETE FROM admissions.inquiry_note', 'PY004', 'notes cannot be deleted');
UPDATE admissions.inquiry_note SET body = NULL, erased_at = now() WHERE kind = 'family_message';
SELECT test.ok((SELECT body IS NULL FROM admissions.inquiry_note WHERE kind = 'family_message'), 'erasure empties a note');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM audit.change_log
                            WHERE changes::text LIKE '%vera@%' OR changes::text LIKE '%Vera Test%'
                               OR changes::text LIKE '%Mladost%' OR changes::text LIKE '%invited to%' OR changes::text LIKE '%Lia%'),
  'names, addresses and messages never reach the audit log');

-- A new notice: forms still showing the old one are refused.
SELECT test.as_person(:DPO);
SELECT test.ok(admissions.publish_privacy_notice(repeat('Synthetic admissions notice, second. ', 3), 'Send me news about open days (synthetic)') = 2,
  'the privacy officer publishes version 2');
RESET ROLE; SELECT test.as_anonymous();
SELECT test.expect_error(format('SELECT admissions.submit_inquiry(%L, %L, (SELECT id FROM notice), ''Other Test'', ''other@example.test'', NULL, NULL, NULL, NULL, NULL, NULL, false)', :HOST, :A),
  'PY020', 'a form showing an old notice is refused');
RESET ROLE;

-- A flood of inquiries: the website's hourly cap holds.
INSERT INTO admissions.inquiry (group_id, school_id, website_id, notice_id, parent_name, email)
SELECT :G, :A, :WA, n.id, 'Flood Test', format('flood%s@example.test', i)
  FROM generate_series(1, 28) AS i, (SELECT id FROM admissions.privacy_notice WHERE group_id = :G AND version = 2) n;
SELECT test.as_anonymous();
SELECT test.expect_error(format('SELECT admissions.submit_inquiry(%L, %L, (SELECT notice_id FROM admissions.inquiry_form(%L)), ''Late Test'', ''late@example.test'', NULL, NULL, NULL, NULL, NULL, NULL, false)', :HOST, :A, :HOST),
  'PY021', 'over 30 inquiries an hour from one website, the sender is asked to try later');
RESET ROLE;

ROLLBACK;
