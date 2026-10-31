-- Trips and guardian consent (M4.4).
BEGIN;
\ir _fixtures.sql
\echo '# 17 trips and consent'
\set TRIPD  '''50000000-0000-7000-8000-000000000017'''
\set TRIPA  '''60000000-0000-7000-8000-000000000017'''
\set PTRIP  '''70000000-0000-7000-8000-000000000017'''
\set WORDS1 '''71000000-0000-7000-8000-000000000017'''
\set WORDS2 '''71000000-0000-7000-8000-000000000018'''
\set STRIP  '''80000000-0000-7000-8000-000000000017'''
\set SPAST  '''80000000-0000-7000-8000-000000000018'''
\set OTRIP  '''92000000-0000-7000-8000-000000000017'''
\set LTRIP  '''92000000-0000-7000-8000-000000000018'''

RESET ROLE;
INSERT INTO catalog.service_definition (id, group_id, code, kind, name) VALUES (:TRIPD, :G, 'museum', 'trip', 'Museum visit');
INSERT INTO catalog.school_offering (id, group_id, school_id, service_definition_id, billing_entity_id, code, name, status)
VALUES (:TRIPA, :G, :A, :TRIPD, :E1, 'museum', 'Museum visit, School A', 'published');
INSERT INTO catalog.price_version (id, group_id, offering_id, version, unit_amount_minor, vat_rate_bp, price_unit, valid_from)
VALUES (:PTRIP, :G, :TRIPA, 1, 1500, 0, 'one_off', now() - interval '1 day');
INSERT INTO catalog.policy_version (id, group_id, offering_id, kind, version, terms_text, valid_from)
VALUES (:WORDS1, :G, :TRIPA, 'trip_consent', 1, 'I give permission for the museum visit (synthetic).', now() - interval '1 day');
INSERT INTO scheduling.session (id, group_id, school_id, offering_id, starts_at, ends_at, capacity) VALUES
  (:STRIP, :G, :A, :TRIPA, now() + interval '5 days', now() + interval '5 days 4 hours', 2),
  (:SPAST, :G, :A, :TRIPA, now() - interval '1 hour', now() + interval '3 hours', 2);

-- No booking without permission, whatever the request.
SELECT test.as_person(:P);
SELECT test.expect_error(format(
  'INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id) VALUES (%L,%L,%L,%L,%L,now() + interval %L,%L)',
  :G, :A, :STRIP, :K1, 'reserved', '30 minutes', :P), 'PY016', 'a trip cannot be booked without a guardian''s permission');

-- Only a guardian who may consent gives it.
SELECT test.expect_error(format(
  'INSERT INTO scheduling.trip_permission (group_id, school_id, session_id, student_person_id, policy_version_id, given_by_person_id, channel, emergency_contact_name, emergency_contact_phone) VALUES (%L,%L,%L,%L,%L,%L,%L,%L,%L)',
  :G, :A, :STRIP, :K1, :WORDS1, :P, 'family_portal', 'Grandma (synthetic)', '+359 88 123 4567'),
  '42501', 'a guardian without the consent capability cannot give permission');
RESET ROLE;
UPDATE people.guardian_relationship SET can_consent = true WHERE guardian_person_id = :P AND student_person_id = :K1;

SELECT test.as_person(:P);
SELECT test.expect_error(format(
  'INSERT INTO scheduling.trip_permission (group_id, school_id, session_id, student_person_id, policy_version_id, given_by_person_id, channel, emergency_contact_name, emergency_contact_phone) VALUES (%L,%L,%L,%L,%L,%L,%L,%L,%L)',
  :G, :A, :STRIP, :K1, :WORDS1, :P, 'family_portal', 'Grandma (synthetic)', 'call me'),
  '23514', 'the emergency phone number must look like one');
SELECT test.expect_error(format(
  'INSERT INTO scheduling.trip_permission (group_id, school_id, session_id, student_person_id, policy_version_id, given_by_person_id, channel, emergency_contact_name, emergency_contact_phone) VALUES (%L,%L,%L,%L,%L,%L,%L,%L,%L)',
  :G, :A, :SPAST, :K1, :WORDS1, :P, 'family_portal', 'Grandma (synthetic)', '+359 88 123 4567'),
  'PY007', 'no permission can be given once the trip has started');
SELECT test.expect_error(format(
  'INSERT INTO scheduling.trip_permission (group_id, school_id, session_id, student_person_id, policy_version_id, given_by_person_id, channel, emergency_contact_name, emergency_contact_phone) VALUES (%L,%L,%L,%L,%L,%L,%L,%L,%L)',
  :G, :A, :SCHA, :K1, :WORDS1, :P, 'family_portal', 'Grandma (synthetic)', '+359 88 123 4567'),
  '23514', 'permission is only for trips');
INSERT INTO scheduling.trip_permission (group_id, school_id, session_id, student_person_id, policy_version_id, given_by_person_id, channel, emergency_contact_name, emergency_contact_phone)
VALUES (:G, :A, :STRIP, :K1, :WORDS1, :P, 'family_portal', 'Grandma (synthetic)', '+359 88 123 4567');
SELECT test.ok(true, 'the guardian gives permission to the current wording');
SELECT test.expect_error(format(
  'INSERT INTO scheduling.trip_permission (group_id, school_id, session_id, student_person_id, policy_version_id, given_by_person_id, channel, emergency_contact_name, emergency_contact_phone) VALUES (%L,%L,%L,%L,%L,%L,%L,%L,%L)',
  :G, :A, :STRIP, :K1, :WORDS1, :P, 'family_portal', 'Grandma (synthetic)', '+359 88 123 4567'),
  '23505', 'one live permission per child and trip');

INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id)
VALUES (:G, :A, :STRIP, :K1, 'reserved', now() + interval '30 minutes', :P);
SELECT test.ok(true, 'with permission the trip is booked');

RESET ROLE;
CREATE TEMP TABLE perm ON COMMIT DROP AS SELECT id FROM scheduling.trip_permission WHERE session_id = :STRIP;
GRANT SELECT ON perm TO pyth_api;

-- Who sees it, and who may withdraw it.
SELECT test.as_person(:Q);
SELECT test.ok((SELECT count(*) FROM scheduling.trip_permission) = 0, 'another parent sees no permission');
SELECT test.expect_error('SELECT scheduling.withdraw_trip_permission((SELECT id FROM perm))',
  'P0002', 'another parent cannot withdraw it');
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.ok((SELECT emergency_contact_phone FROM scheduling.trip_permission) = '+359 88 123 4567',
  'the school''s staff see the permission and the emergency contact');
SELECT test.expect_error('SELECT scheduling.withdraw_trip_permission((SELECT id FROM perm))',
  'P0002', 'staff without consent.manage cannot withdraw it');

-- While the payment is open, withdrawal waits.
RESET ROLE; SELECT test.as_person(:P);
SELECT test.expect_error('SELECT scheduling.withdraw_trip_permission((SELECT id FROM perm))',
  'PY017', 'permission cannot be withdrawn while the trip''s payment is open');

-- Paid: withdrawing cancels the place and asks for credit.
RESET ROLE;
INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id)
VALUES (:OTRIP, :G, :E1, :P, 'family_portal', 'test-idem-1701', :P);
INSERT INTO commerce.order_line (id, group_id, order_id, billing_entity_id, line_no, school_id, offering_id, session_id, student_person_id,
                                 price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor)
VALUES (:LTRIP, :G, :OTRIP, :E1, 1, :A, :TRIPA, :STRIP, :K1, :PTRIP, 'Museum visit', 1, 'EUR', 1500, 0, 1500);
UPDATE scheduling.booking SET order_line_id = :LTRIP, status = 'confirmed', confirmed_at = now()
 WHERE session_id = :STRIP AND student_person_id = :K1;
UPDATE commerce.order_line SET status = 'confirmed' WHERE id = :LTRIP;

SELECT test.as_person(:P);
SELECT test.ok(scheduling.withdraw_trip_permission((SELECT id FROM perm)) = 'withdrawn_and_cancelled',
  'the guardian withdraws permission before the trip');
RESET ROLE;
SELECT test.ok((SELECT status FROM scheduling.booking WHERE session_id = :STRIP AND student_person_id = :K1) = 'cancelled'
           AND (SELECT status FROM commerce.order_line WHERE id = :LTRIP) = 'cancelled',
  'the place and its order line are cancelled');
SELECT test.ok((SELECT payload ->> 'cause' FROM integration.outbox_event
                WHERE aggregate_id = :LTRIP AND event_type = 'commerce.order_line.cancelled') = 'consent_withdrawn',
  'the worker is asked to credit what was paid');
SELECT test.ok((SELECT confirmed_count FROM scheduling.session WHERE id = :STRIP) = 0, 'the place is free again');
SELECT test.as_person(:P);
SELECT test.expect_error('SELECT scheduling.withdraw_trip_permission((SELECT id FROM perm))',
  'PY001', 'a withdrawn permission cannot be withdrawn again');

-- Staff record a permission given on paper, only from a guardian who may consent.
RESET ROLE; SELECT test.as_person(:SL);
SELECT test.expect_error(format(
  'INSERT INTO scheduling.trip_permission (group_id, school_id, session_id, student_person_id, policy_version_id, given_by_person_id, channel, recorded_by_person_id, emergency_contact_name, emergency_contact_phone) VALUES (%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',
  :G, :A, :STRIP, :K1, :WORDS1, :R, 'paper', :SL, 'Uncle (synthetic)', '+359 88 765 4321'),
  '42501', 'staff cannot record permission from someone who is not the child''s guardian');
INSERT INTO scheduling.trip_permission (group_id, school_id, session_id, student_person_id, policy_version_id, given_by_person_id, channel, recorded_by_person_id, emergency_contact_name, emergency_contact_phone)
VALUES (:G, :A, :STRIP, :K1, :WORDS1, :P, 'paper', :SL, 'Uncle (synthetic)', '+359 88 765 4321');
SELECT test.ok(true, 'School Life records a permission the guardian gave on paper');

-- New wording: earlier permissions no longer allow a new booking.
RESET ROLE; SELECT test.as_person(:ADM);
UPDATE catalog.policy_version SET valid_until = now() WHERE id = :WORDS1;
INSERT INTO catalog.policy_version (id, group_id, offering_id, kind, version, terms_text, valid_from)
VALUES (:WORDS2, :G, :TRIPA, 'trip_consent', 2, 'New wording: the visit now includes a picnic (synthetic).', now());
RESET ROLE; SELECT test.as_person(:P);
SELECT test.expect_error(format(
  'INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id) VALUES (%L,%L,%L,%L,%L,now() + interval %L,%L)',
  :G, :A, :STRIP, :K1, 'reserved', '30 minutes', :P), 'PY016', 'a permission to the old wording does not allow a new booking');
SELECT test.expect_error(format(
  'INSERT INTO scheduling.trip_permission (group_id, school_id, session_id, student_person_id, policy_version_id, given_by_person_id, channel, emergency_contact_name, emergency_contact_phone) VALUES (%L,%L,%L,%L,%L,%L,%L,%L,%L)',
  :G, :A, :STRIP, :K1, :WORDS1, :P, 'family_portal', 'Grandma (synthetic)', '+359 88 123 4567'),
  'PY016', 'a permission can only be given to the wording in force');

RESET ROLE;
ROLLBACK;
