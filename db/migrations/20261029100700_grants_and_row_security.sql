-- migrate:up
--
-- Table privileges and row-level security for every application table, in one
-- place so the access matrix can be reviewed as a whole (ADR 0004, 0005).
--
-- pyth_api    acts for the signed-in person (app.person_id). Policies decide rows;
--             column grants decide which fields the API may write.
-- pyth_worker acts as the system for background jobs, on the tables it needs.
-- Owners bypass RLS (no FORCE), which keeps migrations independent of context.

-- ---------------------------------------------------------------------------
-- Helpers that read across RLS boundaries (security definer, owner-run).
-- ---------------------------------------------------------------------------
CREATE FUNCTION access.current_group_id() RETURNS uuid
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT p.group_id FROM people.person p WHERE p.id = app.current_person_id() AND p.status = 'active' $$;

CREATE FUNCTION commerce.is_order_payer(p_order_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM commerce.customer_order o WHERE o.id = p_order_id AND o.payer_person_id = app.current_person_id()) $$;

-- The permission held at group scope, or at a school that has a line on the order.
CREATE FUNCTION commerce.has_order_permission(p_order_id uuid, p_permission text) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT access.has_permission(p_permission, NULL)
      OR EXISTS (SELECT 1 FROM commerce.order_line l
                 WHERE l.order_id = p_order_id AND access.has_permission(p_permission, l.school_id))
$$;

CREATE FUNCTION commerce.can_read_order(p_order_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT commerce.is_order_payer(p_order_id) OR commerce.has_order_permission(p_order_id, 'finance.read') $$;

CREATE FUNCTION commerce.payment_order_id(p_payment_id uuid) RETURNS uuid
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT order_id FROM commerce.payment WHERE id = p_payment_id $$;

CREATE FUNCTION commerce.line_order_id(p_order_line_id uuid) RETURNS uuid
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT order_id FROM commerce.order_line WHERE id = p_order_line_id $$;

CREATE FUNCTION catalog.offering_school_id(p_offering_id uuid) RETURNS uuid
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT school_id FROM catalog.school_offering WHERE id = p_offering_id $$;

CREATE FUNCTION catalog.offering_is_published(p_offering_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM catalog.school_offering WHERE id = p_offering_id AND status = 'published') $$;

GRANT EXECUTE ON FUNCTION
  access.current_group_id(), commerce.is_order_payer(uuid), commerce.has_order_permission(uuid, text),
  commerce.can_read_order(uuid), commerce.payment_order_id(uuid), commerce.line_order_id(uuid),
  catalog.offering_school_id(uuid), catalog.offering_is_published(uuid)
  TO pyth_api, pyth_worker;
GRANT EXECUTE ON FUNCTION org.resolve_hostname(text) TO pyth_api;

-- Webhook payloads are reduced to identifiers after the retention period.
CREATE FUNCTION integration.purge_inbound_payloads(p_older_than interval DEFAULT interval '90 days') RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  purged integer;
BEGIN
  UPDATE integration.inbound_event
     SET payload = NULL, payload_purged_at = now()
   WHERE payload IS NOT NULL AND received_at < now() - p_older_than
     AND processing_status IN ('processed', 'ignored');
  GET DIAGNOSTICS purged = ROW_COUNT;
  RETURN purged;
END $$;
GRANT EXECUTE ON FUNCTION integration.purge_inbound_payloads(interval) TO pyth_worker;

-- ---------------------------------------------------------------------------
-- Enable RLS on every application table.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT n.nspname, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname IN ('audit', 'org', 'people', 'access', 'catalog', 'scheduling', 'commerce', 'integration', 'privacy', 'sensitive')
      AND NOT c.relispartition
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.nspname, t.relname);
  END LOOP;
END $$;

