-- DEVELOPMENT ONLY - removes every order, booking, trip permission, lesson
-- package, payment, credit and provider event so purchase tests start from
-- the seeded catalogue, and every school the onboarding tests added (code
-- starting "test-") with its offerings, sessions, staff and students, and
-- "Test company" billing entities. Refuses to run when
-- the database holds anyone without a reserved .test address (that is, real
-- people). Needs a superuser: the ledger is append-only, so its triggers are
-- switched off for this one transaction, and session counters are reset.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'pythagoras'
     OR EXISTS (SELECT 1 FROM people.person WHERE email IS NOT NULL AND email NOT LIKE '%@pythagoras.test') THEN
    RAISE EXCEPTION 'reset-test-data: this is not the synthetic development database';
  END IF;
END $$;
SET LOCAL session_replication_role = replica;
DELETE FROM commerce.payment_allocation;
DELETE FROM commerce.credit_application;
DELETE FROM commerce.refund;
DELETE FROM commerce.account_credit;
DELETE FROM scheduling.trip_permission;
DELETE FROM scheduling.package_entry;
DELETE FROM scheduling.lesson_package;
DELETE FROM scheduling.booking;
DELETE FROM commerce.payment;
DELETE FROM commerce.order_line;
DELETE FROM commerce.customer_order;
DELETE FROM integration.inbound_event WHERE provider IN ('development', 'stripe');
DELETE FROM integration.outbox_event WHERE aggregate_type LIKE 'commerce.%';
UPDATE scheduling.session SET reserved_count = 0, confirmed_count = 0 WHERE reserved_count <> 0 OR confirmed_count <> 0;

CREATE TEMP TABLE test_school ON COMMIT DROP AS SELECT id FROM org.school WHERE code LIKE 'test-%';
CREATE TEMP TABLE test_person ON COMMIT DROP AS
  SELECT id FROM people.person WHERE registered_school_id IN (SELECT id FROM test_school);
DELETE FROM access.role_assignment
 WHERE school_id IN (SELECT id FROM test_school) OR person_id IN (SELECT id FROM test_person);
DELETE FROM people.guardian_relationship WHERE student_person_id IN (SELECT id FROM test_person);
DELETE FROM people.enrolment WHERE school_id IN (SELECT id FROM test_school) OR student_person_id IN (SELECT id FROM test_person);
DELETE FROM sensitive.dietary_requirement WHERE student_person_id IN (SELECT id FROM test_person);
-- Needs the integration and end-to-end tests record for seeded children.
DELETE FROM sensitive.dietary_requirement WHERE description LIKE '%(integration test)' OR description LIKE '%(e2e test)';
DELETE FROM people.login_identity WHERE person_id IN (SELECT id FROM test_person);
DELETE FROM people.person WHERE id IN (SELECT id FROM test_person);
-- Teachers and rooms the tests added, with their slots. Cascades do not run
-- here (triggers are off), so dependent rows go explicitly.
CREATE TEMP TABLE test_resource ON COMMIT DROP AS
  SELECT id FROM scheduling.resource
   WHERE school_id IN (SELECT id FROM test_school)
      OR display_name LIKE '%(integration test)' OR display_name LIKE '%(e2e test)';
CREATE TEMP TABLE test_slot ON COMMIT DROP AS
  SELECT DISTINCT session_id AS id FROM scheduling.session_resource WHERE resource_id IN (SELECT id FROM test_resource);
DELETE FROM scheduling.session_resource
 WHERE session_id IN (SELECT id FROM test_slot) OR school_id IN (SELECT id FROM test_school);
DELETE FROM scheduling.resource_availability WHERE resource_id IN (SELECT id FROM test_resource);
DELETE FROM scheduling.resource WHERE id IN (SELECT id FROM test_resource);
DELETE FROM scheduling.transport_stop WHERE name LIKE '%(integration test)' OR name LIKE '%(e2e test)';
DELETE FROM scheduling.menu_dish WHERE school_id IN (SELECT id FROM test_school) OR session_id IN (SELECT id FROM test_slot);
DELETE FROM scheduling.session WHERE school_id IN (SELECT id FROM test_school) OR id IN (SELECT id FROM test_slot);
DELETE FROM catalog.price_version
 WHERE offering_id IN (SELECT id FROM catalog.school_offering WHERE school_id IN (SELECT id FROM test_school));
DELETE FROM catalog.policy_version
 WHERE offering_id IN (SELECT id FROM catalog.school_offering WHERE school_id IN (SELECT id FROM test_school));
DELETE FROM catalog.school_offering WHERE school_id IN (SELECT id FROM test_school);
DELETE FROM org.website_domain WHERE website_id IN (SELECT id FROM org.website WHERE code LIKE 'test-%');
DELETE FROM org.website_school
 WHERE school_id IN (SELECT id FROM test_school) OR website_id IN (SELECT id FROM org.website WHERE code LIKE 'test-%');
DELETE FROM org.website WHERE code LIKE 'test-%';
DELETE FROM org.school WHERE id IN (SELECT id FROM test_school);
DELETE FROM org.legal_entity e
 WHERE e.legal_name LIKE 'Test company %' AND NOT EXISTS (SELECT 1 FROM org.school s WHERE s.default_billing_entity_id = e.id);
COMMIT;
