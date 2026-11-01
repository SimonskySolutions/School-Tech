-- Approvals of document versions (M6.5, ADR 0029).
BEGIN;
\ir _fixtures.sql
\echo '# 32 approvals'

CREATE TEMP TABLE a (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT, INSERT ON a TO pyth_api;
CREATE FUNCTION pg_temp.sha(p text) RETURNS bytea LANGUAGE sql AS $$ SELECT sha256(convert_to(p, 'UTF8')) $$;
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM a WHERE name = p $$;
CREATE FUNCTION pg_temp.step(p_request text, p_no int) RETURNS uuid LANGUAGE sql
AS $$ SELECT id FROM documents.approval_step WHERE request_id = pg_temp.id(p_request) AND step_no = p_no $$;

-- The principal of School A files a policy for all staff and asks the
-- principal, then the CEO, to approve it.
SELECT test.as_person(:PRA);
INSERT INTO a SELECT 'policy', documents.create_document('school', :A, NULL, 'Behaviour policy (synthetic)', 'policy', true);
INSERT INTO a SELECT 'v1', version_id FROM documents.add_version(pg_temp.id('policy'), 'policy.pdf', 'application/pdf', 100, pg_temp.sha('1'));
INSERT INTO a SELECT 'contract', documents.create_document('staff', NULL, :KITA, 'Contract (synthetic)', 'contract', false);
INSERT INTO a SELECT 'c1', version_id FROM documents.add_version(pg_temp.id('contract'), 'contract.pdf', 'application/pdf', 100, pg_temp.sha('c'));
SELECT test.expect_error(format('SELECT documents.request_approval(%L, ARRAY[]::text[])', pg_temp.id('v1')), '23514', 'at least one approver');
SELECT test.expect_error(format('SELECT documents.request_approval(%L, ARRAY[''principal'', ''principal''])', pg_temp.id('v1')),
  '23514', 'each approver once');
SELECT test.expect_error(format('SELECT documents.request_approval(%L, ARRAY[''teacher''])', pg_temp.id('v1')),
  '23514', 'leaders approve, not teachers');
SELECT test.expect_error(format('SELECT documents.request_approval(%L, ARRAY[''principal''])', pg_temp.id('c1')),
  '23514', 'a school role approves no staff document');
INSERT INTO a SELECT 'r1', documents.request_approval(pg_temp.id('v1'), ARRAY['principal', 'group_ceo']);
SELECT test.expect_error(format('SELECT documents.request_approval(%L, ARRAY[''group_ceo''])', pg_temp.id('v1')),
  '23505', 'one request at a time per version');
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.expect_error(format('SELECT documents.request_approval(%L, ARRAY[''principal''])', (SELECT id FROM a WHERE name = 'v1')),
  'P0002', 'the kitchen asks for no approval');

-- In order, each by its role.
RESET ROLE; SELECT test.as_person(:CEO);
SELECT test.expect_error(format('SELECT documents.decide_step(%L, ''approved'', NULL)', pg_temp.step('r1', 2)),
  'PY001', 'the CEO waits for the principal');
SELECT test.expect_error(format('SELECT documents.decide_step(%L, ''approved'', NULL)', pg_temp.step('r1', 1)),
  'P0002', 'and cannot approve in the principal''s place');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.ok(documents.decide_step(pg_temp.step('r1', 1), 'approved', NULL) = 'pending', 'the principal approves first');
SELECT test.expect_error(format('SELECT documents.decide_step(%L, ''approved'', NULL)', pg_temp.step('r1', 1)),
  'PY001', 'once');
SELECT test.expect_error(format('SELECT documents.decide_step(%L, ''approved'', NULL)', pg_temp.step('r1', 2)),
  'P0002', 'the CEO''s step is not the principal''s');
RESET ROLE; SELECT test.as_person(:CEO);
SELECT test.ok(documents.decide_step(pg_temp.step('r1', 2), 'approved', 'Agreed (synthetic).') = 'approved', 'the CEO approves last');
SELECT test.ok((SELECT status = 'approved' AND decided_at IS NOT NULL FROM documents.approval_request WHERE id = pg_temp.id('r1')),
  'and the version is approved');
RESET ROLE;
SELECT test.expect_error(format('UPDATE documents.approval_request SET status = ''rejected'' WHERE id = %L', pg_temp.id('r1')),
  'PY001', 'an approval stays approved, even for the owner');
SELECT test.expect_error(format('UPDATE documents.version SET size_bytes = 1 WHERE id = %L', pg_temp.id('v1')),
  'PY004', 'and the approved version never changes');

-- A new version needs approval again; only the latest is put up.
SELECT test.as_person(:PRA);
INSERT INTO a SELECT 'v2', version_id FROM documents.add_version(pg_temp.id('policy'), 'policy v2.pdf', 'application/pdf', 120, pg_temp.sha('2'));
SELECT test.ok(NOT EXISTS (SELECT 1 FROM documents.approval_request WHERE version_id = pg_temp.id('v2')), 'the new version is not approved');
SELECT test.expect_error(format('SELECT documents.request_approval(%L, ARRAY[''principal''])', pg_temp.id('v1')),
  'PY001', 'an older version is not put up again');
INSERT INTO a SELECT 'r2', documents.request_approval(pg_temp.id('v2'), ARRAY['principal', 'group_ceo']);
SELECT test.expect_error(format('SELECT documents.decide_step(%L, ''rejected'', '' '')', pg_temp.step('r2', 1)),
  '23514', 'a rejection says why');
SELECT test.ok(documents.decide_step(pg_temp.step('r2', 1), 'rejected', 'Section 3 is out of date (synthetic).') = 'rejected',
  'the principal rejects it');
SELECT test.ok((SELECT array_agg(status ORDER BY step_no) FROM documents.approval_step WHERE request_id = pg_temp.id('r2')) = ARRAY['rejected', 'skipped'],
  'which ends the request: the CEO''s step is skipped');
RESET ROLE; SELECT test.as_person(:CEO);
SELECT test.expect_error(format('SELECT documents.decide_step(%L, ''approved'', NULL)', pg_temp.step('r2', 2)), 'PY001',
  'nothing is left to approve');

-- One person decides one step of a request, whatever roles they hold.
RESET ROLE;
INSERT INTO access.role_assignment (group_id, person_id, role_code, school_id) VALUES (:G, :CEO, 'group_admin', NULL);
SELECT test.as_person(:PRA);
INSERT INTO a SELECT 'r3', documents.request_approval(pg_temp.id('v2'), ARRAY['group_admin', 'group_ceo']);
RESET ROLE; SELECT test.as_person(:CEO);
SELECT documents.decide_step(pg_temp.step('r3', 1), 'approved', NULL);
SELECT test.expect_error(format('SELECT documents.decide_step(%L, ''approved'', NULL)', pg_temp.step('r3', 2)),
  'PY001', 'the CEO who approved as administrator does not approve again as CEO');

-- Withdrawn by whoever manages the document, while on its way.
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.expect_error(format('SELECT documents.withdraw_approval(%L)', pg_temp.id('r3')), 'P0002', 'not by the kitchen');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT documents.withdraw_approval(pg_temp.id('r3'));
SELECT test.ok((SELECT status FROM documents.approval_request WHERE id = pg_temp.id('r3')) = 'withdrawn', 'the principal withdraws it');
SELECT test.expect_error(format('SELECT documents.withdraw_approval(%L)', pg_temp.id('r1')), 'PY001', 'an approval is not withdrawn');
SELECT test.expect_error(format('INSERT INTO documents.approval_request (group_id, version_id, requested_by_person_id) VALUES (%L, %L, %L)', :G, pg_temp.id('v2'), :PRA),
  '42501', 'nobody writes approvals except through the functions');
INSERT INTO a SELECT 'staff', documents.request_approval(pg_temp.id('c1'), ARRAY['group_ceo']);

-- Readable by whoever may read the document.
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.ok((SELECT count(*) FROM documents.approval_request) = 4 AND (SELECT count(*) FROM documents.approval_step) = 7,
  'the kitchen sees the policy''s approvals and its contract''s');
SELECT test.ok(documents.decided_by_name(pg_temp.step('r1', 2)) = 'Ceo Test', 'and who approved it, the CEO included');
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.ok((SELECT count(*) FROM documents.approval_request) = 0, 'a teacher elsewhere sees none');
SELECT test.ok(documents.decided_by_name(pg_temp.id('r1')) IS NULL, 'nor who approved what');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok((SELECT count(*) FROM documents.approval_step) = 0, 'a parent sees none');
RESET ROLE; SELECT test.as_person(:CEO);
SELECT test.ok(documents.decide_step(pg_temp.step('staff', 1), 'approved', NULL) = 'approved', 'the CEO approves the contract');
RESET ROLE;

ROLLBACK;