-- The worker acts as the system on the tables it is granted (privileges below
-- decide which operations). Health data is deliberately excluded.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'org.education_group', 'org.legal_entity', 'org.school', 'org.website', 'org.website_school', 'org.website_domain',
    'people.person', 'people.login_identity', 'people.guardian_relationship', 'people.enrolment',
    'access.permission', 'access.role', 'access.role_permission', 'access.role_assignment',
    'catalog.service_definition', 'catalog.school_offering', 'catalog.policy_version', 'catalog.price_version',
    'scheduling.session', 'scheduling.booking',
    'commerce.customer_order', 'commerce.order_line', 'commerce.payment', 'commerce.account_credit',
    'commerce.credit_application', 'commerce.refund', 'commerce.payment_allocation',
    'integration.outbox_event', 'integration.inbound_event', 'integration.external_reference',
    'privacy.retention_policy', 'privacy.processing_purpose', 'privacy.consent_record', 'privacy.data_subject_request'
  ] LOOP
    EXECUTE format('CREATE POLICY worker_system ON %s TO pyth_worker USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- org
-- ---------------------------------------------------------------------------
GRANT SELECT ON org.education_group, org.legal_entity, org.school, org.website, org.website_school, org.website_domain
  TO pyth_api, pyth_worker;
GRANT UPDATE (name, default_time_zone, default_currency, default_locale) ON org.education_group TO pyth_api;
GRANT INSERT (id, group_id, legal_name, country_code, registration_number, vat_number, registered_address, payment_provider_account, status),
      UPDATE (legal_name, country_code, registration_number, vat_number, registered_address, payment_provider_account, status)
  ON org.legal_entity TO pyth_api;
GRANT INSERT (id, group_id, code, name, kind, time_zone, default_locale, default_billing_entity_id, status),
      UPDATE (code, name, kind, time_zone, default_locale, default_billing_entity_id, status)
  ON org.school TO pyth_api;
GRANT INSERT (id, group_id, code, name, purpose, default_locale, cms_tenant_key, status),
      UPDATE (code, name, purpose, default_locale, cms_tenant_key, status)
  ON org.website TO pyth_api;
GRANT INSERT, DELETE, UPDATE (is_primary_website_for_school) ON org.website_school TO pyth_api;
GRANT INSERT (id, website_id, group_id, hostname, is_primary, verification_method, verification_token, status, verified_at),
      UPDATE (is_primary, status, verified_at, last_checked_at, verification_token),
      DELETE
  ON org.website_domain TO pyth_api;
GRANT UPDATE (status, verified_at, last_checked_at) ON org.website_domain TO pyth_worker;

-- Group, legal entities, active schools and live websites are public information.
CREATE POLICY read_public ON org.education_group FOR SELECT TO pyth_api USING (true);
CREATE POLICY manage ON org.education_group FOR UPDATE TO pyth_api
  USING (id = access.current_group_id() AND access.has_permission('org.manage'))
  WITH CHECK (id = access.current_group_id() AND access.has_permission('org.manage'));

CREATE POLICY read_public ON org.legal_entity FOR SELECT TO pyth_api USING (true);
CREATE POLICY manage_insert ON org.legal_entity FOR INSERT TO pyth_api
  WITH CHECK (group_id = access.current_group_id() AND access.has_permission('org.manage'));
CREATE POLICY manage_update ON org.legal_entity FOR UPDATE TO pyth_api
  USING (group_id = access.current_group_id() AND access.has_permission('org.manage'))
  WITH CHECK (group_id = access.current_group_id() AND access.has_permission('org.manage'));

CREATE POLICY read_public ON org.school FOR SELECT TO pyth_api
  USING (status <> 'draft' OR access.has_permission('org.manage'));
CREATE POLICY manage_insert ON org.school FOR INSERT TO pyth_api
  WITH CHECK (group_id = access.current_group_id() AND access.has_permission('org.manage'));
CREATE POLICY manage_update ON org.school FOR UPDATE TO pyth_api
  USING (group_id = access.current_group_id() AND access.has_permission('org.manage'))
  WITH CHECK (group_id = access.current_group_id() AND access.has_permission('org.manage'));

CREATE POLICY read_public ON org.website FOR SELECT TO pyth_api
  USING (status = 'live' OR access.has_permission('org.manage'));
CREATE POLICY manage_insert ON org.website FOR INSERT TO pyth_api
  WITH CHECK (group_id = access.current_group_id() AND access.has_permission('org.manage'));
CREATE POLICY manage_update ON org.website FOR UPDATE TO pyth_api
  USING (group_id = access.current_group_id() AND access.has_permission('org.manage'))
  WITH CHECK (group_id = access.current_group_id() AND access.has_permission('org.manage'));

CREATE POLICY read_public ON org.website_school FOR SELECT TO pyth_api
  USING (EXISTS (SELECT 1 FROM org.website w WHERE w.id = website_id));
CREATE POLICY manage ON org.website_school FOR ALL TO pyth_api
  USING (group_id = access.current_group_id() AND access.has_permission('org.manage'))
  WITH CHECK (group_id = access.current_group_id() AND access.has_permission('org.manage'));

-- Domains and verification tokens are configuration, visible to administrators.
-- Only local development domains can be marked verified by the API; real
-- domains are verified by the worker after a DNS or HTTP check.
CREATE POLICY manage_read ON org.website_domain FOR SELECT TO pyth_api
  USING (access.has_permission('org.manage'));
CREATE POLICY manage_insert ON org.website_domain FOR INSERT TO pyth_api
  WITH CHECK (group_id = access.current_group_id() AND access.has_permission('org.manage')
              AND (status <> 'verified' OR verification_method = 'local_development'));
CREATE POLICY manage_update ON org.website_domain FOR UPDATE TO pyth_api
  USING (group_id = access.current_group_id() AND access.has_permission('org.manage'))
  WITH CHECK (group_id = access.current_group_id() AND access.has_permission('org.manage')
              AND (status <> 'verified' OR verification_method = 'local_development'));
CREATE POLICY manage_delete ON org.website_domain FOR DELETE TO pyth_api
  USING (group_id = access.current_group_id() AND access.has_permission('org.manage'));

-- ---------------------------------------------------------------------------
-- people
-- ---------------------------------------------------------------------------
GRANT SELECT ON people.person, people.login_identity, people.guardian_relationship, people.enrolment TO pyth_api, pyth_worker;
GRANT INSERT (id, group_id, given_name, family_name, preferred_name, date_of_birth, email, phone, preferred_locale, registered_school_id),
      UPDATE (given_name, family_name, preferred_name, date_of_birth, email, phone, preferred_locale)
  ON people.person TO pyth_api;
GRANT UPDATE (status) ON people.person TO pyth_worker;
GRANT INSERT (id, person_id, group_id, provider, subject), UPDATE (last_login_at, disabled_at) ON people.login_identity TO pyth_api;
GRANT INSERT (id, person_id, group_id, provider, subject), UPDATE (last_login_at, disabled_at) ON people.login_identity TO pyth_worker;
GRANT INSERT (id, group_id, guardian_person_id, student_person_id, relationship, can_view, can_pay, can_manage_bookings, can_consent,
              status, verified_by_person_id, verified_at, valid_from, valid_until),
      UPDATE (relationship, can_view, can_pay, can_manage_bookings, can_consent, status, verified_by_person_id, verified_at,
              valid_from, valid_until, revoked_at, revoked_by_person_id, revocation_reason)
  ON people.guardian_relationship TO pyth_api;
GRANT INSERT (id, group_id, student_person_id, school_id, academic_year, grade_level, class_label, status, start_date, end_date),
      UPDATE (academic_year, grade_level, class_label, status, start_date, end_date, withdrawn_at, withdrawal_reason)
  ON people.enrolment TO pyth_api;

-- The inline registered_school_id check lets staff read back a person they have
-- just registered (INSERT ... RETURNING), before helper queries can see the row.
CREATE POLICY read ON people.person FOR SELECT TO pyth_api
  USING (access.can_read_person(id)
         OR (registered_school_id IS NOT NULL AND access.has_permission('people.read', registered_school_id)));
CREATE POLICY register ON people.person FOR INSERT TO pyth_api
  WITH CHECK (group_id = access.current_group_id() AND access.has_permission('people.manage', registered_school_id));
CREATE POLICY update_self_or_managed ON people.person FOR UPDATE TO pyth_api
  USING (id = app.current_person_id() OR access.has_permission_for_person('people.manage', id))
  WITH CHECK (id = app.current_person_id() OR access.has_permission_for_person('people.manage', id));

CREATE POLICY read_own_or_admin ON people.login_identity FOR SELECT TO pyth_api
  USING (person_id = app.current_person_id() OR access.has_permission('access.manage'));
CREATE POLICY admin_insert ON people.login_identity FOR INSERT TO pyth_api
  WITH CHECK (group_id = access.current_group_id() AND access.has_permission('access.manage'));
CREATE POLICY own_or_admin_update ON people.login_identity FOR UPDATE TO pyth_api
  USING (person_id = app.current_person_id() OR access.has_permission('access.manage'))
  WITH CHECK (person_id = app.current_person_id() OR access.has_permission('access.manage'));

-- Guardians see their own relationships only. Staff verify and manage them;
-- a guardian can never create or widen their own access.
CREATE POLICY read ON people.guardian_relationship FOR SELECT TO pyth_api
  USING (guardian_person_id = app.current_person_id() OR access.has_permission_for_person('people.read', student_person_id));
CREATE POLICY staff_insert ON people.guardian_relationship FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission_for_person('guardians.manage', student_person_id)
              AND guardian_person_id <> app.current_person_id()
              AND (status = 'pending' OR (status = 'active' AND verified_by_person_id = app.current_person_id())));
