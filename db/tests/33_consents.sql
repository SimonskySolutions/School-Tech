-- Consent from families (M6.6, ADR 0030).
BEGIN;
\ir _fixtures.sql
\echo '# 33 consents'
\set WEB '''b1000000-0000-7000-8000-000000000101'''
\set PRINT '''b1000000-0000-7000-8000-000000000102'''
\set NOWORD '''b1000000-0000-7000-8000-000000000103'''
\set CCTV '''b1000000-0000-7000-8000-000000000104'''

CREATE TEMP TABLE w (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT, INSERT ON w TO pyth_api;
CREATE FUNCTION pg_temp.state(p_school uuid, p_student uuid, p_purpose uuid) RETURNS text LANGUAGE sql
AS $$ SELECT state FROM privacy.school_consents(p_school) WHERE student_person_id = p_student AND purpose_id = p_purpose $$;

-- The data protection officer approves the purposes and publishes their wording.
SELECT test.as_person(:DPO);
INSERT INTO privacy.processing_purpose (id, group_id, code, name, description, lawful_basis) VALUES
  (:WEB, :G, 'photos.website', 'Photos on the website', 'Photos of pupils on the school website', 'consent'),
  (:PRINT, :G, 'photos.print', 'Photos in print', 'Photos of pupils in printed school materials', 'consent'),
  (:NOWORD, :G, 'recordings.events', 'Recordings', 'Recordings of performances', 'consent'),
  (:CCTV, :G, 'cctv', 'Video surveillance', 'Cameras at the entrances', 'legitimate_interests');
UPDATE privacy.processing_purpose SET status = 'approved', approved_by_person_id = :DPO, approved_at = now();
INSERT INTO w SELECT 'web1', privacy.publish_wording(:WEB, 'We may publish photos of your child on the school website (synthetic).', true);
INSERT INTO w SELECT 'print1', privacy.publish_wording(:PRINT, 'We may print photos of your child in the school newsletter (synthetic).', false);
SELECT test.ok((SELECT version = 1 AND NOT renewal_required FROM privacy.consent_wording WHERE id = (SELECT id FROM w WHERE name = 'web1')),
  'the first wording is version 1 and asks nobody again');
SELECT test.expect_error(format('SELECT privacy.publish_wording(%L, ''Cameras record the entrances (synthetic) for safety.'', false)', :CCTV),
  '23514', 'wording is for consent purposes only');
SELECT test.expect_error(format('SELECT privacy.publish_wording(%L, ''Too short'', false)', :WEB), '23514', 'wording says enough');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.expect_error(format('SELECT privacy.publish_wording(%L, ''We may publish photos of your child anywhere at all.'', false)', :WEB),
  '42501', 'only the data protection officer publishes wording');
RESET ROLE;
SELECT test.expect_error(format('UPDATE privacy.consent_wording SET wording = ''changed silently, after consent was given'' WHERE id = %L', (SELECT id FROM w WHERE name = 'web1')),
  'PY004', 'published wording never changes');
UPDATE people.guardian_relationship SET can_consent = true WHERE guardian_person_id = :P AND student_person_id = :K1;

-- A guardian who may consent gives consent, for the current wording.
SELECT test.as_person(:P);
SELECT test.ok((SELECT count(*) FROM privacy.consent_wording) = 2, 'parents read the published wording');
SELECT privacy.give_consent(:K1, :WEB, (SELECT id FROM w WHERE name = 'web1'));
SELECT test.expect_error(format('SELECT privacy.give_consent(%L, %L, %L)', :K1, :WEB, (SELECT id FROM w WHERE name = 'web1')),
  'PY001', 'once');
SELECT test.expect_error(format('SELECT privacy.give_consent(%L, %L, %L)', :K1, :WEB, (SELECT id FROM w WHERE name = 'print1')),
  'PY001', 'for that purpose''s wording');
SELECT test.expect_error(format('SELECT privacy.give_consent(%L, %L, gen_random_uuid())', :K1, :NOWORD),
  'P0002', 'not for a purpose without wording');
SELECT test.expect_error(format('SELECT privacy.give_consent(%L, %L, gen_random_uuid())', :K1, :CCTV),
  'P0002', 'nor one that does not rest on consent');
SELECT test.expect_error(format('SELECT privacy.give_consent(%L, %L, %L)', :K3, :WEB, (SELECT id FROM w WHERE name = 'web1')),
  'P0002', 'not for someone else''s child');
RESET ROLE; SELECT test.as_person(:S);
SELECT test.expect_error(format('SELECT privacy.give_consent(%L, %L, %L)', :K1, :PRINT, (SELECT id FROM w WHERE name = 'print1')),
  'P0002', 'not by a guardian still waiting to be verified');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.expect_error(format('SELECT privacy.give_consent(%L, %L, %L)', :K2, :PRINT, (SELECT id FROM w WHERE name = 'print1')),
  'P0002', 'not without the consent capability for that child');
SELECT test.expect_error(format('INSERT INTO privacy.consent_record (group_id, subject_person_id, given_by_person_id, purpose_id, wording_version, channel) VALUES (%L,%L,%L,%L,''1'',''family_portal'')', :G, :K1, :P, :PRINT),
  '42501', 'nobody writes consent records except through the functions');

-- Staff see, per pupil and purpose, whether consent counts; nothing else.
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.ok(pg_temp.state(:A, :K1, :WEB) = 'given' AND pg_temp.state(:A, :K1, :PRINT) = 'none',
  'the principal sees Kid may appear on the website, not in print');
SELECT test.ok((SELECT count(DISTINCT purpose_id) FROM privacy.school_consents(:A)) = 2, 'only purposes families are asked about');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM information_schema.routines r
                            JOIN information_schema.parameters prm ON prm.specific_name = r.specific_name
                           WHERE r.routine_schema = 'privacy' AND r.routine_name = 'school_consents'
                             AND prm.parameter_name IN ('given_by_person_id', 'given_at')),
  'not who gave it, nor when');
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.ok((SELECT count(*) FROM privacy.school_consents(:A)) = 0, 'a teacher at School B sees none at School A');
SELECT test.ok(pg_temp.state(:B, :K3, :WEB) = 'none', 'but sees their own school''s pupils');
SELECT test.ok((SELECT count(*) FROM privacy.consent_record) = 0, 'and no consent record itself');
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.ok((SELECT count(*) FROM privacy.school_consents(:A)) = 0, 'the kitchen sees none');
RESET ROLE; SELECT test.as_person(:Q);
SELECT test.ok((SELECT count(*) FROM privacy.school_consents(:B)) = 0, 'nor do parents');

