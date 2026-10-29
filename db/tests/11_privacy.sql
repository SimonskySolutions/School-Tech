-- GDPR support: audit redaction, consent, subject requests, pseudonymisation.
BEGIN;
\ir _fixtures.sql
\echo '# 11 personal data protection'
\set PUR '''b1000000-0000-7000-8000-000000000001'''
\set DSR '''b2000000-0000-7000-8000-000000000001'''

-- Audit records that a name changed, but not the name.
RESET ROLE; SELECT test.as_person(:PRA);
UPDATE people.person SET family_name = 'Secretnewname' WHERE id = :K1;
RESET ROLE;
SELECT test.ok((SELECT changes ->> 'family_name' FROM audit.change_log
                WHERE table_name = 'person' AND row_id = :K1 AND action = 'UPDATE') = '[redacted]',
  'the audit log records a name change without the name');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM audit.change_log WHERE changes::text LIKE '%Secretnewname%'),
  'personal values never appear in the audit log');
SELECT test.ok((SELECT actor_person_id FROM audit.change_log WHERE table_name = 'person' AND row_id = :K1 AND action = 'UPDATE') = :PRA::uuid,
  'the audit log records who made the change');

-- The DPO records a purpose; consent is given by an authorised guardian only.
SELECT test.as_person(:DPO);
INSERT INTO privacy.processing_purpose (id, group_id, code, name, description, lawful_basis)
VALUES (:PUR, :G, 'website-photos', 'Photos on school websites', 'Publishing photos of students on school websites', 'consent');
UPDATE privacy.processing_purpose SET status = 'approved', approved_by_person_id = :DPO, approved_at = now() WHERE id = :PUR;

RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok((SELECT count(*) FROM privacy.processing_purpose WHERE status = 'approved') = 1,
  'parents can read approved processing purposes (the privacy notice)');
SELECT test.expect_error(format(
  'INSERT INTO privacy.consent_record (group_id, subject_person_id, given_by_person_id, purpose_id, wording_version, channel) VALUES (%L,%L,%L,%L,%L,%L)',
  :G, :K1, :P, :PUR, 'v1', 'family_portal'), '42501', 'a guardian without consent capability cannot consent for the child');

RESET ROLE; SELECT test.as_person(:PRA);
UPDATE people.guardian_relationship SET can_consent = true WHERE guardian_person_id = :P AND student_person_id = :K1;

RESET ROLE; SELECT test.as_person(:P);
INSERT INTO privacy.consent_record (group_id, subject_person_id, given_by_person_id, purpose_id, wording_version, channel)
VALUES (:G, :K1, :P, :PUR, 'v1', 'family_portal');
SELECT test.ok(true, 'a guardian with consent capability gives consent for the child');
UPDATE privacy.consent_record SET status = 'withdrawn', withdrawn_at = now(), withdrawn_by_person_id = :P WHERE subject_person_id = :K1;
RESET ROLE;
SELECT test.ok((SELECT status FROM privacy.consent_record WHERE subject_person_id = :K1) = 'withdrawn',
  'the guardian can withdraw consent');
SELECT test.expect_error(format('UPDATE privacy.consent_record SET status = %L WHERE subject_person_id = %L', 'given', :K1),
  'PY001', 'withdrawn consent cannot be silently restored');

-- A subject access request is due one month after receipt.
SELECT test.as_person(:P);
INSERT INTO privacy.data_subject_request (id, group_id, subject_person_id, requester_person_id, kind) VALUES (:DSR, :G, :P, :P, 'access');
RESET ROLE;
SELECT test.ok((SELECT due_at = received_at + interval '1 month' FROM privacy.data_subject_request WHERE id = :DSR),
  'a subject access request is due one month after receipt');
SELECT test.expect_error(format('UPDATE privacy.data_subject_request SET extended_due_at = received_at + interval %L, extension_reason = %L WHERE id = %L',
  '4 months', 'complex', :DSR), '23514', 'a request cannot be extended beyond three months in total');
SELECT test.as_person(:Q);
SELECT test.ok((SELECT count(*) FROM privacy.data_subject_request) = 0, 'other parents cannot see the request');

-- Erasure: only the worker may pseudonymise; legal records stay.
RESET ROLE; SELECT test.as_person(:ADM);
SELECT test.expect_error(format('SELECT privacy.pseudonymise_person(%L)', :K2), '42501', 'the API cannot run pseudonymisation');
RESET ROLE; SELECT test.as_worker();
SELECT test.expect_error('SELECT count(*) FROM sensitive.dietary_requirement', '42501', 'the worker cannot read health data');
SELECT privacy.pseudonymise_person(:K2);
RESET ROLE;
SELECT test.ok((SELECT given_name = 'Pseudonymised' AND email IS NULL AND date_of_birth IS NULL AND status = 'pseudonymised'
                FROM people.person WHERE id = :K2), 'pseudonymisation replaces names and contact details');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM sensitive.dietary_requirement WHERE student_person_id = :K2),
  'pseudonymisation deletes health data');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM people.guardian_relationship WHERE student_person_id = :K2 AND status = 'active'),
  'pseudonymisation ends guardian access');
SELECT test.ok(EXISTS (SELECT 1 FROM people.enrolment WHERE student_person_id = :K2),
  'records kept under legal obligation remain, now pseudonymous');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM audit.change_log WHERE row_id = :K2 AND changes::text LIKE '%Kiddo%'),
  'the audit trail of the erasure holds no personal values');

ROLLBACK;