CREATE POLICY staff_update ON people.guardian_relationship FOR UPDATE TO pyth_api
  USING (access.has_permission_for_person('guardians.manage', student_person_id))
  WITH CHECK (access.has_permission_for_person('guardians.manage', student_person_id)
              AND guardian_person_id <> app.current_person_id());

CREATE POLICY read ON people.enrolment FOR SELECT TO pyth_api
  USING (access.is_guardian_of(student_person_id, 'view') OR access.has_permission('enrolment.read', school_id));
CREATE POLICY manage_insert ON people.enrolment FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('enrolment.manage', school_id));
CREATE POLICY manage_update ON people.enrolment FOR UPDATE TO pyth_api
  USING (access.has_permission('enrolment.manage', school_id))
  WITH CHECK (access.has_permission('enrolment.manage', school_id));

-- ---------------------------------------------------------------------------
-- access
-- ---------------------------------------------------------------------------
GRANT SELECT ON access.permission, access.role, access.role_permission, access.role_assignment TO pyth_api, pyth_worker;
GRANT INSERT (id, group_id, person_id, role_code, school_id, valid_from, valid_until, granted_by_person_id),
      UPDATE (valid_until, revoked_at, revoked_by_person_id)
  ON access.role_assignment TO pyth_api;

CREATE POLICY read_reference ON access.permission FOR SELECT TO pyth_api USING (true);
CREATE POLICY read_reference ON access.role FOR SELECT TO pyth_api USING (true);
CREATE POLICY read_reference ON access.role_permission FOR SELECT TO pyth_api USING (true);

-- Roles can be granted only within the granter's own scope, never to oneself.
CREATE POLICY read ON access.role_assignment FOR SELECT TO pyth_api
  USING (person_id = app.current_person_id() OR access.has_permission('access.manage', school_id));
CREATE POLICY grant_in_scope ON access.role_assignment FOR INSERT TO pyth_api
  WITH CHECK (group_id = access.current_group_id()
              AND access.has_permission('access.manage', school_id)
              AND person_id <> app.current_person_id()
              AND granted_by_person_id = app.current_person_id());
CREATE POLICY revoke_in_scope ON access.role_assignment FOR UPDATE TO pyth_api
  USING (access.has_permission('access.manage', school_id))
  WITH CHECK (access.has_permission('access.manage', school_id) AND person_id <> app.current_person_id());

