-- Private documents (M6.4, ADR 0029).
BEGIN;
\ir _fixtures.sql
\echo '# 31 documents'

CREATE TEMP TABLE d (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT, INSERT ON d TO pyth_api;
CREATE FUNCTION pg_temp.sha(p text) RETURNS bytea LANGUAGE sql AS $$ SELECT sha256(convert_to(p, 'UTF8')) $$;

-- The principal of School A files a policy for all staff, a plan for leaders,
-- the kitchen's contract and a report on a pupil.
SELECT test.as_person(:PRA);
INSERT INTO d SELECT 'policy', documents.create_document('school', :A, NULL, 'Safeguarding policy (synthetic)', 'policy', true);
INSERT INTO d SELECT 'plan', documents.create_document('school', :A, NULL, 'School plan (synthetic)', 'plan', false);
INSERT INTO d SELECT 'contract', documents.create_document('staff', NULL, :KITA, 'Contract (synthetic)', 'contract', false);
INSERT INTO d SELECT 'report', documents.create_document('student', :A, :K1, 'Report (synthetic)', 'report', false);
SELECT test.expect_error(format('SELECT documents.create_document(''school'', %L, NULL, ''x'', ''policy'', false)', :B),
  'P0002', 'the principal files nothing for another school');
SELECT test.expect_error(format('SELECT documents.create_document(''student'', %L, %L, ''x'', ''report'', false)', :A, :K3),
  'P0002', 'nor for a pupil of another school');
SELECT test.expect_error(format('SELECT documents.create_document(''staff'', NULL, %L, ''x'', ''contract'', false)', :TEAB),
  'P0002', 'nor for another school''s staff');
SELECT test.expect_error(format('SELECT documents.create_document(''staff'', %L, %L, ''x'', ''contract'', false)', :A, :KITA),
  '23514', 'a staff document belongs to the person, not a school');
SELECT test.expect_error(format('SELECT documents.create_document(''student'', %L, %L, ''x'', ''report'', true)', :A, :K1),
  '23514', 'only a school''s document is for all staff');
SELECT test.expect_error(format('SELECT documents.create_document(''school'', %L, NULL, ''x'', ''diary'', false)', :A),
  '23514', 'the category is one of the list');

-- Versions: numbered, under keys without personal data, never changed.
INSERT INTO d SELECT 'policy v1', version_id FROM documents.add_version((SELECT id FROM d WHERE name = 'policy'), 'policy.pdf', 'application/pdf', 1200, pg_temp.sha('one'));
INSERT INTO d SELECT 'policy v2', version_id FROM documents.add_version((SELECT id FROM d WHERE name = 'policy'), 'policy v2.pdf', 'application/pdf', 1300, pg_temp.sha('two'));
INSERT INTO d SELECT 'contract v1', version_id FROM documents.add_version((SELECT id FROM d WHERE name = 'contract'), 'contract.pdf', 'application/pdf', 900, pg_temp.sha('three'));
INSERT INTO d SELECT 'report v1', version_id FROM documents.add_version((SELECT id FROM d WHERE name = 'report'), 'report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 5000, pg_temp.sha('four'));
SELECT test.ok((SELECT array_agg(version_no ORDER BY version_no) FROM documents.version WHERE document_id = (SELECT id FROM d WHERE name = 'policy')) = ARRAY[1, 2],
  'versions are numbered in order');
SELECT test.ok((SELECT bool_and(object_key = format('v1/%s/%s', document_id, id)) FROM documents.version), 'object keys carry only ids');
SELECT test.expect_error(format('SELECT documents.add_version(%L, ''../etc/passwd'', ''application/pdf'', 10, pg_temp.sha(''x''))', (SELECT id FROM d WHERE name = 'plan')),
  '23514', 'a file name has no path');
SELECT test.expect_error(format('SELECT documents.add_version(%L, ''page.html'', ''text/html'', 10, pg_temp.sha(''x''))', (SELECT id FROM d WHERE name = 'plan')),
  '23514', 'only the listed types are kept');
SELECT test.expect_error(format('SELECT documents.add_version(%L, ''big.pdf'', ''application/pdf'', 10485761, pg_temp.sha(''x''))', (SELECT id FROM d WHERE name = 'plan')),
  '23514', 'at most 10 MB');
RESET ROLE;
SELECT test.expect_error(format('UPDATE documents.version SET file_name = ''other.pdf'' WHERE id = %L', (SELECT id FROM d WHERE name = 'policy v1')),
  'PY004', 'a version never changes, even for the owner');
SELECT test.as_person(:PRA);
SELECT test.expect_error(format('INSERT INTO documents.document (group_id, attached_to, school_id, title, category) VALUES (%L, ''school'', %L, ''x'', ''policy'')', :G, :A),
  '42501', 'nobody writes documents except through the functions');
SELECT test.expect_error('SELECT count(*) FROM documents.download_link', '42501', 'nobody reads the links');

-- Who reads what.
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.ok((SELECT array_agg(title ORDER BY title) FROM documents.document) = ARRAY['Contract (synthetic)', 'Safeguarding policy (synthetic)'],
  'the kitchen reads its own contract and the policy for all staff');
SELECT test.expect_error(format('SELECT documents.add_version(%L, ''x.pdf'', ''application/pdf'', 10, pg_temp.sha(''x''))', (SELECT id FROM d WHERE name = 'contract')),
  'P0002', 'but uploads nothing to it');
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.ok((SELECT count(*) FROM documents.document) = 0, 'a teacher at School B reads none of School A''s');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok((SELECT count(*) FROM documents.document) = 0 AND (SELECT count(*) FROM documents.version) = 0,
  'a parent reads none, not even their child''s report');
RESET ROLE; SELECT test.as_person(:SL);
SELECT test.ok((SELECT count(*) FROM documents.document) = 0, 'School Life reads none');
RESET ROLE; SELECT test.as_person(:CEO);
SELECT test.ok((SELECT count(*) FROM documents.document) = 4 AND (SELECT count(*) FROM documents.version) = 4, 'the CEO reads all of them');
SELECT test.expect_error(format('SELECT documents.archive_document(%L)', (SELECT id FROM d WHERE name = 'plan')),
  'P0002', 'but manages none');

-- Links: for one who may read, used once, by them only, logged.
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.ok(documents.issue_link((SELECT id FROM d WHERE name = 'policy v2'), pg_temp.sha('kitchen-link')) <= now() + interval '2 minutes',
  'the kitchen gets a link to the policy for two minutes');
SELECT test.expect_error(format('SELECT documents.issue_link(%L, pg_temp.sha(''nope''))', (SELECT id FROM d WHERE name = 'report v1')),
  'P0002', 'but none to a pupil''s report');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.expect_error('SELECT * FROM documents.redeem_link(pg_temp.sha(''kitchen-link''))', 'P0002',
  'someone else''s link is no use to the principal');
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.ok((SELECT file_name FROM documents.redeem_link(pg_temp.sha('kitchen-link'))) = 'policy v2.pdf', 'the kitchen downloads the policy');
SELECT test.expect_error('SELECT * FROM documents.redeem_link(pg_temp.sha(''kitchen-link''))', 'P0002', 'once');
SELECT documents.issue_link((SELECT id FROM d WHERE name = 'contract v1'), pg_temp.sha('contract-link'));
RESET ROLE;
UPDATE documents.download_link SET created_at = created_at - interval '3 minutes', expires_at = expires_at - interval '3 minutes'
 WHERE token_hash = pg_temp.sha('contract-link');
SELECT test.as_person(:KITA);
SELECT test.expect_error('SELECT * FROM documents.redeem_link(pg_temp.sha(''contract-link''))', 'P0002', 'an expired link is no use');
RESET ROLE;
SELECT test.ok((SELECT count(*) FROM audit.access_log WHERE actor_person_id = :KITA AND action = 'download'
                  AND resource = 'documents.version:school' AND school_id = :A) = 1,
  'the download is in the access log, once');
SELECT test.ok((SELECT count(*) FROM documents.download_link WHERE expires_at > created_at + interval '2 minutes') = 0
               AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'documents' AND table_name = 'download_link' AND column_name = 'token'),
  'links keep only the hash and last two minutes at most');
SELECT test.as_person(:PRA);
SELECT documents.issue_link((SELECT id FROM d WHERE name = 'report v1'), pg_temp.sha('report-link'));
SELECT test.ok((SELECT version_id FROM documents.redeem_link(pg_temp.sha('report-link'))) = (SELECT id FROM d WHERE name = 'report v1'),
  'the principal downloads the pupil''s report');
RESET ROLE;
SELECT test.ok((SELECT subject_person_id FROM audit.access_log WHERE actor_person_id = :PRA AND resource = 'documents.version:student') = :K1,
  'the log says whose report it was');

-- Archived, not deleted; an archived document takes no new version.
SELECT test.as_person(:PRA);
SELECT documents.archive_document((SELECT id FROM d WHERE name = 'plan'));
SELECT test.expect_error(format('SELECT documents.archive_document(%L)', (SELECT id FROM d WHERE name = 'plan')), 'PY001', 'archived once');
SELECT test.expect_error(format('SELECT documents.add_version(%L, ''x.pdf'', ''application/pdf'', 10, pg_temp.sha(''x''))', (SELECT id FROM d WHERE name = 'plan')),
  'PY001', 'an archived document takes no new version');
SELECT test.ok((SELECT archived_at IS NOT NULL FROM documents.document WHERE id = (SELECT id FROM d WHERE name = 'plan')), 'and is still there');
RESET ROLE;

ROLLBACK;
