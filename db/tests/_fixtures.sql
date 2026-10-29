-- Synthetic test data and helpers. Included by every test file inside its own
-- transaction, which is rolled back at the end. All names are invented.
--
-- Group G runs three schools:
--   School A (school)       billed by E1 "Pythagoras Schools Ltd"
--   School B (school)       billed by E1
--   School C (kindergarten) billed by E2 "Pythagoras Foundation"
--
-- Families:
--   Parent P: guardian of K1 (School A) and K2 (School C)     both active
--   Parent Q: guardian of K3 (School B)                       active
--   Person R: same family name and e-mail domain as P, no relationship
--   Person S: pending (unverified) guardian of K1
--   Person T: revoked guardian of K2
--
-- Staff: CEO, School Life coordinator, group finance, privacy officer and
--        group administrator (all group-wide); principal of A, kitchen of A,
--        teacher of B.

\set ON_ERROR_STOP on
SET client_min_messages = notice;

-- Test helpers live in a schema that exists only inside the test transaction.
CREATE SCHEMA test;
GRANT USAGE ON SCHEMA test TO pyth_api, pyth_worker;

CREATE FUNCTION test.ok(p_condition boolean, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS NOT TRUE THEN
    RAISE EXCEPTION 'not ok - %', p_label;
  END IF;
  RAISE NOTICE 'ok - %', p_label;
END $$;

CREATE FUNCTION test.expect_error(p_sql text, p_sqlstate text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_sqlstate THEN
      RAISE EXCEPTION 'not ok - %: expected SQLSTATE %, got % (%)', p_label, p_sqlstate, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'ok - % (%)', p_label, SQLSTATE;
    RETURN;
  END;
  RAISE EXCEPTION 'not ok - %: expected SQLSTATE % but the statement succeeded', p_label, p_sqlstate;
END $$;

-- Switch to the API role acting for a person, or to the worker. Call RESET ROLE first.
CREATE FUNCTION test.as_person(p_person_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL ROLE pyth_api';
  PERFORM set_config('app.person_id', p_person_id::text, true);
  PERFORM set_config('app.request_id', 'test-' || p_person_id::text, true);
END $$;

CREATE FUNCTION test.as_anonymous() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL ROLE pyth_api';
  PERFORM set_config('app.person_id', '', true);
END $$;

CREATE FUNCTION test.as_worker() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL ROLE pyth_worker';
  PERFORM set_config('app.person_id', '', true);
  PERFORM set_config('app.actor', 'worker:test', true);
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA test TO pyth_api, pyth_worker;

-- Identifiers ---------------------------------------------------------------
\set G      '''a0000000-0000-7000-8000-000000000001'''
\set E1     '''e0000000-0000-7000-8000-000000000001'''
\set E2     '''e0000000-0000-7000-8000-000000000002'''
\set A      '''5c000000-0000-7000-8000-00000000000a'''
\set B      '''5c000000-0000-7000-8000-00000000000b'''
\set C      '''5c000000-0000-7000-8000-00000000000c'''
\set CEO    '''10000000-0000-7000-8000-000000000001'''
\set SL     '''10000000-0000-7000-8000-000000000002'''
\set PRA    '''10000000-0000-7000-8000-000000000003'''
\set KITA   '''10000000-0000-7000-8000-000000000004'''
\set TEAB   '''10000000-0000-7000-8000-000000000005'''
\set FIN    '''10000000-0000-7000-8000-000000000006'''
\set DPO    '''10000000-0000-7000-8000-000000000007'''
\set ADM    '''10000000-0000-7000-8000-000000000008'''
\set P      '''20000000-0000-7000-8000-000000000001'''
\set Q      '''20000000-0000-7000-8000-000000000002'''
\set R      '''20000000-0000-7000-8000-000000000003'''
\set S      '''20000000-0000-7000-8000-000000000004'''
\set T      '''20000000-0000-7000-8000-000000000005'''
\set K1     '''30000000-0000-7000-8000-000000000001'''
\set K2     '''30000000-0000-7000-8000-000000000002'''
\set K3     '''30000000-0000-7000-8000-000000000003'''
\set LUNCH  '''50000000-0000-7000-8000-000000000001'''
\set CHESSD '''50000000-0000-7000-8000-000000000002'''
\set TUITD  '''50000000-0000-7000-8000-000000000003'''
\set LA     '''60000000-0000-7000-8000-00000000000a'''
\set LC     '''60000000-0000-7000-8000-00000000000c'''
\set CHA    '''60000000-0000-7000-8000-0000000000ca'''
\set TA     '''60000000-0000-7000-8000-0000000000aa'''
\set DRAFTB '''60000000-0000-7000-8000-0000000000db'''
\set PLA1   '''70000000-0000-7000-8000-00000000000a'''
\set PLC1   '''70000000-0000-7000-8000-00000000000c'''
\set PCHA1  '''70000000-0000-7000-8000-0000000000ca'''
\set PTA1   '''70000000-0000-7000-8000-0000000000aa'''
\set SLA    '''80000000-0000-7000-8000-00000000000a'''
\set SLC    '''80000000-0000-7000-8000-00000000000c'''
\set SCHA   '''80000000-0000-7000-8000-0000000000ca'''

-- Organisation --------------------------------------------------------------
INSERT INTO org.education_group (id, code, name) VALUES (:G, 'pythagoras-test', 'Pythagoras Test Group');
INSERT INTO org.legal_entity (id, group_id, legal_name, registration_number) VALUES
  (:E1, :G, 'Pythagoras Schools Ltd (synthetic)', '000000001'),
  (:E2, :G, 'Pythagoras Foundation (synthetic)', '000000002');
INSERT INTO org.school (id, group_id, code, name, kind, default_billing_entity_id, status) VALUES
  (:A, :G, 'school-a', 'School A', 'school', :E1, 'active'),
  (:B, :G, 'school-b', 'School B', 'school', :E1, 'active'),
  (:C, :G, 'kindergarten-c', 'Kindergarten C', 'kindergarten', :E2, 'active');

-- People --------------------------------------------------------------------
INSERT INTO people.person (id, group_id, given_name, family_name, email) VALUES
  (:CEO,  :G, 'Ceo',       'Test',     'ceo@example.test'),
  (:SL,   :G, 'Sofia',     'Life',     'sl@example.test'),
  (:PRA,  :G, 'Petar',     'Principal','pra@example.test'),
  (:KITA, :G, 'Kalina',    'Kitchen',  'kita@example.test'),
  (:TEAB, :G, 'Teodor',    'Teacher',  'teab@example.test'),
  (:FIN,  :G, 'Fani',      'Finance',  'fin@example.test'),
  (:DPO,  :G, 'Dora',      'Privacy',  'dpo@example.test'),
  (:ADM,  :G, 'Asen',      'Admin',    'adm@example.test'),
  (:P,    :G, 'Parent',    'Ivanov',   'p@family.example.test'),
  (:Q,    :G, 'Quinn',     'Georgiev', 'q@other.example.test'),
  (:R,    :G, 'Radoslav',  'Ivanov',   'r@family.example.test'),
  (:S,    :G, 'Stefan',    'Pending',  's@example.test'),
  (:T,    :G, 'Tanya',     'Revoked',  't@example.test'),
  (:K1,   :G, 'Kid',       'Ivanov',   NULL),
  (:K2,   :G, 'Kiddo',     'Ivanov',   NULL),
  (:K3,   :G, 'Kalin',     'Georgiev', NULL);

INSERT INTO people.enrolment (group_id, student_person_id, school_id, academic_year, grade_level, status, start_date) VALUES
  (:G, :K1, :A, '2026/2027', '3', 'active', DATE '2026-09-15'),
  (:G, :K2, :C, '2026/2027', 'group 2', 'active', DATE '2026-09-15'),
  (:G, :K3, :B, '2026/2027', '5', 'active', DATE '2026-09-15');

INSERT INTO people.guardian_relationship
  (group_id, guardian_person_id, student_person_id, relationship, status, verified_by_person_id, verified_at, revoked_at) VALUES
  (:G, :P, :K1, 'parent', 'active',  :PRA, now(), NULL),
  (:G, :P, :K2, 'parent', 'active',  :PRA, now(), NULL),
  (:G, :Q, :K3, 'parent', 'active',  :PRA, now(), NULL),
  (:G, :S, :K1, 'parent', 'pending', NULL, NULL, NULL),
  (:G, :T, :K2, 'parent', 'revoked', :PRA, now(), now());

INSERT INTO access.role_assignment (group_id, person_id, role_code, school_id) VALUES
  (:G, :CEO,  'group_ceo', NULL),
  (:G, :SL,   'school_life_coordinator', NULL),
  (:G, :FIN,  'group_finance', NULL),
  (:G, :DPO,  'privacy_officer', NULL),
  (:G, :ADM,  'group_admin', NULL),
  (:G, :PRA,  'principal', :A),
  (:G, :KITA, 'kitchen', :A),
  (:G, :TEAB, 'teacher', :B);

-- Catalog and sessions ------------------------------------------------------
INSERT INTO catalog.service_definition (id, group_id, code, kind, name) VALUES
  (:LUNCH,  :G, 'lunch', 'lunch', 'School lunch'),
  (:CHESSD, :G, 'chess', 'activity', 'Chess club'),
  (:TUITD,  :G, 'tuition', 'tuition', 'Tuition');

INSERT INTO catalog.school_offering (id, group_id, school_id, service_definition_id, billing_entity_id, code, name, status) VALUES
  (:LA,     :G, :A, :LUNCH,  :E1, 'lunch',   'Lunch at School A',   'published'),
  (:LC,     :G, :C, :LUNCH,  :E2, 'lunch',   'Lunch at Kindergarten C', 'published'),
  (:CHA,    :G, :A, :CHESSD, :E1, 'chess',   'Chess club, School A', 'published'),
  (:TA,     :G, :A, :TUITD,  :E1, 'tuition', 'Tuition, School A',   'published'),
  (:DRAFTB, :G, :B, :CHESSD, :E1, 'chess',   'Chess club, School B (draft)', 'draft');

INSERT INTO catalog.price_version (id, group_id, offering_id, version, unit_amount_minor, vat_rate_bp, price_unit, valid_from) VALUES
  (:PLA1,  :G, :LA,  1,   450, 0, 'per_day',  now() - interval '30 days'),
  (:PLC1,  :G, :LC,  1,   500, 0, 'per_day',  now() - interval '30 days'),
  (:PCHA1, :G, :CHA, 1,  6000, 0, 'per_term', now() - interval '30 days'),
  (:PTA1,  :G, :TA,  1, 45000, 0, 'per_month', now() - interval '30 days');

INSERT INTO scheduling.session (id, group_id, school_id, offering_id, service_date, capacity) VALUES
  (:SLA,  :G, :A, :LA,  DATE '2026-11-02', 100),
  (:SLC,  :G, :C, :LC,  DATE '2026-11-02', 50);
INSERT INTO scheduling.session (id, group_id, school_id, offering_id, starts_at, ends_at, capacity) VALUES
  (:SCHA, :G, :A, :CHA, TIMESTAMPTZ '2026-11-03 14:00 Europe/Sofia', TIMESTAMPTZ '2026-11-03 15:00 Europe/Sofia', 1);

-- Health and dietary data ---------------------------------------------------
INSERT INTO sensitive.dietary_requirement (group_id, student_person_id, kind, description, severity, provided_by_person_id) VALUES
  (:G, :K1, 'allergy', 'Peanuts (synthetic)', 'life_threatening', :P),
  (:G, :K2, 'vegetarian', 'No meat (synthetic)', NULL, :P);