-- ---------------------------------------------------------------------------
-- catalog
-- ---------------------------------------------------------------------------
GRANT SELECT ON catalog.service_definition, catalog.school_offering, catalog.policy_version, catalog.price_version TO pyth_api, pyth_worker;
GRANT INSERT (id, group_id, code, kind, name, description, status), UPDATE (name, description, status)
  ON catalog.service_definition TO pyth_api;
GRANT INSERT (id, group_id, school_id, service_definition_id, billing_entity_id, code, name, description, status, capacity_mode,
              eligibility, booking_opens_at, booking_closes_at),
      UPDATE (billing_entity_id, name, description, status, capacity_mode, eligibility, booking_opens_at, booking_closes_at)
  ON catalog.school_offering TO pyth_api;
GRANT INSERT (id, group_id, offering_id, kind, version, rules, terms_text, valid_from, valid_until, created_by_person_id),
      UPDATE (valid_until)
  ON catalog.policy_version TO pyth_api;
GRANT INSERT (id, group_id, offering_id, version, label, currency, unit_amount_minor, vat_rate_bp, price_unit, package_size,
              valid_from, valid_until, created_by_person_id),
      UPDATE (valid_until)
  ON catalog.price_version TO pyth_api;

CREATE POLICY read_public ON catalog.service_definition FOR SELECT TO pyth_api USING (true);
CREATE POLICY manage_insert ON catalog.service_definition FOR INSERT TO pyth_api
  WITH CHECK (group_id = access.current_group_id() AND access.has_permission('catalog.manage'));
CREATE POLICY manage_update ON catalog.service_definition FOR UPDATE TO pyth_api
  USING (group_id = access.current_group_id() AND access.has_permission('catalog.manage'))
  WITH CHECK (group_id = access.current_group_id() AND access.has_permission('catalog.manage'));

CREATE POLICY read ON catalog.school_offering FOR SELECT TO pyth_api
  USING (status = 'published' OR access.has_permission('catalog.read', school_id));
CREATE POLICY manage_insert ON catalog.school_offering FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('catalog.manage', school_id));
CREATE POLICY manage_update ON catalog.school_offering FOR UPDATE TO pyth_api
  USING (access.has_permission('catalog.manage', school_id))
  WITH CHECK (access.has_permission('catalog.manage', school_id));

CREATE POLICY read ON catalog.policy_version FOR SELECT TO pyth_api
  USING (catalog.offering_is_published(offering_id) OR access.has_permission('catalog.read', catalog.offering_school_id(offering_id)));
CREATE POLICY manage_insert ON catalog.policy_version FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('catalog.manage', catalog.offering_school_id(offering_id)));
CREATE POLICY manage_update ON catalog.policy_version FOR UPDATE TO pyth_api
  USING (access.has_permission('catalog.manage', catalog.offering_school_id(offering_id)))
  WITH CHECK (access.has_permission('catalog.manage', catalog.offering_school_id(offering_id)));

CREATE POLICY read ON catalog.price_version FOR SELECT TO pyth_api
  USING (catalog.offering_is_published(offering_id) OR access.has_permission('catalog.read', catalog.offering_school_id(offering_id)));
CREATE POLICY manage_insert ON catalog.price_version FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('catalog.manage', catalog.offering_school_id(offering_id)));
CREATE POLICY manage_update ON catalog.price_version FOR UPDATE TO pyth_api
  USING (access.has_permission('catalog.manage', catalog.offering_school_id(offering_id)))
  WITH CHECK (access.has_permission('catalog.manage', catalog.offering_school_id(offering_id)));

-- ---------------------------------------------------------------------------
-- scheduling
-- ---------------------------------------------------------------------------
GRANT SELECT ON scheduling.session, scheduling.booking TO pyth_api, pyth_worker;
GRANT INSERT (id, group_id, school_id, offering_id, service_date, starts_at, ends_at, location_label, capacity,
              booking_cutoff_at, cancellation_cutoff_at, status),
      UPDATE (service_date, starts_at, ends_at, location_label, capacity, booking_cutoff_at, cancellation_cutoff_at, status)
  ON scheduling.session TO pyth_api;
GRANT INSERT (id, group_id, school_id, session_id, student_person_id, order_line_id, status, reserved_until, created_by_person_id),
      UPDATE (status, reserved_until, confirmed_at, cancelled_at, cancelled_by_person_id, cancellation_reason)
  ON scheduling.booking TO pyth_api;
GRANT UPDATE (status, reserved_until, confirmed_at, cancelled_at, cancelled_by_person_id, cancellation_reason)
  ON scheduling.booking TO pyth_worker;

CREATE POLICY read ON scheduling.session FOR SELECT TO pyth_api
  USING (access.has_permission('catalog.read', school_id) OR access.has_permission('bookings.read', school_id)
         OR (status = 'scheduled' AND catalog.offering_is_published(offering_id)));
CREATE POLICY manage_insert ON scheduling.session FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('catalog.manage', school_id));
CREATE POLICY manage_update ON scheduling.session FOR UPDATE TO pyth_api
  USING (access.has_permission('catalog.manage', school_id))
  WITH CHECK (access.has_permission('catalog.manage', school_id));

-- Guardians reserve and cancel for their children; only staff or the worker
-- confirm, register attendance or override.
CREATE POLICY read ON scheduling.booking FOR SELECT TO pyth_api
  USING (access.is_guardian_of(student_person_id, 'view') OR access.has_permission('bookings.read', school_id));