-- New wording: a correction keeps consent; a change of substance asks again.
RESET ROLE; SELECT test.as_person(:DPO);
INSERT INTO w SELECT 'web2', privacy.publish_wording(:WEB, 'We may publish photos of your child on the school''s website (synthetic).', false);
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.ok(pg_temp.state(:A, :K1, :WEB) = 'given', 'a correction keeps the consent');
RESET ROLE; SELECT test.as_person(:DPO);
INSERT INTO w SELECT 'web3', privacy.publish_wording(:WEB, 'We may publish photos and first names of your child on the school website (synthetic).', true);
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.ok(pg_temp.state(:A, :K1, :WEB) = 'renewal', 'a change of substance asks again');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.expect_error(format('SELECT privacy.give_consent(%L, %L, %L)', :K1, :WEB, (SELECT id FROM w WHERE name = 'web2')),
  'PY001', 'only the current wording is agreed to');
SELECT privacy.give_consent(:K1, :WEB, (SELECT id FROM w WHERE name = 'web3'));
SELECT test.ok((SELECT array_agg(status || ':' || wording_version ORDER BY given_at) FROM privacy.consent_record WHERE subject_person_id = :K1 AND purpose_id = :WEB)
               = ARRAY['withdrawn:1', 'given:3'],
  'the new consent replaces the old, which stays as evidence');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.ok(pg_temp.state(:A, :K1, :WEB) = 'given', 'and counts again');

-- Withdrawn as easily as given, at once; staff record a withdrawal on paper.
RESET ROLE; SELECT test.as_person(:P);
SELECT test.expect_error(format('SELECT privacy.withdraw_consent(%L, %L)', :K1, :PRINT), 'PY001', 'nothing to withdraw for print');
SELECT privacy.withdraw_consent(:K1, :WEB);
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.ok(pg_temp.state(:A, :K1, :WEB) = 'none', 'withdrawn at once');
RESET ROLE; SELECT test.as_person(:P);
SELECT privacy.give_consent(:K1, :PRINT, (SELECT id FROM w WHERE name = 'print1'));
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.expect_error(format('SELECT privacy.withdraw_consent(%L, %L)', :K1, :PRINT), 'P0002', 'a teacher records no withdrawal');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT privacy.withdraw_consent(:K1, :PRINT);
SELECT test.ok((SELECT withdrawn_by_person_id FROM privacy.consent_record WHERE subject_person_id = :K1 AND purpose_id = :PRINT) = :PRA,
  'the principal records a withdrawal received on paper, in their own name');
RESET ROLE;

ROLLBACK;
