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

INSERT INTO sensitive.dietary_requirement (group_id, student_person_id, kind, description, severity, provided_by_person_id)
SELECT :G, 'c1000000-0000-7000-8000-000000000030', 'allergy', 'Peanuts (synthetic example)', 'life_threatening', 'c1000000-0000-7000-8000-000000000020'
WHERE NOT EXISTS (SELECT 1 FROM sensitive.dietary_requirement WHERE student_person_id = 'c1000000-0000-7000-8000-000000000030');

-- Catalog --------------------------------------------------------------------
INSERT INTO catalog.service_definition (id, group_id, code, kind, name) VALUES
  ('d1000000-0000-7000-8000-000000000001', :G, 'lunch',    'lunch',    'School lunch'),
  ('d1000000-0000-7000-8000-000000000002', :G, 'chess',    'activity', 'Chess club'),
  ('d1000000-0000-7000-8000-000000000003', :G, 'robotics', 'activity', 'Robotics club'),
  ('d1000000-0000-7000-8000-000000000004', :G, 'tuition',  'tuition',  'Tuition')
ON CONFLICT (id) DO NOTHING;

-- Offerings, all billed by Testing Company. Each school sets its own prices.
INSERT INTO catalog.school_offering (id, group_id, school_id, service_definition_id, billing_entity_id, code, name, status) VALUES
  ('d2000000-0000-7000-8000-0000000000a1', :G, :SA, 'd1000000-0000-7000-8000-000000000001', :CO, 'lunch',    'Lunch at School A',    'published'),
  ('d2000000-0000-7000-8000-0000000000b1', :G, :SB, 'd1000000-0000-7000-8000-000000000001', :CO, 'lunch',    'Lunch at School B',    'published'),
  ('d2000000-0000-7000-8000-0000000000c1', :G, :SC, 'd1000000-0000-7000-8000-000000000001', :CO, 'lunch',    'Lunch at School C',    'published'),
  ('d2000000-0000-7000-8000-0000000000a2', :G, :SA, 'd1000000-0000-7000-8000-000000000002', :CO, 'chess',    'Chess club, School A', 'published'),
  ('d2000000-0000-7000-8000-0000000000c3', :G, :SC, 'd1000000-0000-7000-8000-000000000003', :CO, 'robotics', 'Robotics club, School C', 'published'),
  ('d2000000-0000-7000-8000-0000000000a4', :G, :SA, 'd1000000-0000-7000-8000-000000000004', :CO, 'tuition',  'Tuition, School A',    'published'),
  ('d2000000-0000-7000-8000-0000000000b4', :G, :SB, 'd1000000-0000-7000-8000-000000000004', :CO, 'tuition',  'Tuition, School B',    'published'),
  ('d2000000-0000-7000-8000-0000000000c4', :G, :SC, 'd1000000-0000-7000-8000-000000000004', :CO, 'tuition',  'Tuition, School C',    'published')
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalog.price_version (id, group_id, offering_id, version, unit_amount_minor, vat_rate_bp, price_unit, valid_from)
SELECT ('d3' || substr(o.id::text, 3))::uuid, :G, o.id, 1, v.amount, 0, v.unit, TIMESTAMPTZ '2026-09-01 00:00 Europe/Sofia'
FROM (VALUES
  ('d2000000-0000-7000-8000-0000000000a1',   450, 'per_day'),
  ('d2000000-0000-7000-8000-0000000000b1',   480, 'per_day'),
  ('d2000000-0000-7000-8000-0000000000c1',   500, 'per_day'),
  ('d2000000-0000-7000-8000-0000000000a2',  6000, 'per_term'),
  ('d2000000-0000-7000-8000-0000000000c3',  8000, 'per_term'),
  ('d2000000-0000-7000-8000-0000000000a4', 45000, 'per_month'),
  ('d2000000-0000-7000-8000-0000000000b4', 42000, 'per_month'),
  ('d2000000-0000-7000-8000-0000000000c4', 48000, 'per_month')
) AS v (offering, amount, unit)
JOIN catalog.school_offering o ON o.id = v.offering::uuid
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalog.policy_version (group_id, offering_id, kind, version, rules, valid_from)
SELECT :G, o.id, 'booking_and_cancellation', 1,
       CASE WHEN o.code = 'lunch'
            THEN '{"booking_cutoff": "previous school day 10:00", "cancellation_cutoff": "previous school day 14:00", "after_cancellation": "account_credit"}'::jsonb
            ELSE '{"booking_cutoff": "session start minus 24 hours", "cancellation_cutoff": "before first session", "after_cancellation": "account_credit"}'::jsonb END,
       TIMESTAMPTZ '2026-09-01 00:00 Europe/Sofia'
FROM catalog.school_offering o
WHERE o.group_id = :G AND o.code IN ('lunch', 'chess', 'robotics')
  AND NOT EXISTS (SELECT 1 FROM catalog.policy_version p WHERE p.offering_id = o.id);

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
  ('d2000000-0000-7000-8000-0000000000c3', 4, TIME '15:00', TIME '16:30', 'Lab 2',   10)
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

COMMIT;

SELECT 'seeded: ' || (SELECT count(*) FROM org.school WHERE group_id = 'a1000000-0000-7000-8000-000000000001') || ' schools, '
       || (SELECT count(*) FROM people.person WHERE group_id = 'a1000000-0000-7000-8000-000000000001') || ' people, '
       || (SELECT count(*) FROM scheduling.session WHERE group_id = 'a1000000-0000-7000-8000-000000000001') || ' sessions' AS result;