CREATE POLICY reserve ON scheduling.booking FOR INSERT TO pyth_api
  WITH CHECK ((access.is_guardian_of(student_person_id, 'manage_bookings') AND status = 'reserved'
               AND created_by_person_id = app.current_person_id())
              OR access.has_permission('bookings.manage', school_id));
CREATE POLICY change ON scheduling.booking FOR UPDATE TO pyth_api
  USING (access.is_guardian_of(student_person_id, 'manage_bookings') OR access.has_permission('bookings.manage', school_id))
  WITH CHECK ((access.is_guardian_of(student_person_id, 'manage_bookings') AND status IN ('reserved', 'cancelled'))
              OR access.has_permission('bookings.manage', school_id));

-- ---------------------------------------------------------------------------
-- commerce
-- ---------------------------------------------------------------------------
GRANT SELECT ON commerce.customer_order, commerce.order_line, commerce.payment, commerce.account_credit,
                commerce.credit_application, commerce.refund, commerce.payment_allocation
  TO pyth_api, pyth_worker;
GRANT USAGE ON SEQUENCE commerce.order_number_seq TO pyth_api;
GRANT INSERT (id, group_id, billing_entity_id, payer_person_id, checkout_group_id, origin, currency, total_minor, status,
              due_date, expires_at, placed_at, idempotency_key, created_by_person_id),
      UPDATE (status, total_minor, due_date, expires_at, placed_at, cancelled_at)
  ON commerce.customer_order TO pyth_api;
GRANT UPDATE (status, paid_at, cancelled_at, expires_at) ON commerce.customer_order TO pyth_worker;
GRANT INSERT (id, group_id, order_id, billing_entity_id, line_no, school_id, offering_id, session_id, student_person_id,
              price_version_id, policy_version_id, description, service_date, quantity, currency, unit_amount_minor,
              vat_rate_bp, line_total_minor),
      UPDATE (status), DELETE
  ON commerce.order_line TO pyth_api;
GRANT UPDATE (status) ON commerce.order_line TO pyth_worker;
GRANT INSERT (id, group_id, order_id, billing_entity_id, provider, provider_mode, provider_checkout_id, amount_minor, currency, status),
      UPDATE (provider_checkout_id, status)
  ON commerce.payment TO pyth_api;
GRANT INSERT, UPDATE (provider_payment_id, provider_checkout_id, status, provider_status, provider_status_at, failure_code, succeeded_at)
  ON commerce.payment TO pyth_worker;
GRANT INSERT, UPDATE (remaining_amount_minor, status) ON commerce.account_credit TO pyth_worker;
GRANT INSERT (id, group_id, credit_id, order_id, billing_entity_id, amount_minor) ON commerce.credit_application TO pyth_api;
GRANT INSERT ON commerce.credit_application TO pyth_worker;
GRANT INSERT (id, group_id, payment_id, billing_entity_id, order_line_id, amount_minor, currency, method, reason, requested_by_person_id, status),
      UPDATE (status, approved_by_person_id, approved_at)
  ON commerce.refund TO pyth_api;
GRANT UPDATE (status, provider_refund_id) ON commerce.refund TO pyth_worker;
GRANT INSERT ON commerce.payment_allocation TO pyth_worker;

CREATE POLICY read ON commerce.customer_order FOR SELECT TO pyth_api
  USING (payer_person_id = app.current_person_id() OR commerce.has_order_permission(id, 'finance.read'));
-- Parents create their own checkout orders; finance staff create invoices.
CREATE POLICY open_order ON commerce.customer_order FOR INSERT TO pyth_api
  WITH CHECK (group_id = access.current_group_id() AND status = 'draft' AND created_by_person_id = app.current_person_id()
              AND ((origin = 'family_portal' AND payer_person_id = app.current_person_id())
                   OR (origin = 'staff_invoice' AND access.has_permission_anywhere('finance.manage'))));
-- The API may place or cancel orders; only the worker marks them paid, expired or refunded.
CREATE POLICY place_or_cancel ON commerce.customer_order FOR UPDATE TO pyth_api
  USING (payer_person_id = app.current_person_id() OR commerce.has_order_permission(id, 'finance.manage'))
  WITH CHECK (status IN ('draft', 'pending_payment', 'cancelled')
              AND (payer_person_id = app.current_person_id() OR commerce.has_order_permission(id, 'finance.manage')));

CREATE POLICY read ON commerce.order_line FOR SELECT TO pyth_api
  USING (commerce.can_read_order(order_id) OR access.has_permission('bookings.read', school_id));
-- A parent may only order for a child they are authorised to pay for.
CREATE POLICY add ON commerce.order_line FOR INSERT TO pyth_api
  WITH CHECK ((commerce.is_order_payer(order_id)
               AND (student_person_id IS NULL OR access.is_guardian_of(student_person_id, 'pay')))
              OR access.has_permission('finance.manage', school_id));
CREATE POLICY change ON commerce.order_line FOR UPDATE TO pyth_api
  USING (commerce.is_order_payer(order_id) OR access.has_permission('finance.manage', school_id)
         OR access.has_permission('bookings.manage', school_id))
  WITH CHECK (commerce.is_order_payer(order_id) OR access.has_permission('finance.manage', school_id)
              OR access.has_permission('bookings.manage', school_id));
