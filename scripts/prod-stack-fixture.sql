-- SYNTHETIC DATA for scripts/prod-stack-test.sh only (M8.8): what a family's
-- purchase and a school website need on the production stack the check starts
-- from nothing. Builds on the group, parent and member of staff the check
-- creates for its sign-in (a8…, c8…01, c8…02). Never load into a real
-- installation; the check's stack is removed when it ends.
--
-- One company, "Testing Company" (placeholder name), bills School E. Its
-- website is live on www.school-e.test, verified as the worker would after
-- finding the TXT record; a chess club for 60.00 a term meets weekly.

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL app.actor = 'test:production-end-to-end';

\set G       '''a8000000-0000-7000-8000-000000000001'''
\set CO      '''e8000000-0000-7000-8000-000000000001'''
\set SE      '''b8000000-0000-7000-8000-000000000001'''
\set SITE    '''c2800000-0000-7000-8000-000000000001'''
\set PARENT  '''c8000000-0000-7000-8000-000000000001'''
\set STAFF   '''c8000000-0000-7000-8000-000000000002'''
\set CHILD   '''c8000000-0000-7000-8000-000000000003'''
\set CHESS   '''d8000000-0000-7000-8000-000000000002'''

INSERT INTO org.legal_entity (id, group_id, legal_name, registration_number)
VALUES (:CO, :G, 'Testing Company', 'TEST-0001');
INSERT INTO org.school (id, group_id, code, name, kind, default_billing_entity_id, status)
VALUES (:SE, :G, 'school-e', 'School E', 'school', :CO, 'active');

-- The school's website, without pages in the CMS yet: it shows the platform's start page.
INSERT INTO org.website (id, group_id, code, name, purpose, status)
VALUES (:SITE, :G, 'school-e', 'School E', 'school', 'live');
INSERT INTO org.website_school (website_id, school_id, group_id, is_primary_website_for_school)
VALUES (:SITE, :SE, :G, true);
INSERT INTO org.website_domain (website_id, group_id, hostname, is_primary, verification_method, verification_token, status, verified_at)
VALUES (:SITE, :G, 'www.school-e.test', true, 'dns_txt', 'synthetic-verification-token', 'verified', now());
-- A domain still waiting for its TXT record: no certificate, no website.
INSERT INTO org.website_domain (website_id, group_id, hostname, is_primary, verification_method, verification_token, status)
VALUES (:SITE, :G, 'pending.school-e.test', false, 'dns_txt', 'synthetic-pending-token', 'pending');

-- The parent's child at School E.
INSERT INTO people.person (id, group_id, given_name, family_name, date_of_birth, registered_school_id)
VALUES (:CHILD, :G, 'Vesela', 'Proeva', DATE '2017-03-14', :SE);
INSERT INTO people.enrolment (group_id, student_person_id, school_id, academic_year, grade_level, class_label, start_date)
VALUES (:G, :CHILD, :SE, '2026/2027', '3', '3A', DATE '2026-09-15');
INSERT INTO people.guardian_relationship
  (group_id, guardian_person_id, student_person_id, relationship, can_consent, status, verified_by_person_id, verified_at)
VALUES (:G, :PARENT, :CHILD, 'parent', true, 'active', :STAFF, now());

-- The chess club: 60.00 a term, eight weekly meetings from next week.
INSERT INTO catalog.service_definition (id, group_id, code, kind, name)
VALUES ('d8000000-0000-7000-8000-000000000001', :G, 'chess', 'activity', 'Chess club');
INSERT INTO catalog.school_offering (id, group_id, school_id, service_definition_id, billing_entity_id, code, name, status)
VALUES (:CHESS, :G, :SE, 'd8000000-0000-7000-8000-000000000001', :CO, 'chess', 'Chess club, School E', 'published');
INSERT INTO catalog.price_version (id, group_id, offering_id, version, unit_amount_minor, vat_rate_bp, price_unit, valid_from)
VALUES ('d8000000-0000-7000-8000-000000000003', :G, :CHESS, 1, 6000, 0, 'per_term', now() - interval '1 day');
INSERT INTO catalog.policy_version (group_id, offering_id, kind, version, rules, valid_from)
VALUES (:G, :CHESS, 'booking_and_cancellation', 1,
        '{"booking_cutoff": "session start minus 24 hours", "cancellation_cutoff": "before first session", "after_cancellation": "account_credit"}',
        now() - interval '1 day');
INSERT INTO scheduling.session (group_id, school_id, offering_id, starts_at, ends_at, location_label, capacity, booking_cutoff_at)
SELECT :G, :SE, :CHESS,
       ((current_date + 7 * w) + TIME '14:00') AT TIME ZONE 'Europe/Sofia',
       ((current_date + 7 * w) + TIME '15:00') AT TIME ZONE 'Europe/Sofia',
       'Room 4', 12,
       ((current_date + 7 * w) + TIME '14:00') AT TIME ZONE 'Europe/Sofia' - interval '24 hours'
FROM generate_series(1, 8) AS w;

COMMIT;
