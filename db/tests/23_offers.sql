-- Assessment notes, offers and the waiting list (M5.3).
BEGIN;
\ir _fixtures.sql
\echo '# 23 admissions offers'

SELECT test.as_person(:DPO);
SELECT admissions.publish_privacy_notice(repeat('Synthetic admissions notice. ', 3), 'News about open days (synthetic)');
RESET ROLE;
CREATE TEMP TABLE notice ON COMMIT DROP AS SELECT id FROM admissions.privacy_notice WHERE group_id = :G;
GRANT SELECT ON notice TO pyth_api;
SELECT test.as_person(:PRA);
CREATE TEMP TABLE intake ON COMMIT DROP AS
SELECT admissions.open_intake(:A, '2027/28', '2', 2, current_date - 1, current_date + 30) AS id;
GRANT SELECT ON intake TO pyth_api;
RESET ROLE;

-- Four applications for two places: two from P, two from Q.
CREATE TEMP TABLE app (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT, INSERT ON app TO pyth_api;
SELECT test.as_person(:P);
INSERT INTO app SELECT v.name, admissions.submit_application((SELECT id FROM intake), (SELECT id FROM notice), NULL, v.name, 'Ivanova', DATE '2020-01-01', NULL, NULL)
  FROM (VALUES ('Xenia'), ('Yana')) AS v (name);
RESET ROLE; SELECT test.as_person(:Q);
INSERT INTO app SELECT v.name, admissions.submit_application((SELECT id FROM intake), (SELECT id FROM notice), NULL, v.name, 'Georgieva', DATE '2020-01-01', NULL, NULL)
  FROM (VALUES ('Zara'), ('Wera'), ('Vesa')) AS v (name);
RESET ROLE;
CREATE FUNCTION pg_temp.status(p_name text) RETURNS text LANGUAGE sql AS $$
  SELECT a.status FROM admissions.application a JOIN app ON app.id = a.id WHERE app.name = p_name $$;

-- Offers within the places only.
SELECT test.as_person(:PRA);
SELECT test.expect_error('SELECT admissions.make_offer((SELECT id FROM app WHERE name = ''Xenia''), current_date - 1)',
  '22007', 'an offer cannot be due in the past');
SELECT admissions.make_offer((SELECT id FROM app WHERE name = 'Xenia'), current_date + 7);
SELECT admissions.make_offer((SELECT id FROM app WHERE name = 'Yana'), current_date + 7);
SELECT test.ok(pg_temp.status('Xenia') = 'offered' AND pg_temp.status('Yana') = 'offered', 'two places, two offers');
SELECT test.ok((SELECT offer_expires_at = ((current_date + 8)::timestamp AT TIME ZONE 'Europe/Sofia')
                  FROM admissions.application WHERE id = (SELECT id FROM app WHERE name = 'Xenia')),
  'an offer is open until the end of its day, school time');
SELECT test.expect_error('SELECT admissions.make_offer((SELECT id FROM app WHERE name = ''Zara''), current_date + 7)',
  'PY024', 'no third offer for two places');
SELECT test.expect_error('SELECT admissions.make_offer((SELECT id FROM app WHERE name = ''Xenia''), current_date + 7)',
  'PY001', 'an application is offered a place once');
SELECT admissions.decide_application((SELECT id FROM app WHERE name = 'Zara'), 'waitlisted');
SELECT admissions.decide_application((SELECT id FROM app WHERE name = 'Wera'), 'waitlisted');
RESET ROLE; SELECT test.as_person(:Q);
SELECT test.ok(admissions.waitlist_position((SELECT id FROM app WHERE name = 'Zara')) = 1
               AND admissions.waitlist_position((SELECT id FROM app WHERE name = 'Wera')) = 2,
  'the parent sees their place on the waiting list');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok(admissions.waitlist_position((SELECT id FROM app WHERE name = 'Zara')) IS NULL,
  'but not another family''s');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.expect_error('SELECT admissions.decide_application((SELECT id FROM app WHERE name = ''Vesa''), ''maybe'')',
  '23514', 'only known decisions');
SELECT test.expect_error('SELECT admissions.decide_application((SELECT id FROM app WHERE name = ''Xenia''), ''rejected'')',
  'PY001', 'an offered place is not refused by staff');
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.expect_error('SELECT admissions.make_offer((SELECT id FROM app WHERE name = ''Vesa''), current_date + 7)',
  'P0002', 'staff at another school make no offers');

-- Only the parent who applied answers.
RESET ROLE; SELECT test.as_person(:Q);
SELECT test.expect_error('SELECT admissions.answer_offer((SELECT id FROM app WHERE name = ''Xenia''), true)',
  'P0002', 'another parent cannot answer the offer');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.expect_error('SELECT admissions.answer_offer((SELECT id FROM app WHERE name = ''Xenia''), true)',
  'P0002', 'staff cannot answer for the family');

-- A declined place goes to the longest-waiting application.
RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok(admissions.answer_offer((SELECT id FROM app WHERE name = 'Xenia'), false) = 'declined', 'P declines one offer');
SELECT test.ok(admissions.answer_offer((SELECT id FROM app WHERE name = 'Yana'), true) = 'accepted', 'and accepts the other');
SELECT test.expect_error('SELECT admissions.answer_offer((SELECT id FROM app WHERE name = ''Yana''), false)',
  'PY001', 'an answered offer stays answered');
RESET ROLE;
SELECT test.ok(pg_temp.status('Zara') = 'offered' AND pg_temp.status('Wera') = 'waitlisted',
  'the declined place goes to the first on the waiting list, not the second');
SELECT test.ok((SELECT offer_expires_at = ((current_date + 15)::timestamp AT TIME ZONE 'Europe/Sofia')
                  FROM admissions.application WHERE id = (SELECT id FROM app WHERE name = 'Zara')),
  'with the intake''s fourteen days to answer');

-- A withdrawn offer passes its place on too.
SELECT test.as_person(:Q);
SELECT admissions.withdraw_application((SELECT id FROM app WHERE name = 'Zara'));
RESET ROLE;
SELECT test.ok(pg_temp.status('Wera') = 'offered', 'a withdrawn offer goes to the next waiting');

-- Expiry: the worker expires an unanswered offer; a late answer is refused.
UPDATE admissions.application SET offer_expires_at = now() - interval '1 minute' WHERE id = (SELECT id FROM app WHERE name = 'Wera');
SELECT test.as_person(:Q);
SELECT test.expect_error('SELECT admissions.answer_offer((SELECT id FROM app WHERE name = ''Wera''), true)',
  'PY025', 'an offer past its deadline cannot be accepted');
SELECT test.expect_error('SELECT admissions.expire_offers()', '42501', 'only the worker expires offers');
RESET ROLE; SELECT test.as_worker();
SELECT test.ok(admissions.expire_offers() = 1, 'the worker expires the offer');
RESET ROLE;
SELECT test.ok(pg_temp.status('Wera') = 'expired', 'the offer is expired');
SELECT test.ok((SELECT count(*) FROM admissions.application WHERE intake_id = (SELECT id FROM intake) AND status IN ('offered', 'accepted')) = 1,
  'with nobody waiting, the place stays free');
SELECT test.as_person(:PRA);
SELECT admissions.make_offer((SELECT id FROM app WHERE name = 'Vesa'), current_date);
SELECT test.expect_error('SELECT admissions.make_offer((SELECT id FROM app WHERE name = ''Wera''), current_date + 7)',
  'PY001', 'an expired application is not offered again; the family applies again');

-- Applying again after an expired offer, onto the waiting list.
RESET ROLE; SELECT test.as_person(:Q);
INSERT INTO app SELECT 'Wera2', admissions.submit_application((SELECT id FROM intake), (SELECT id FROM notice), NULL, 'Wera', 'Georgieva', DATE '2020-01-01', NULL, NULL);
SELECT test.ok((SELECT id FROM app WHERE name = 'Wera2') IS NOT NULL, 'after an expired offer the family may apply again');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT admissions.decide_application((SELECT id FROM app WHERE name = 'Wera2'), 'waitlisted');
RESET ROLE;

-- Assessment notes: admissions staff only, never the family.
SELECT test.as_person(:PRA);
SELECT admissions.add_application_note((SELECT id FROM app WHERE name = 'Yana'), 'interview', 'Calm and curious at the visit (synthetic).');
SELECT test.expect_error('SELECT admissions.add_application_note((SELECT id FROM app WHERE name = ''Yana''), ''gossip'', ''x'')',
  '23514', 'only known kinds of note');
SELECT test.ok((SELECT count(*) FROM admissions.application_note) = 1, 'the principal reads the note');
RESET ROLE; SELECT test.as_person(:ADM);
SELECT test.ok((SELECT count(*) FROM admissions.application_note) = 1, 'the group administrator reads it');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok((SELECT count(*) FROM admissions.application_note) = 0, 'the parent who applied does not');
SELECT test.expect_error('SELECT admissions.add_application_note((SELECT id FROM app WHERE name = ''Yana''), ''note'', ''x'')',
  'P0002', 'nor writes one');
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.ok((SELECT count(*) FROM admissions.application_note) = 0, 'the kitchen does not');
RESET ROLE;
SELECT test.expect_error('UPDATE admissions.application_note SET body = ''changed''', 'PY004', 'notes are permanent');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM audit.change_log WHERE changes::text LIKE '%Calm and curious%'),
  'what a note says never reaches the audit log');

-- A closed intake offers its free places to nobody.
SELECT test.as_person(:PRA);
SELECT admissions.close_intake((SELECT id FROM intake));
RESET ROLE; SELECT test.as_person(:Q);
SELECT admissions.withdraw_application((SELECT id FROM app WHERE name = 'Vesa'));
RESET ROLE;
SELECT test.ok(pg_temp.status('Wera2') = 'waitlisted', 'no new offers once the intake is closed');
SELECT test.as_person(:PRA);
SELECT admissions.decide_application((SELECT id FROM app WHERE name = 'Wera2'), 'rejected');
RESET ROLE;
SELECT test.ok((SELECT decided_at IS NOT NULL FROM admissions.application WHERE id = (SELECT id FROM app WHERE name = 'Wera2'))
               AND pg_temp.status('Wera2') = 'rejected', 'staff refuse an application from the waiting list');

ROLLBACK;