CREATE POLICY remove ON commerce.order_line FOR DELETE TO pyth_api
  USING (commerce.is_order_payer(order_id) OR access.has_permission('finance.manage', school_id));

CREATE POLICY read ON commerce.payment FOR SELECT TO pyth_api USING (commerce.can_read_order(order_id));
-- The API records the start of a checkout; success comes only from the worker
-- after a verified provider event.
CREATE POLICY start_checkout ON commerce.payment FOR INSERT TO pyth_api
  WITH CHECK (status = 'created' AND (commerce.is_order_payer(order_id) OR commerce.has_order_permission(order_id, 'finance.manage')));
CREATE POLICY track_checkout ON commerce.payment FOR UPDATE TO pyth_api
  USING (commerce.is_order_payer(order_id) OR commerce.has_order_permission(order_id, 'finance.manage'))
  WITH CHECK (status IN ('created', 'pending', 'cancelled'));

CREATE POLICY read ON commerce.account_credit FOR SELECT TO pyth_api
  USING (holder_person_id = app.current_person_id() OR access.has_permission('finance.read')
         OR (source_order_line_id IS NOT NULL
             AND commerce.has_order_permission(commerce.line_order_id(source_order_line_id), 'finance.read')));

CREATE POLICY read ON commerce.credit_application FOR SELECT TO pyth_api USING (commerce.can_read_order(order_id));
CREATE POLICY apply_own ON commerce.credit_application FOR INSERT TO pyth_api
  WITH CHECK (commerce.is_order_payer(order_id)
              AND EXISTS (SELECT 1 FROM commerce.account_credit c WHERE c.id = credit_id AND c.holder_person_id = app.current_person_id()));

CREATE POLICY read ON commerce.refund FOR SELECT TO pyth_api
  USING (commerce.can_read_order(commerce.payment_order_id(payment_id)));
CREATE POLICY request ON commerce.refund FOR INSERT TO pyth_api
  WITH CHECK (status = 'requested' AND requested_by_person_id = app.current_person_id()
              AND (commerce.has_order_permission(commerce.payment_order_id(payment_id), 'finance.manage')
                   OR commerce.has_order_permission(commerce.payment_order_id(payment_id), 'bookings.manage')));
-- Four eyes: the approver cannot be the requester.
CREATE POLICY decide ON commerce.refund FOR UPDATE TO pyth_api
  USING (access.has_permission('refunds.approve') AND requested_by_person_id IS DISTINCT FROM app.current_person_id())
  WITH CHECK (status IN ('approved', 'rejected') AND approved_by_person_id = app.current_person_id()
              AND requested_by_person_id IS DISTINCT FROM app.current_person_id());

CREATE POLICY read ON commerce.payment_allocation FOR SELECT TO pyth_api
  USING (access.has_permission('finance.read', school_id) OR commerce.is_order_payer(commerce.line_order_id(order_line_id)));

-- ---------------------------------------------------------------------------
-- integration: the API only appends; the worker reads and processes.
-- ---------------------------------------------------------------------------
GRANT INSERT (group_id, aggregate_type, aggregate_id, event_type, payload, available_at) ON integration.outbox_event TO pyth_api;
GRANT SELECT, INSERT (group_id, aggregate_type, aggregate_id, event_type, payload, available_at),
      UPDATE (published_at, attempts, last_error, available_at)
  ON integration.outbox_event TO pyth_worker;
GRANT INSERT, SELECT, UPDATE (processing_status, attempts, processed_at, last_error) ON integration.inbound_event TO pyth_worker;
GRANT INSERT (provider, provider_mode, provider_event_id, event_type, provider_created_at, signature_verified, payload)
  ON integration.inbound_event TO pyth_api;
GRANT SELECT, INSERT, DELETE ON integration.external_reference TO pyth_worker;

CREATE POLICY append ON integration.outbox_event FOR INSERT TO pyth_api WITH CHECK (true);
CREATE POLICY receive ON integration.inbound_event FOR INSERT TO pyth_api WITH CHECK (processing_status = 'received');

-- ---------------------------------------------------------------------------
-- privacy
-- ---------------------------------------------------------------------------
GRANT SELECT ON privacy.retention_policy, privacy.processing_purpose, privacy.consent_record, privacy.data_subject_request
  TO pyth_api, pyth_worker;
GRANT INSERT (id, group_id, code, description, applies_to, retain_for, after_action, legal_basis_note, status),
      UPDATE (description, applies_to, retain_for, after_action, legal_basis_note, status, approved_by_person_id, approved_at)
  ON privacy.retention_policy TO pyth_api;
GRANT INSERT (id, group_id, code, name, description, lawful_basis, special_category, art9_condition, retention_policy_id, status),
      UPDATE (name, description, lawful_basis, special_category, art9_condition, retention_policy_id, status,
              approved_by_person_id, approved_at)
  ON privacy.processing_purpose TO pyth_api;
GRANT INSERT (id, group_id, subject_person_id, given_by_person_id, purpose_id, school_id, wording_version, channel,
              recorded_by_person_id, given_at),
      UPDATE (status, withdrawn_at, withdrawn_by_person_id)
  ON privacy.consent_record TO pyth_api;
