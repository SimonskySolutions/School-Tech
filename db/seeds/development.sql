-- DEVELOPMENT SEED - synthetic data only. Never load into production.
--
-- One company, "Testing Company" (placeholder name), bills all three schools.
-- People match the synthetic users in infra/keycloak/realm/pythagoras-realm.json
-- (login_identity.subject = Keycloak user id). All e-mail addresses use the
-- reserved .test domain. Idempotent: safe to run again; it never deletes.
--
-- Run with scripts/db-seed.sh (connects as pyth_migrator, the schema owner).

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL app.actor = 'seed:development';

\set G    '''a1000000-0000-7000-8000-000000000001'''
\set CO   '''e1000000-0000-7000-8000-000000000001'''
\set SA   '''b1000000-0000-7000-8000-00000000000a'''
\set SB   '''b1000000-0000-7000-8000-00000000000b'''
\set SC   '''b1000000-0000-7000-8000-00000000000c'''

-- Organisation ---------------------------------------------------------------
INSERT INTO org.education_group (id, code, name) VALUES (:G, 'pythagoras', 'Pythagoras')
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.legal_entity (id, group_id, legal_name, registration_number)
VALUES (:CO, :G, 'Testing Company', 'TEST-0001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.school (id, group_id, code, name, kind, default_billing_entity_id, status) VALUES
  (:SA, :G, 'school-a', 'School A', 'school', :CO, 'active'),
  (:SB, :G, 'school-b', 'School B', 'school', :CO, 'active'),
  (:SC, :G, 'school-c', 'School C', 'school', :CO, 'active')
ON CONFLICT (id) DO NOTHING;

-- Websites: one per school, the group site and the family portal (ADR 0011).
INSERT INTO org.website (id, group_id, code, name, purpose, cms_tenant_key, status) VALUES
  ('c2000000-0000-7000-8000-000000000001', :G, 'pythagoras', 'Pythagoras', 'group', 'pythagoras', 'live'),
  ('c2000000-0000-7000-8000-000000000002', :G, 'portal', 'Pythagoras family portal', 'family_portal', NULL, 'live'),
  ('c2000000-0000-7000-8000-00000000000a', :G, 'school-a', 'School A', 'school', 'school-a', 'live'),
  ('c2000000-0000-7000-8000-00000000000b', :G, 'school-b', 'School B', 'school', 'school-b', 'live'),
  ('c2000000-0000-7000-8000-00000000000c', :G, 'school-c', 'School C', 'school', 'school-c', 'live')
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.website_school (website_id, school_id, group_id, is_primary_website_for_school) VALUES
  ('c2000000-0000-7000-8000-00000000000a', :SA, :G, true),
  ('c2000000-0000-7000-8000-00000000000b', :SB, :G, true),
  ('c2000000-0000-7000-8000-00000000000c', :SC, :G, true),
  ('c2000000-0000-7000-8000-000000000001', :SA, :G, false),
  ('c2000000-0000-7000-8000-000000000001', :SB, :G, false),
  ('c2000000-0000-7000-8000-000000000001', :SC, :G, false)
ON CONFLICT DO NOTHING;

INSERT INTO org.website_domain (website_id, group_id, hostname, is_primary, verification_method, status, verified_at) VALUES
  ('c2000000-0000-7000-8000-000000000001', :G, 'pythagoras.localhost',          true, 'local_development', 'verified', now()),
  ('c2000000-0000-7000-8000-000000000002', :G, 'portal.pythagoras.localhost',   true, 'local_development', 'verified', now()),
  ('c2000000-0000-7000-8000-00000000000a', :G, 'school-a.pythagoras.localhost', true, 'local_development', 'verified', now()),
  ('c2000000-0000-7000-8000-00000000000b', :G, 'school-b.pythagoras.localhost', true, 'local_development', 'verified', now()),
  ('c2000000-0000-7000-8000-00000000000c', :G, 'school-c.pythagoras.localhost', true, 'local_development', 'verified', now())
ON CONFLICT (hostname) DO NOTHING;

-- People ---------------------------------------------------------------------
-- c1...: persons. Staff 01-10, parents 20-22, an unlinked login 23 has no person.
-- Students 30-32 have no login.
INSERT INTO people.person (id, group_id, given_name, family_name, email, registered_school_id) VALUES
  ('c1000000-0000-7000-8000-000000000001', :G, 'Elena',     'Petrova',   'ceo@pythagoras.test',              NULL),
  ('c1000000-0000-7000-8000-000000000002', :G, 'Georgi',    'Dimitrov',  'admin@pythagoras.test',            NULL),
  ('c1000000-0000-7000-8000-000000000003', :G, 'Maria',     'Koleva',    'finance@pythagoras.test',          NULL),
  ('c1000000-0000-7000-8000-000000000004', :G, 'Iva',       'Stoyanova', 'schoollife@pythagoras.test',       NULL),
  ('c1000000-0000-7000-8000-000000000005', :G, 'Nikolay',   'Vasilev',   'dpo@pythagoras.test',              NULL),
  ('c1000000-0000-7000-8000-000000000006', :G, 'Petar',     'Nikolov',   'principal.a@pythagoras.test',      :SA),
  ('c1000000-0000-7000-8000-000000000007', :G, 'Desislava', 'Todorova',  'principal.b@pythagoras.test',      :SB),
  ('c1000000-0000-7000-8000-000000000008', :G, 'Stefan',    'Angelov',   'principal.c@pythagoras.test',      :SC),
  ('c1000000-0000-7000-8000-000000000009', :G, 'Radka',     'Mineva',    'kitchen.a@pythagoras.test',        :SA),
  ('c1000000-0000-7000-8000-000000000010', :G, 'Viktor',    'Popov',     'teacher.b@pythagoras.test',        :SB),
  ('c1000000-0000-7000-8000-000000000020', :G, 'Anna',      'Ivanova',   'anna.ivanova@pythagoras.test',     NULL),
  ('c1000000-0000-7000-8000-000000000021', :G, 'Hristo',    'Georgiev',  'hristo.georgiev@pythagoras.test',  NULL),
  ('c1000000-0000-7000-8000-000000000022', :G, 'Teodora',   'Marinova',  'teodora.marinova@pythagoras.test', NULL),
  ('c1000000-0000-7000-8000-000000000030', :G, 'Mila',      'Ivanova',   NULL,                               :SA),
  ('c1000000-0000-7000-8000-000000000031', :G, 'Boris',     'Ivanov',    NULL,                               :SC),
  ('c1000000-0000-7000-8000-000000000032', :G, 'Kalina',    'Georgieva', NULL,                               :SB)
ON CONFLICT (id) DO NOTHING;

INSERT INTO people.login_identity (person_id, group_id, provider, subject)
SELECT ('c1000000-0000-7000-8000-0000000000' || n)::uuid, :G, 'keycloak', 'f1000000-0000-7000-8000-0000000000' || n
FROM unnest(ARRAY['01','02','03','04','05','06','07','08','09','10','20','21','22']) AS n
ON CONFLICT (provider, subject) DO NOTHING;

INSERT INTO access.role_assignment (group_id, person_id, role_code, school_id)
SELECT :G, v.person::uuid, v.role, v.school::uuid FROM (VALUES
  ('c1000000-0000-7000-8000-000000000001', 'group_ceo',               NULL),
  ('c1000000-0000-7000-8000-000000000002', 'group_admin',             NULL),
  ('c1000000-0000-7000-8000-000000000003', 'group_finance',           NULL),
  ('c1000000-0000-7000-8000-000000000004', 'school_life_coordinator', NULL),
  ('c1000000-0000-7000-8000-000000000005', 'privacy_officer',         NULL),
  ('c1000000-0000-7000-8000-000000000006', 'principal',               'b1000000-0000-7000-8000-00000000000a'),
  ('c1000000-0000-7000-8000-000000000007', 'principal',               'b1000000-0000-7000-8000-00000000000b'),
  ('c1000000-0000-7000-8000-000000000008', 'principal',               'b1000000-0000-7000-8000-00000000000c'),
  ('c1000000-0000-7000-8000-000000000009', 'kitchen',                 'b1000000-0000-7000-8000-00000000000a'),
  ('c1000000-0000-7000-8000-000000000010', 'teacher',                 'b1000000-0000-7000-8000-00000000000b')
) AS v (person, role, school)
WHERE NOT EXISTS (
  SELECT 1 FROM access.role_assignment ra
  WHERE ra.person_id = v.person::uuid AND ra.role_code = v.role AND ra.revoked_at IS NULL
);

INSERT INTO people.enrolment (group_id, student_person_id, school_id, academic_year, grade_level, class_label, start_date)
SELECT :G, v.student::uuid, v.school::uuid, '2026/2027', v.grade, v.class, DATE '2026-09-15' FROM (VALUES
  ('c1000000-0000-7000-8000-000000000030', 'b1000000-0000-7000-8000-00000000000a', '3', '3A'),
  ('c1000000-0000-7000-8000-000000000031', 'b1000000-0000-7000-8000-00000000000c', '1', '1B'),
  ('c1000000-0000-7000-8000-000000000032', 'b1000000-0000-7000-8000-00000000000b', '5', '5A')
) AS v (student, school, grade, class)
WHERE NOT EXISTS (SELECT 1 FROM people.enrolment e WHERE e.student_person_id = v.student::uuid AND e.school_id = v.school::uuid);

-- Synthetic dates of birth: age rules need them (M4.2).
UPDATE people.person SET date_of_birth = v.born::date
FROM (VALUES
  ('c1000000-0000-7000-8000-000000000030', '2018-04-12'),
  ('c1000000-0000-7000-8000-000000000031', '2020-05-20'),
  ('c1000000-0000-7000-8000-000000000032', '2016-09-03')
) AS v (student, born)
WHERE id = v.student::uuid AND date_of_birth IS NULL;

-- Anna Ivanova: two children at two schools. Hristo Georgiev: one child.
-- Teodora Marinova: a pending, unverified request for Mila (grants nothing).
INSERT INTO people.guardian_relationship
  (group_id, guardian_person_id, student_person_id, relationship, can_consent, status, verified_by_person_id, verified_at)
SELECT :G, v.guardian::uuid, v.student::uuid, 'parent', v.consent, v.status,
       CASE WHEN v.status = 'active' THEN v.verifier::uuid END, CASE WHEN v.status = 'active' THEN now() END
FROM (VALUES
  ('c1000000-0000-7000-8000-000000000020', 'c1000000-0000-7000-8000-000000000030', true,  'active',  'c1000000-0000-7000-8000-000000000006'),
  ('c1000000-0000-7000-8000-000000000020', 'c1000000-0000-7000-8000-000000000031', true,  'active',  'c1000000-0000-7000-8000-000000000008'),
  ('c1000000-0000-7000-8000-000000000021', 'c1000000-0000-7000-8000-000000000032', true,  'active',  'c1000000-0000-7000-8000-000000000007'),
  ('c1000000-0000-7000-8000-000000000022', 'c1000000-0000-7000-8000-000000000030', false, 'pending', NULL)
) AS v (guardian, student, consent, status, verifier)
WHERE NOT EXISTS (
  SELECT 1 FROM people.guardian_relationship g
  WHERE g.guardian_person_id = v.guardian::uuid AND g.student_person_id = v.student::uuid AND g.status IN ('pending', 'active')
);

INSERT INTO sensitive.dietary_requirement (group_id, student_person_id, kind, description, severity, allergens, provided_by_person_id)
SELECT :G, 'c1000000-0000-7000-8000-000000000030', 'allergy', 'Peanuts (synthetic example)', 'life_threatening', '{peanuts}', 'c1000000-0000-7000-8000-000000000020'
WHERE NOT EXISTS (SELECT 1 FROM sensitive.dietary_requirement WHERE student_person_id = 'c1000000-0000-7000-8000-000000000030');
-- Databases seeded before allergens were structured (M4.1).
UPDATE sensitive.dietary_requirement SET allergens = '{peanuts}'
WHERE student_person_id = 'c1000000-0000-7000-8000-000000000030' AND description = 'Peanuts (synthetic example)' AND allergens = '{}';

-- Catalog --------------------------------------------------------------------
INSERT INTO catalog.service_definition (id, group_id, code, kind, name) VALUES
  ('d1000000-0000-7000-8000-000000000001', :G, 'lunch',    'lunch',    'School lunch'),
  ('d1000000-0000-7000-8000-000000000002', :G, 'chess',    'activity', 'Chess club'),
  ('d1000000-0000-7000-8000-000000000003', :G, 'robotics', 'activity', 'Robotics club'),
  ('d1000000-0000-7000-8000-000000000005', :G, 'debate',   'activity', 'Debate club'),
  ('d1000000-0000-7000-8000-000000000006', :G, 'piano',    'lesson',   'Piano lessons'),
  ('d1000000-0000-7000-8000-000000000007', :G, 'museum',   'trip',     'Museum visit'),
  ('d1000000-0000-7000-8000-000000000008', :G, 'bus',      'transport', 'School bus'),
  ('d1000000-0000-7000-8000-000000000009', :G, 'polo',     'uniform',  'School polo shirt'),
  ('d1000000-0000-7000-8000-000000000004', :G, 'tuition',  'tuition',  'Tuition'),
  ('d1000000-0000-7000-8000-00000000000a', :G, 'enrolment-fee', 'fee', 'Enrolment fee')
ON CONFLICT (id) DO NOTHING;

-- Offerings, all billed by Testing Company. Each school sets its own prices.
INSERT INTO catalog.school_offering (id, group_id, school_id, service_definition_id, billing_entity_id, code, name, status) VALUES
  ('d2000000-0000-7000-8000-0000000000a1', :G, :SA, 'd1000000-0000-7000-8000-000000000001', :CO, 'lunch',    'Lunch at School A',    'published'),
  ('d2000000-0000-7000-8000-0000000000b1', :G, :SB, 'd1000000-0000-7000-8000-000000000001', :CO, 'lunch',    'Lunch at School B',    'published'),
  ('d2000000-0000-7000-8000-0000000000c1', :G, :SC, 'd1000000-0000-7000-8000-000000000001', :CO, 'lunch',    'Lunch at School C',    'published'),
  ('d2000000-0000-7000-8000-0000000000a2', :G, :SA, 'd1000000-0000-7000-8000-000000000002', :CO, 'chess',    'Chess club, School A', 'published'),
  ('d2000000-0000-7000-8000-0000000000c3', :G, :SC, 'd1000000-0000-7000-8000-000000000003', :CO, 'robotics', 'Robotics club, School C', 'published'),
  ('d2000000-0000-7000-8000-0000000000a5', :G, :SA, 'd1000000-0000-7000-8000-000000000005', :CO, 'debate',   'Debate club, School A', 'published'),
  ('d2000000-0000-7000-8000-0000000000a6', :G, :SA, 'd1000000-0000-7000-8000-000000000006', :CO, 'piano',    'Piano lessons, School A (5 lessons)', 'published'),
  ('d2000000-0000-7000-8000-0000000000a7', :G, :SA, 'd1000000-0000-7000-8000-000000000007', :CO, 'museum',   'Museum visit, School A', 'published'),
  ('d2000000-0000-7000-8000-0000000000a8', :G, :SA, 'd1000000-0000-7000-8000-000000000008', :CO, 'bus',      'School bus, route 1, School A', 'published'),
  ('d2000000-0000-7000-8000-0000000000a9', :G, :SA, 'd1000000-0000-7000-8000-000000000009', :CO, 'polo',     'School polo shirt, School A', 'published'),
  ('d2000000-0000-7000-8000-0000000000a4', :G, :SA, 'd1000000-0000-7000-8000-000000000004', :CO, 'tuition',  'Tuition, School A',    'published'),
  ('d2000000-0000-7000-8000-0000000000b4', :G, :SB, 'd1000000-0000-7000-8000-000000000004', :CO, 'tuition',  'Tuition, School B',    'published'),
  ('d2000000-0000-7000-8000-0000000000c4', :G, :SC, 'd1000000-0000-7000-8000-000000000004', :CO, 'tuition',  'Tuition, School C',    'published'),
  ('d2000000-0000-7000-8000-0000000000af', :G, :SA, 'd1000000-0000-7000-8000-00000000000a', :CO, 'enrolment-fee', 'Enrolment fee, School A', 'published')
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalog.price_version (id, group_id, offering_id, version, unit_amount_minor, vat_rate_bp, price_unit, valid_from)
SELECT ('d3' || substr(o.id::text, 3))::uuid, :G, o.id, 1, v.amount, 0, v.unit, TIMESTAMPTZ '2026-09-01 00:00 Europe/Sofia'
FROM (VALUES
  ('d2000000-0000-7000-8000-0000000000a1',   450, 'per_day'),
  ('d2000000-0000-7000-8000-0000000000b1',   480, 'per_day'),
  ('d2000000-0000-7000-8000-0000000000c1',   500, 'per_day'),
  ('d2000000-0000-7000-8000-0000000000a2',  6000, 'per_term'),
  ('d2000000-0000-7000-8000-0000000000c3',  8000, 'per_term'),
  ('d2000000-0000-7000-8000-0000000000a5',  5000, 'per_term'),
  ('d2000000-0000-7000-8000-0000000000a7',  1500, 'one_off'),
  ('d2000000-0000-7000-8000-0000000000a8',  9000, 'per_term'),
  ('d2000000-0000-7000-8000-0000000000a4', 45000, 'per_month'),
  ('d2000000-0000-7000-8000-0000000000b4', 42000, 'per_month'),
  ('d2000000-0000-7000-8000-0000000000c4', 48000, 'per_month'),
  ('d2000000-0000-7000-8000-0000000000af', 15000, 'one_off')
) AS v (offering, amount, unit)
JOIN catalog.school_offering o ON o.id = v.offering::uuid
ON CONFLICT (id) DO NOTHING;

-- Piano: a package of 5 lessons for 120.00 (M4.3).
INSERT INTO catalog.price_version (id, group_id, offering_id, version, unit_amount_minor, vat_rate_bp, price_unit, package_size, valid_from)
VALUES ('d3000000-0000-7000-8000-0000000000a6', :G, 'd2000000-0000-7000-8000-0000000000a6', 1, 12000, 0, 'per_package', 5,
        TIMESTAMPTZ '2026-09-01 00:00 Europe/Sofia')
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalog.policy_version (group_id, offering_id, kind, version, rules, valid_from)
SELECT :G, o.id, 'booking_and_cancellation', 1,
       CASE WHEN o.code = 'lunch'
            THEN '{"booking_cutoff": "previous school day 10:00", "cancellation_cutoff": "previous school day 14:00", "after_cancellation": "account_credit"}'::jsonb
            ELSE '{"booking_cutoff": "session start minus 24 hours", "cancellation_cutoff": "before first session", "after_cancellation": "account_credit"}'::jsonb END,
       TIMESTAMPTZ '2026-09-01 00:00 Europe/Sofia'
FROM catalog.school_offering o
WHERE o.group_id = :G AND o.code IN ('lunch', 'chess', 'robotics', 'debate')
  AND NOT EXISTS (SELECT 1 FROM catalog.policy_version p WHERE p.offering_id = o.id);

-- A trip (M4.4): the consent wording guardians agree to, and the day itself,
-- ten days from when the seed runs. Synthetic text.
INSERT INTO catalog.policy_version (group_id, offering_id, kind, version, terms_text, valid_from)
SELECT :G, 'd2000000-0000-7000-8000-0000000000a7', 'trip_consent', 1,
       'I give permission for my child to take part in the museum visit with School A, travelling by coach with school staff, '
       || 'and for staff to seek emergency medical treatment if I cannot be reached. (Synthetic example wording.)',
       TIMESTAMPTZ '2026-09-01 00:00 Europe/Sofia'
WHERE NOT EXISTS (SELECT 1 FROM catalog.policy_version
                   WHERE offering_id = 'd2000000-0000-7000-8000-0000000000a7' AND kind = 'trip_consent');
INSERT INTO scheduling.session (group_id, school_id, offering_id, starts_at, ends_at, location_label, capacity, booking_cutoff_at, cancellation_cutoff_at)
SELECT :G, :SA, 'd2000000-0000-7000-8000-0000000000a7',
       ((current_date + 10) + TIME '09:00') AT TIME ZONE 'Europe/Sofia',
       ((current_date + 10) + TIME '13:00') AT TIME ZONE 'Europe/Sofia',
       'National History Museum (synthetic)', 25,
       ((current_date + 8) + TIME '12:00') AT TIME ZONE 'Europe/Sofia',
       ((current_date + 8) + TIME '12:00') AT TIME ZONE 'Europe/Sofia'
WHERE NOT EXISTS (SELECT 1 FROM scheduling.session WHERE offering_id = 'd2000000-0000-7000-8000-0000000000a7');

-- Uniforms (M4.6): the School A polo shirt in four sizes, each with its own
-- price and stock. Size 140 has one left and 152 none, to show the limits.
INSERT INTO catalog.product_variant (id, group_id, school_id, offering_id, sku, size, colour, low_stock_threshold, on_hand) VALUES
  ('d6000000-0000-7000-8000-0000000000a1', :G, :SA, 'd2000000-0000-7000-8000-0000000000a9', 'POLO-NAVY-116', '116', 'Navy', 3, 10),
  ('d6000000-0000-7000-8000-0000000000a2', :G, :SA, 'd2000000-0000-7000-8000-0000000000a9', 'POLO-NAVY-128', '128', 'Navy', 3, 10),
  ('d6000000-0000-7000-8000-0000000000a3', :G, :SA, 'd2000000-0000-7000-8000-0000000000a9', 'POLO-NAVY-140', '140', 'Navy', 3, 1),
  ('d6000000-0000-7000-8000-0000000000a4', :G, :SA, 'd2000000-0000-7000-8000-0000000000a9', 'POLO-NAVY-152', '152', 'Navy', 3, 0)
ON CONFLICT (id) DO NOTHING;
INSERT INTO catalog.price_version (id, group_id, offering_id, variant_id, version, unit_amount_minor, vat_rate_bp, price_unit, valid_from)
SELECT ('d7' || substr(v.id::text, 3))::uuid, :G, v.offering_id, v.id, 1, CASE WHEN v.size = '152' THEN 2800 ELSE 2500 END, 0, 'one_off',
       TIMESTAMPTZ '2026-09-01 00:00 Europe/Sofia'
FROM catalog.product_variant v
-- Only the sizes above: tests add their own (with their own prices) and the
-- seed runs again on top of them.
WHERE v.id IN ('d6000000-0000-7000-8000-0000000000a1', 'd6000000-0000-7000-8000-0000000000a2',
               'd6000000-0000-7000-8000-0000000000a3', 'd6000000-0000-7000-8000-0000000000a4')
  AND NOT EXISTS (SELECT 1 FROM catalog.price_version p WHERE p.variant_id = v.id)
ON CONFLICT DO NOTHING;
-- The opening stock as fixed quantities, never the current count: tests change
-- the stock and the seed runs again on top of them.
INSERT INTO catalog.stock_movement (group_id, school_id, variant_id, kind, delta, reason)
SELECT :G, :SA, v.variant::uuid, 'delivery', v.quantity, 'Opening stock (synthetic)'
FROM (VALUES
  ('d6000000-0000-7000-8000-0000000000a1', 10),
  ('d6000000-0000-7000-8000-0000000000a2', 10),
  ('d6000000-0000-7000-8000-0000000000a3', 1)
) AS v (variant, quantity)
WHERE NOT EXISTS (SELECT 1 FROM catalog.stock_movement m
                   WHERE m.variant_id = v.variant::uuid AND m.reason = 'Opening stock (synthetic)');

-- A request (M4.7): Anna asks School A about collecting Mila on Friday.
INSERT INTO people.family_request (id, group_id, school_id, student_person_id, requested_by_person_id, kind, subject)
VALUES ('d8000000-0000-7000-8000-0000000000a1', :G, :SA, 'c1000000-0000-7000-8000-000000000030',
        'c1000000-0000-7000-8000-000000000020', 'collection', 'Grandmother collects Mila on Friday (synthetic)')
ON CONFLICT (id) DO NOTHING;
INSERT INTO people.family_request_message (id, group_id, request_id, author_person_id, from_school, body)
VALUES ('d8100000-0000-7000-8000-0000000000a1', :G, 'd8000000-0000-7000-8000-0000000000a1',
        'c1000000-0000-7000-8000-000000000020', false,
        'Mila''s grandmother, Elena Ivanova, will collect her at 15:00 on Friday. (Synthetic example.)')
ON CONFLICT (id) DO NOTHING;

-- Transport (M4.5): route 1 to School A on school days, three stops, 20 seats
-- for a term starting two weeks after the seed runs. Synthetic places and plate.
INSERT INTO scheduling.transport_route (offering_id, group_id, school_id, vehicle, weekdays)
VALUES ('d2000000-0000-7000-8000-0000000000a8', :G, :SA, 'Minibus CA 0000 XX (synthetic)', '{1,2,3,4,5}')
ON CONFLICT (offering_id) DO NOTHING;
INSERT INTO scheduling.transport_stop (id, group_id, school_id, offering_id, position, name, pickup_time, dropoff_time) VALUES
  ('d5000000-0000-7000-8000-0000000000a1', :G, :SA, 'd2000000-0000-7000-8000-0000000000a8', 1, 'Mladost metro station (synthetic)', TIME '07:20', TIME '16:40'),
  ('d5000000-0000-7000-8000-0000000000a2', :G, :SA, 'd2000000-0000-7000-8000-0000000000a8', 2, 'Druzhba park, north gate (synthetic)', TIME '07:35', TIME '16:25'),
  ('d5000000-0000-7000-8000-0000000000a3', :G, :SA, 'd2000000-0000-7000-8000-0000000000a8', 3, 'Iztok, bus shelter 4 (synthetic)', TIME '07:45', TIME '16:15')
ON CONFLICT (id) DO NOTHING;
INSERT INTO scheduling.session (group_id, school_id, offering_id, starts_at, ends_at, location_label, capacity, booking_cutoff_at, cancellation_cutoff_at)
SELECT :G, :SA, 'd2000000-0000-7000-8000-0000000000a8',
       (current_date + 14)::timestamp AT TIME ZONE 'Europe/Sofia',
       (current_date + 101)::timestamp AT TIME ZONE 'Europe/Sofia',
       'Spring term', 20,
       (current_date + 14)::timestamp AT TIME ZONE 'Europe/Sofia',
       (current_date + 14)::timestamp AT TIME ZONE 'Europe/Sofia'
WHERE NOT EXISTS (SELECT 1 FROM scheduling.session WHERE offering_id = 'd2000000-0000-7000-8000-0000000000a8');

-- Lessons (M4.3): a piano teacher and the music room at School A. The teacher
-- teaches on Tuesdays and Thursdays 14:00-17:00; the room is free on school
-- days 8:00-18:00. 45-minute slots for the next four weeks.
INSERT INTO scheduling.resource (id, group_id, school_id, kind, display_name) VALUES
  ('d4000000-0000-7000-8000-0000000000a1', :G, :SA, 'teacher', 'Ms Elena Georgieva (piano)'),
  ('d4000000-0000-7000-8000-0000000000a2', :G, :SA, 'room',    'Music room')
ON CONFLICT (id) DO NOTHING;
INSERT INTO scheduling.resource_availability (group_id, school_id, resource_id, weekday, starts, ends)
SELECT :G, :SA, v.resource::uuid, v.weekday, v.starts, v.ends FROM (VALUES
  ('d4000000-0000-7000-8000-0000000000a1', 2, TIME '14:00', TIME '17:00'),
  ('d4000000-0000-7000-8000-0000000000a1', 4, TIME '14:00', TIME '17:00'),
  ('d4000000-0000-7000-8000-0000000000a2', 1, TIME '08:00', TIME '18:00'),
  ('d4000000-0000-7000-8000-0000000000a2', 2, TIME '08:00', TIME '18:00'),
  ('d4000000-0000-7000-8000-0000000000a2', 3, TIME '08:00', TIME '18:00'),
  ('d4000000-0000-7000-8000-0000000000a2', 4, TIME '08:00', TIME '18:00'),
  ('d4000000-0000-7000-8000-0000000000a2', 5, TIME '08:00', TIME '18:00')
) AS v (resource, weekday, starts, ends)
WHERE NOT EXISTS (SELECT 1 FROM scheduling.resource_availability a WHERE a.resource_id = v.resource::uuid AND a.weekday = v.weekday);

-- Who may take each club (M4.2): grades at the school, or ages on the day.
-- Mila (grade 3) may take chess but not debate; Boris (6) may take robotics.
UPDATE catalog.school_offering SET eligibility = v.rules::jsonb
FROM (VALUES
  ('d2000000-0000-7000-8000-0000000000a2', '{"grades": ["2", "3", "4", "5", "6", "7"]}'),
  ('d2000000-0000-7000-8000-0000000000a5', '{"grades": ["5", "6", "7"]}'),
  ('d2000000-0000-7000-8000-0000000000c3', '{"min_age": 5, "max_age": 10}')
) AS v (offering, rules)
WHERE id = v.offering::uuid AND eligibility = '{}';

-- Sessions: the next 20 school days of lunch at each school, and weekly club
-- meetings for the next 8 weeks. Dates are relative to the day the seed runs.
INSERT INTO scheduling.session (group_id, school_id, offering_id, service_date, capacity, booking_cutoff_at, cancellation_cutoff_at)
SELECT :G, o.school_id, o.id, d::date, 250,
       ((d::date - 1) + TIME '10:00') AT TIME ZONE s.time_zone,
       ((d::date - 1) + TIME '14:00') AT TIME ZONE s.time_zone
FROM catalog.school_offering o
JOIN org.school s ON s.id = o.school_id
CROSS JOIN LATERAL (
  SELECT d FROM generate_series(current_date + 1, current_date + 40, interval '1 day') AS d
  WHERE extract(isodow FROM d) < 6 ORDER BY d LIMIT 20
) days
WHERE o.group_id = :G AND o.code = 'lunch'
  AND NOT EXISTS (SELECT 1 FROM scheduling.session x WHERE x.offering_id = o.id AND x.service_date = d::date);

INSERT INTO scheduling.session (group_id, school_id, offering_id, starts_at, ends_at, location_label, capacity, booking_cutoff_at)
SELECT :G, o.school_id, o.id,
       (d::date + v.starts) AT TIME ZONE s.time_zone,
       (d::date + v.ends) AT TIME ZONE s.time_zone,
       v.room, v.capacity,
       (d::date + v.starts) AT TIME ZONE s.time_zone - interval '24 hours'
FROM (VALUES
  ('d2000000-0000-7000-8000-0000000000a2', 3, TIME '14:00', TIME '15:00', 'Room 12', 12),
  ('d2000000-0000-7000-8000-0000000000c3', 4, TIME '15:00', TIME '16:30', 'Lab 2',   10),
  ('d2000000-0000-7000-8000-0000000000a5', 2, TIME '15:00', TIME '16:00', 'Library', 16)
) AS v (offering, weekday, starts, ends, room, capacity)
JOIN catalog.school_offering o ON o.id = v.offering::uuid
JOIN org.school s ON s.id = o.school_id
CROSS JOIN LATERAL (
  SELECT d FROM generate_series(current_date + 1, current_date + 56, interval '1 day') AS d
  WHERE extract(isodow FROM d) = v.weekday
) days
WHERE NOT EXISTS (
  SELECT 1 FROM scheduling.session x WHERE x.offering_id = o.id AND x.starts_at = (d::date + v.starts) AT TIME ZONE s.time_zone
);

-- Lesson slots; slots already there are skipped (they would overlap).
SELECT scheduling.create_lesson_slots('d2000000-0000-7000-8000-0000000000a6', 'd4000000-0000-7000-8000-0000000000a1',
                                      'd4000000-0000-7000-8000-0000000000a2', current_date + 1, current_date + 28, 45);

-- A synthetic weekly lunch menu (M4.1) on every seeded lunch day that has none,
-- with the allergens a caterer would declare. Thursday's dessert contains
-- peanuts, so the kitchen list warns about Mila on Thursdays she is booked.
INSERT INTO scheduling.menu_dish (group_id, school_id, session_id, position, course, name, allergens)
SELECT :G, x.school_id, x.id, m.position, m.course, m.name, m.allergens::text[]
FROM scheduling.session x
JOIN catalog.school_offering o ON o.id = x.offering_id AND o.code = 'lunch'
JOIN (VALUES
  (1, 1, 'soup',    'Bean soup',                       '{celery}'),
  (1, 2, 'main',    'Chicken with rice',               '{}'),
  (1, 3, 'dessert', 'Yoghurt with honey',              '{milk}'),
  (2, 1, 'soup',    'Tarator (cold cucumber soup)',    '{milk,nuts}'),
  (2, 2, 'main',    'Moussaka',                        '{eggs,milk,gluten}'),
  (3, 1, 'soup',    'Lentil soup',                     '{celery}'),
  (3, 2, 'main',    'Baked fish with potatoes',        '{fish}'),
  (3, 3, 'dessert', 'Seasonal fruit',                  '{}'),
  (4, 1, 'soup',    'Vegetable soup',                  '{celery}'),
  (4, 2, 'main',    'Spaghetti bolognese',             '{gluten}'),
  (4, 3, 'dessert', 'Peanut butter cookie',            '{peanuts,gluten,milk}'),
  (5, 1, 'soup',    'Chicken soup with noodles',       '{celery,gluten,eggs}'),
  (5, 2, 'main',    'Meatballs with mashed potatoes',  '{eggs,milk,gluten}'),
  (5, 3, 'dessert', 'Apple',                           '{}')
) AS m (isodow, position, course, name, allergens) ON m.isodow = extract(isodow FROM x.service_date)
WHERE x.group_id = :G
  AND NOT EXISTS (SELECT 1 FROM scheduling.menu_dish md WHERE md.session_id = x.id);

-- Admissions (M5.1, ADR 0026): a synthetic admissions privacy notice, to be
-- replaced by the DPO's own text before production, and one inquiry sent from
-- the School A website by a family that does not attend yet.
INSERT INTO admissions.privacy_notice (id, group_id, version, notice_text, news_consent_text, published_by_person_id)
VALUES ('d9000000-0000-7000-8000-000000000001', :G, 1,
        'SYNTHETIC NOTICE FOR DEVELOPMENT, NOT LEGAL TEXT. The school uses what you send here only to answer your '
        || 'question about a place and to arrange a visit, at your request before any contract (GDPR Art. 6(1)(b)). '
        || 'Only the school''s admissions staff read it. If no application follows, it is erased after the period the '
        || 'data protection officer sets. Contact dpo@pythagoras.test to see, correct or erase what is held about you.',
        'Also send me news about open days at this school. You can withdraw this at any time. (Synthetic.)',
        'c1000000-0000-7000-8000-000000000005')
ON CONFLICT (id) DO NOTHING;
INSERT INTO admissions.inquiry (id, group_id, school_id, website_id, notice_id, parent_name, email, child_name,
                                birth_year, grade_of_interest, intended_start, message)
VALUES ('da000000-0000-7000-8000-0000000000a1', :G, :SA, 'c2000000-0000-7000-8000-00000000000a',
        'd9000000-0000-7000-8000-000000000001', 'Lora Petkova (synthetic)', 'lora.petkova@example.test', 'Yana',
        2020, '1', 'September 2027',
        'We are moving to Sofia next summer. Is there a place in grade 1, and can we visit? (Synthetic example.)')
ON CONFLICT (id) DO NOTHING;
-- An intake (M5.2): grade 1 at School A for 2027/28, taking applications for
-- three months from the day the seed first runs.
INSERT INTO admissions.intake (id, group_id, school_id, school_year, grade, places, opens_on, closes_on, created_by_person_id)
VALUES ('db000000-0000-7000-8000-0000000000a1', :G, :SA, '2027/28', '1', 20, current_date - 1, current_date + 90,
        'c1000000-0000-7000-8000-000000000006')
ON CONFLICT (id) DO NOTHING;
-- Its enrolment fee (M5.8): 150.00, paid once the child is enrolled.
UPDATE admissions.intake SET fee_offering_id = 'd2000000-0000-7000-8000-0000000000af'
 WHERE id = 'db000000-0000-7000-8000-0000000000a1' AND fee_offering_id IS NULL;
-- Retention (M5.6): a draft policy for inquiries and applications that led to
-- no enrolment. Draft, so the worker erases nothing until the DPO approves a
-- period of their own (ADR 0006, 0026).
INSERT INTO privacy.retention_policy (group_id, code, description, applies_to, retain_for, after_action, legal_basis_note)
VALUES (:G, 'admissions.unsuccessful',
        'Inquiries and applications that did not lead to an enrolment (synthetic draft)',
        'admissions.inquiry, admissions.application', interval '12 months', 'pseudonymise',
        'To be set by the data protection officer before production.')
ON CONFLICT (group_id, code) DO NOTHING;

COMMIT;

SELECT 'seeded: ' || (SELECT count(*) FROM org.school WHERE group_id = 'a1000000-0000-7000-8000-000000000001') || ' schools, '
       || (SELECT count(*) FROM people.person WHERE group_id = 'a1000000-0000-7000-8000-000000000001') || ' people, '
       || (SELECT count(*) FROM scheduling.session WHERE group_id = 'a1000000-0000-7000-8000-000000000001') || ' sessions' AS result;
