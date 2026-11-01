-- Qualifications and checks (M6.2, ADR 0028).
BEGIN;
\ir _fixtures.sql
\echo '# 29 staff qualifications and checks'

-- The principal of School A records the kitchen's hygiene certificate and record check.
SELECT test.as_person(:PRA);
CREATE TEMP TABLE q ON COMMIT DROP AS
SELECT staff.record_qualification(:KITA, 'food_hygiene', 'Food hygiene, level 2', 'Training centre (synthetic)', current_date - 300, current_date + 30) AS id;
GRANT SELECT ON q TO pyth_api;
SELECT staff.record_check(:KITA, current_date - 10, current_date + 170);
SELECT test.expect_error(format('SELECT staff.record_qualification(%L, ''teaching_licence'', ''Licence'', NULL, current_date - 1, NULL)', :TEAB),
  'P0002', 'only for staff of the principal''s school');
SELECT test.expect_error(format('SELECT staff.record_qualification(%L, ''first_aid'', ''First aid'', NULL, current_date - 1, NULL)', :P),
  'P0002', 'never for a parent');
SELECT test.expect_error(format('SELECT staff.record_qualification(%L, ''first_aid'', ''First aid'', NULL, current_date, current_date - 1)', :KITA),
  '23514', 'a qualification expires after it is awarded');
SELECT test.expect_error(format('SELECT staff.record_qualification(%L, ''charm'', ''x'', NULL, current_date, NULL)', :KITA),
  '23514', 'only known kinds');
SELECT test.expect_error(format('SELECT staff.record_check(%L, current_date + 1, current_date + 100)', :KITA),
  '23514', 'a certificate is not seen in the future');
SELECT test.expect_error(format('SELECT staff.record_check(%L, current_date, current_date + 400)', :KITA),
  '23514', 'and is valid for a year at most');
SELECT test.expect_error(format('INSERT INTO staff.record_check (group_id, person_id, seen_on, valid_until, seen_by_person_id) VALUES (%L, %L, current_date, current_date + 1, %L)', :G, :KITA, :PRA),
  '42501', 'nobody writes checks except through the functions');

-- The group administrator records the School B teacher's licence; a teacher records nothing.
RESET ROLE; SELECT test.as_person(:ADM);
SELECT staff.record_qualification(:TEAB, 'teaching_licence', 'Teaching licence (synthetic)', 'Ministry (synthetic)', current_date - 900, NULL);
SELECT test.expect_error(format('SELECT staff.record_qualification(%L, ''first_aid'', ''First aid'', NULL, current_date - 1, NULL)', :P),
  'P0002', 'group administrators record nothing for parents either');
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.expect_error(format('SELECT staff.record_check(%L, current_date, current_date + 100)', :TEAB),
  'P0002', 'a teacher records no checks, not even their own');

-- Who reads them.
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.ok((SELECT count(*) FROM staff.qualification) = 1 AND (SELECT count(*) FROM staff.record_check) = 1,
  'the member of staff sees their own qualification and check');
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.ok((SELECT array_agg(kind) FROM staff.qualification) = ARRAY['teaching_licence'] AND (SELECT count(*) FROM staff.record_check) = 0,
  'a teacher sees only their own');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.ok((SELECT array_agg(kind) FROM staff.qualification) = ARRAY['food_hygiene'] AND (SELECT count(*) FROM staff.record_check) = 1,
  'the principal sees School A''s staff only');
RESET ROLE; SELECT test.as_person(:CEO);
SELECT test.ok((SELECT count(*) FROM staff.qualification) = 2 AND (SELECT count(*) FROM staff.record_check) = 1, 'the CEO sees every school''s');
SELECT test.ok(NOT staff.may_for_person('staff.read', :P), 'but never a parent''s');
RESET ROLE; SELECT test.as_person(:SL);
SELECT test.ok((SELECT count(*) FROM staff.qualification) = 0 AND (SELECT count(*) FROM staff.record_check) = 0, 'School Life sees none');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok((SELECT count(*) FROM staff.qualification) = 0, 'nor does a parent');

-- A check is permanent; a qualification recorded in error is withdrawn, once.
RESET ROLE;
SELECT test.expect_error('UPDATE staff.record_check SET valid_until = valid_until + 30', 'PY004', 'a recorded check never changes');
SELECT test.as_person(:TEAB);
SELECT test.expect_error('SELECT staff.withdraw_qualification((SELECT id FROM q))', 'P0002', 'a colleague cannot withdraw it');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT staff.withdraw_qualification((SELECT id FROM q));
SELECT test.expect_error('SELECT staff.withdraw_qualification((SELECT id FROM q))', 'PY001', 'a withdrawn qualification is withdrawn once');
RESET ROLE;
SELECT test.ok((SELECT withdrawn_at IS NOT NULL FROM staff.qualification WHERE id = (SELECT id FROM q)), 'and kept, marked withdrawn');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_schema = 'staff' AND table_name = 'record_check'
                              AND column_name IN ('outcome', 'result', 'content', 'convictions', 'document')),
  'a check holds no outcome or content (Art. 10)');

ROLLBACK;