GRANT INSERT (id, group_id, subject_person_id, requester_person_id, kind),
      UPDATE (status, extended_due_at, extension_reason, completed_at, outcome_note, handled_by_person_id)
  ON privacy.data_subject_request TO pyth_api;
GRANT UPDATE (status, completed_at, outcome_note) ON privacy.data_subject_request TO pyth_worker;

-- Approved purposes are the privacy notice; everyone in the group may read them.
CREATE POLICY read ON privacy.processing_purpose FOR SELECT TO pyth_api
  USING (status = 'approved' OR access.has_permission('privacy.read'));
CREATE POLICY manage ON privacy.processing_purpose FOR ALL TO pyth_api
  USING (access.has_permission('privacy.manage'))
  WITH CHECK (group_id = access.current_group_id() AND access.has_permission('privacy.manage')
              AND (status <> 'approved' OR approved_by_person_id = app.current_person_id()));
CREATE POLICY read ON privacy.retention_policy FOR SELECT TO pyth_api
  USING (status = 'approved' OR access.has_permission('privacy.read'));
CREATE POLICY manage ON privacy.retention_policy FOR ALL TO pyth_api
  USING (access.has_permission('privacy.manage'))
  WITH CHECK (group_id = access.current_group_id() AND access.has_permission('privacy.manage')
              AND (status <> 'approved' OR approved_by_person_id = app.current_person_id()));

CREATE POLICY read ON privacy.consent_record FOR SELECT TO pyth_api
  USING (subject_person_id = app.current_person_id() OR given_by_person_id = app.current_person_id()
         OR access.is_guardian_of(subject_person_id, 'view') OR access.has_permission('privacy.read')
         OR access.has_permission_for_person('consent.manage', subject_person_id));
CREATE POLICY give ON privacy.consent_record FOR INSERT TO pyth_api
  WITH CHECK ((channel = 'family_portal' AND given_by_person_id = app.current_person_id()
               AND (subject_person_id = app.current_person_id() OR access.is_guardian_of(subject_person_id, 'consent')))
              OR (channel IN ('paper', 'in_person') AND recorded_by_person_id = app.current_person_id()
                  AND access.has_permission_for_person('consent.manage', subject_person_id)));
CREATE POLICY withdraw ON privacy.consent_record FOR UPDATE TO pyth_api
  USING (subject_person_id = app.current_person_id() OR given_by_person_id = app.current_person_id()
         OR access.is_guardian_of(subject_person_id, 'consent') OR access.has_permission_for_person('consent.manage', subject_person_id))
  WITH CHECK (status = 'withdrawn' AND withdrawn_by_person_id = app.current_person_id());

CREATE POLICY read ON privacy.data_subject_request FOR SELECT TO pyth_api
  USING (requester_person_id = app.current_person_id() OR subject_person_id = app.current_person_id()
         OR access.has_permission('privacy.read'));
CREATE POLICY submit ON privacy.data_subject_request FOR INSERT TO pyth_api
  WITH CHECK (group_id = access.current_group_id()
              AND ((requester_person_id = app.current_person_id()
                    AND (subject_person_id = app.current_person_id() OR access.is_guardian_of(subject_person_id, 'consent')))
                   OR access.has_permission('privacy.manage')));
CREATE POLICY handle ON privacy.data_subject_request FOR UPDATE TO pyth_api
  USING (access.has_permission('privacy.manage'))
  WITH CHECK (access.has_permission('privacy.manage'));

-- ---------------------------------------------------------------------------
-- sensitive: guardians and staff with the dietary permission at the student's
-- school. Not the CEO, not the worker.
-- ---------------------------------------------------------------------------
GRANT SELECT,
      INSERT (id, group_id, student_person_id, kind, description, severity, provided_by_person_id, verified_by_person_id, valid_from, valid_until),
      UPDATE (kind, description, severity, verified_by_person_id, valid_from, valid_until),
      DELETE
  ON sensitive.dietary_requirement TO pyth_api;

CREATE POLICY read ON sensitive.dietary_requirement FOR SELECT TO pyth_api
  USING (access.is_guardian_of(student_person_id, 'view')
         OR access.has_permission_for_person('sensitive.dietary.read', student_person_id));
CREATE POLICY provide ON sensitive.dietary_requirement FOR INSERT TO pyth_api
  WITH CHECK ((access.is_guardian_of(student_person_id, 'manage_bookings') AND provided_by_person_id = app.current_person_id())
              OR access.has_permission_for_person('sensitive.dietary.manage', student_person_id));
CREATE POLICY change ON sensitive.dietary_requirement FOR UPDATE TO pyth_api
  USING (access.is_guardian_of(student_person_id, 'manage_bookings')
         OR access.has_permission_for_person('sensitive.dietary.manage', student_person_id))
  WITH CHECK (access.is_guardian_of(student_person_id, 'manage_bookings')
              OR access.has_permission_for_person('sensitive.dietary.manage', student_person_id));
CREATE POLICY remove ON sensitive.dietary_requirement FOR DELETE TO pyth_api
  USING (access.has_permission_for_person('sensitive.dietary.manage', student_person_id));

-- ---------------------------------------------------------------------------
-- audit: written by triggers; the API appends access-log rows; reading needs audit.read.
-- ---------------------------------------------------------------------------
GRANT SELECT ON audit.change_log, audit.access_log TO pyth_api;
GRANT INSERT (actor_person_id, action, resource, subject_person_id, school_id, record_count, request_id) ON audit.access_log TO pyth_api;

