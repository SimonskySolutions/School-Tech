-- migrate:up

-- Accounting export (M7.4): the ledger of one company for a period, entry by
-- entry, for the accountants. The platform's own documented layout
-- (docs/accounting-export.md) until the accountants confirm their software and
-- its import format. Group finance only; every export is in the access log.
-- No payer's name or address: each entry names its order number, which leads
-- to everything else for those allowed to look.

INSERT INTO access.permission (code, description) VALUES
  ('accounting.export', 'Export a company''s ledger for the accountants');
INSERT INTO access.role_permission (role_code, permission_code) VALUES ('group_finance', 'accounting.export');

CREATE FUNCTION commerce.accounting_entries(p_billing_entity_id uuid, p_from date, p_to date)
RETURNS TABLE (
  entry_id uuid, local_date date, entry text, payment_mode text, order_number text, school_code text,
  school_name text, service_code text, description text, service_date date, currency text, amount_minor bigint,
  payment_provider text, payment_reference text, refund_id uuid, credit_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF app.current_person_id() IS NULL OR NOT access.has_permission('accounting.export') THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM org.legal_entity e WHERE e.id = p_billing_entity_id AND e.group_id = access.current_group_id()) THEN
    RAISE EXCEPTION 'no such company' USING ERRCODE = 'P0002';
  END IF;
  IF p_to < p_from OR p_to > p_from + 366 THEN
    RAISE EXCEPTION 'a period of one day to a year' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT a.id, (a.allocated_at AT TIME ZONE s.time_zone)::date, a.kind,
           CASE WHEN EXISTS (SELECT 1 FROM commerce.payment p WHERE p.order_id = l.order_id AND p.provider_mode = 'test')
                THEN 'test' ELSE 'live' END,
           o.order_number, s.code, s.name, sd.code, l.description, l.service_date, a.currency::text, a.amount_minor,
           pay.provider, pay.provider_payment_id, a.refund_id, coalesce(a.credit_id, ca.credit_id)
      FROM commerce.payment_allocation a
      JOIN commerce.order_line l ON l.id = a.order_line_id
      JOIN commerce.customer_order o ON o.id = l.order_id
      JOIN org.school s ON s.id = a.school_id
      JOIN catalog.school_offering so ON so.id = l.offering_id
      JOIN catalog.service_definition sd ON sd.id = so.service_definition_id
      LEFT JOIN commerce.payment pay ON pay.id = coalesce(a.payment_id, (SELECT r.payment_id FROM commerce.refund r WHERE r.id = a.refund_id))
      LEFT JOIN commerce.credit_application ca ON ca.id = a.credit_application_id
     WHERE a.billing_entity_id = p_billing_entity_id
       AND (a.allocated_at AT TIME ZONE s.time_zone)::date BETWEEN p_from AND p_to
     ORDER BY a.allocated_at, a.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO audit.access_log (actor_person_id, action, resource, record_count, request_id)
  VALUES (app.current_person_id(), 'export', 'commerce.accounting_entries', v_count, app.current_request_id());
END $$;
REVOKE ALL ON FUNCTION commerce.accounting_entries(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION commerce.accounting_entries(uuid, date, date) TO pyth_api;

-- migrate:down
DROP FUNCTION commerce.accounting_entries(uuid, date, date);
DELETE FROM access.role_permission WHERE permission_code = 'accounting.export';
DELETE FROM access.permission WHERE code = 'accounting.export';
