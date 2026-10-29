-- A fourth school, with its own company, website, prices and staff, is added
-- through ordinary API operations: data only, no schema or code change.
BEGIN;
\ir _fixtures.sql
\echo '# 12 adding a fourth school'
\set E3  '''e0000000-0000-7000-8000-000000000003'''
\set D   '''5c000000-0000-7000-8000-00000000000d'''
\set WD  '''c0000000-0000-7000-8000-00000000000d'''
\set LD  '''60000000-0000-7000-8000-00000000000d'''
\set PLD '''70000000-0000-7000-8000-00000000000d'''
\set SLD '''80000000-0000-7000-8000-00000000000d'''
\set PRD '''10000000-0000-7000-8000-0000000000d1'''
\set K4  '''30000000-0000-7000-8000-000000000004'''
\set OD  '''90000000-0000-7000-8000-00000000000d'''

SELECT count(*) AS tables_before FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'test') \gset

-- The group administrator configures the new school.
RESET ROLE; SELECT test.as_person(:ADM);
INSERT INTO org.legal_entity (id, group_id, legal_name, registration_number) VALUES (:E3, :G, 'Pythagoras Sofia South Ltd (synthetic)', '000000003');
INSERT INTO org.school (id, group_id, code, name, kind, default_billing_entity_id) VALUES (:D, :G, 'school-d', 'School D', 'school', :E3);
INSERT INTO org.website (id, group_id, code, name, purpose, cms_tenant_key) VALUES (:WD, :G, 'school-d', 'School D website', 'school', 'school-d');
INSERT INTO org.website_school (website_id, school_id, group_id, is_primary_website_for_school) VALUES (:WD, :D, :G, true);
INSERT INTO org.website_domain (website_id, group_id, hostname, is_primary, verification_method, status, verified_at)
VALUES (:WD, :G, 'school-d.test', true, 'local_development', 'verified', now());
SELECT test.expect_error(format(
  'INSERT INTO org.website_domain (website_id, group_id, hostname, verification_method, status, verified_at) VALUES (%L,%L,%L,%L,%L, now())',
  :WD, :G, 'school-d.example.bg', 'dns_txt', 'verified'), '42501', 'a real domain cannot be marked verified without a DNS check');
INSERT INTO org.website_domain (website_id, group_id, hostname, verification_method, verification_token)
VALUES (:WD, :G, 'school-d.example.bg', 'dns_txt', 'synthetic-token');
SELECT test.expect_error(format(
  'INSERT INTO org.website_domain (website_id, group_id, hostname, verification_method, status, verified_at) VALUES (%L,%L,%L,%L,%L, now())',
  :WD, :G, 'school-d.example.com', 'local_development', 'verified'), '23514', 'the local-development shortcut only works for .test and .localhost');

INSERT INTO catalog.school_offering (id, group_id, school_id, service_definition_id, billing_entity_id, code, name, status)
VALUES (:LD, :G, :D, :LUNCH, :E3, 'lunch', 'Lunch at School D', 'published');
INSERT INTO catalog.price_version (id, group_id, offering_id, version, unit_amount_minor, price_unit, valid_from, created_by_person_id)
VALUES (:PLD, :G, :LD, 1, 520, 'per_day', now(), :ADM);
INSERT INTO scheduling.session (id, group_id, school_id, offering_id, service_date, capacity) VALUES (:SLD, :G, :D, :LD, DATE '2026-11-02', 80);

INSERT INTO people.person (id, group_id, given_name, family_name, email, registered_school_id)
VALUES (:PRD, :G, 'Daniela', 'Principal', 'prd@example.test', :D);
INSERT INTO access.role_assignment (group_id, person_id, role_code, school_id, granted_by_person_id) VALUES (:G, :PRD, 'principal', :D, :ADM);
UPDATE org.school SET status = 'active' WHERE id = :D;
UPDATE org.website SET status = 'live' WHERE id = :WD;
SELECT test.ok(true, 'the group administrator adds a company, school, website, domain, lunch price and principal');

RESET ROLE; SELECT test.as_anonymous();
SELECT test.ok((SELECT website_id FROM org.resolve_hostname('School-D.test')) = :WD::uuid,
  'the new school''s website resolves from its domain');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM org.resolve_hostname('school-d.example.bg')),
  'an unverified domain is not routed');

-- The new principal enrols parent P's third child and verifies the relationship.
RESET ROLE; SELECT test.as_person(:PRD);
INSERT INTO people.person (id, group_id, given_name, family_name, registered_school_id) VALUES (:K4, :G, 'Kalina', 'Ivanova', :D);
INSERT INTO people.enrolment (group_id, student_person_id, school_id, academic_year, grade_level, start_date)
VALUES (:G, :K4, :D, '2026/2027', '1', DATE '2026-09-15');
INSERT INTO people.guardian_relationship (group_id, guardian_person_id, student_person_id, relationship, status, verified_by_person_id, verified_at)
VALUES (:G, :P, :K4, 'parent', 'active', :PRD, now());
SELECT test.ok((SELECT array_agg(student_person_id) FROM people.enrolment) = ARRAY[:K4]::uuid[],
  'the new principal sees only the new school''s enrolments');

RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.ok((SELECT count(*) FROM people.person WHERE id = :K4) = 0, 'other principals cannot see the new school''s students');

-- Parent P now manages children in three schools and buys lunch at School D.
RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok((SELECT count(*) FROM people.enrolment) = 3, 'parent P sees children at three schools');
INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id)
VALUES (:OD, :G, :E3, :P, 'family_portal', 'test-idem-0501', :P);
INSERT INTO commerce.order_line (group_id, order_id, billing_entity_id, line_no, school_id, offering_id, session_id, student_person_id,
                                 price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor)
VALUES (:G, :OD, :E3, 1, :D, :LD, :SLD, :K4, :PLD, 'Lunch, School D', 1, 'EUR', 520, 0, 520);
INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id)
VALUES (:G, :D, :SLD, :K4, 'reserved', now() + interval '30 minutes', :P);
UPDATE commerce.customer_order SET status = 'pending_payment', placed_at = now(), total_minor = 520 WHERE id = :OD;
SELECT test.ok((SELECT billing_entity_id FROM commerce.customer_order WHERE id = :OD) = :E3::uuid,
  'the order for School D is billed by the new company');

RESET ROLE;
SELECT test.ok((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'test')) = :tables_before,
  'adding the school created no tables or schema objects');

ROLLBACK;