CREATE POLICY read ON audit.change_log FOR SELECT TO pyth_api USING (access.has_permission('audit.read'));
CREATE POLICY read ON audit.access_log FOR SELECT TO pyth_api USING (access.has_permission('audit.read'));
CREATE POLICY append_own ON audit.access_log FOR INSERT TO pyth_api WITH CHECK (actor_person_id = app.current_person_id());

-- ---------------------------------------------------------------------------
-- reporting: views run with the caller's rights, so RLS applies to them.
-- ---------------------------------------------------------------------------
CREATE VIEW reporting.school_revenue_daily WITH (security_invoker = true) AS
SELECT a.group_id,
       a.school_id,
       a.billing_entity_id,
       (a.allocated_at AT TIME ZONE s.time_zone)::date AS local_date,
       a.currency,
       coalesce(sum(a.amount_minor) FILTER (WHERE a.kind = 'payment'), 0)         AS received_minor,
       coalesce(sum(a.amount_minor) FILTER (WHERE a.kind = 'credit_applied'), 0)  AS paid_by_credit_minor,
       coalesce(-sum(a.amount_minor) FILTER (WHERE a.kind = 'refund'), 0)         AS refunded_minor,
       coalesce(-sum(a.amount_minor) FILTER (WHERE a.kind = 'credit_issued'), 0)  AS credited_minor,
       sum(a.amount_minor)                                                        AS net_minor
FROM commerce.payment_allocation a
JOIN org.school s ON s.id = a.school_id
GROUP BY a.group_id, a.school_id, a.billing_entity_id, (a.allocated_at AT TIME ZONE s.time_zone)::date, a.currency;
COMMENT ON VIEW reporting.school_revenue_daily IS 'Money allocated to each school per local day. net = received + paid by credit - refunded - credited.';

-- What is still owed on placed orders, per school: line totals minus what has
-- been allocated to the line from payments and applied credit.
CREATE VIEW reporting.outstanding_balance WITH (security_invoker = true) AS
WITH line_balance AS (
  SELECT o.group_id, l.school_id, o.billing_entity_id, o.currency, o.origin, o.id AS order_id, o.due_date,
         l.line_total_minor - coalesce((SELECT sum(a.amount_minor) FROM commerce.payment_allocation a
                                        WHERE a.order_line_id = l.id AND a.kind IN ('payment', 'credit_applied')), 0) AS open_minor
  FROM commerce.customer_order o
  JOIN commerce.order_line l ON l.order_id = o.id
  WHERE o.status = 'pending_payment' AND l.status <> 'cancelled'
)
SELECT b.group_id, b.school_id, b.billing_entity_id, b.currency,
       count(DISTINCT b.order_id) FILTER (WHERE b.origin = 'staff_invoice')                AS open_invoices,
       coalesce(sum(b.open_minor) FILTER (WHERE b.origin = 'staff_invoice'), 0)            AS outstanding_minor,
       coalesce(sum(b.open_minor) FILTER (WHERE b.origin = 'staff_invoice'
                                          AND b.due_date < (now() AT TIME ZONE s.time_zone)::date), 0) AS overdue_minor,
       coalesce(sum(b.open_minor) FILTER (WHERE b.origin = 'family_portal'), 0)            AS checkout_in_progress_minor
FROM line_balance b
JOIN org.school s ON s.id = b.school_id
GROUP BY b.group_id, b.school_id, b.billing_entity_id, b.currency;
COMMENT ON VIEW reporting.outstanding_balance IS 'Owed on placed staff invoices per school; family checkouts in progress shown separately.';

GRANT USAGE ON SCHEMA reporting TO pyth_api;
GRANT SELECT ON reporting.school_revenue_daily, reporting.outstanding_balance TO pyth_api;

-- migrate:down
DROP VIEW reporting.outstanding_balance;
DROP VIEW reporting.school_revenue_daily;

DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE schemaname IN ('audit', 'org', 'people', 'access', 'catalog', 'scheduling', 'commerce', 'integration', 'privacy', 'sensitive')
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
  FOR p IN
    SELECT n.nspname AS schemaname, c.relname AS tablename, NULL AS policyname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND c.relrowsecurity
      AND n.nspname IN ('audit', 'org', 'people', 'access', 'catalog', 'scheduling', 'commerce', 'integration', 'privacy', 'sensitive')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DISABLE ROW LEVEL SECURITY', p.schemaname, p.tablename);
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA audit, org, people, access, catalog, scheduling, commerce, integration, privacy, sensitive, reporting
  FROM pyth_api, pyth_worker;
REVOKE ALL ON SEQUENCE commerce.order_number_seq FROM pyth_api;

DROP FUNCTION integration.purge_inbound_payloads(interval);
DROP FUNCTION catalog.offering_is_published(uuid);
DROP FUNCTION catalog.offering_school_id(uuid);
DROP FUNCTION commerce.line_order_id(uuid);
DROP FUNCTION commerce.payment_order_id(uuid);
DROP FUNCTION commerce.can_read_order(uuid);
DROP FUNCTION commerce.has_order_permission(uuid, text);
DROP FUNCTION commerce.is_order_payer(uuid);
DROP FUNCTION access.current_group_id();
