-- migrate:up

-- The other half of the books. The portal already knows what families pay; this
-- adds what schools spend, what they planned to spend, and an invoice for each
-- paid order. Payroll stays in the accountants' own system.

CREATE SCHEMA finance;
REVOKE ALL ON SCHEMA finance FROM PUBLIC;
GRANT USAGE ON SCHEMA finance TO pyth_api;

CREATE TABLE finance.expense (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id      uuid NOT NULL,
  school_id     uuid NOT NULL,
  category      text NOT NULL CHECK (category IN ('materials', 'food', 'utilities', 'maintenance', 'transport', 'events', 'marketing', 'other')),
  description   text NOT NULL CHECK (length(description) BETWEEN 1 AND 300),
  supplier_id   uuid REFERENCES inventory.supplier (id),
  currency      char(3) NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  spent_on      date NOT NULL,
  recorded_by   uuid REFERENCES people.person (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id, group_id) REFERENCES org.school (id, group_id)
);
CREATE INDEX expense_school_idx ON finance.expense (school_id, spent_on);
CREATE INDEX expense_supplier_idx ON finance.expense (supplier_id);
CREATE INDEX expense_recorded_by_idx ON finance.expense (recorded_by);

CREATE TABLE finance.budget (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id       uuid NOT NULL,
  school_id      uuid NOT NULL,
  academic_year  text NOT NULL CHECK (academic_year ~ '^[0-9]{4}/[0-9]{4}$'),
  category       text NOT NULL CHECK (category IN ('materials', 'food', 'utilities', 'maintenance', 'transport', 'events', 'marketing', 'other')),
  amount_minor   bigint NOT NULL CHECK (amount_minor >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, academic_year, category),
  FOREIGN KEY (school_id, group_id) REFERENCES org.school (id, group_id)
);

-- What a school took in over a period, net of refunds, for those who may see its
-- finances. A function so that a principal sees the total and not each family's payments.
CREATE FUNCTION finance.school_income(p_school_id uuid, p_from date, p_to date)
RETURNS bigint
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce(sum(a.amount_minor), 0)::bigint
    FROM commerce.payment_allocation a
   WHERE a.school_id = p_school_id
     AND a.kind IN ('payment', 'refund')
     AND a.allocated_at >= p_from AND a.allocated_at < p_to
     AND access.has_permission('finance.read', p_school_id)
$$;
REVOKE ALL ON FUNCTION finance.school_income(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance.school_income(uuid, date, date) TO pyth_api;

-- An invoice for each paid order, numbered without gaps per company as the law asks.
CREATE TABLE finance.invoice (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id           uuid NOT NULL REFERENCES org.education_group (id),
  billing_entity_id  uuid NOT NULL,
  order_id           uuid NOT NULL UNIQUE,
  number             bigint NOT NULL CHECK (number > 0),
  issued_on          date NOT NULL,
  payer_person_id    uuid NOT NULL REFERENCES people.person (id),
  currency           char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  total_minor        bigint NOT NULL CHECK (total_minor >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (billing_entity_id, number),
  FOREIGN KEY (order_id, billing_entity_id) REFERENCES commerce.customer_order (id, billing_entity_id)
);
CREATE INDEX invoice_payer_idx ON finance.invoice (payer_person_id);

CREATE FUNCTION finance.issue_invoice(p_order_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  o commerce.customer_order%ROWTYPE;
  next_number bigint;
BEGIN
  SELECT * INTO o FROM commerce.customer_order WHERE id = p_order_id;
  -- The company's row is the lock that keeps the numbers without gaps.
  PERFORM 1 FROM org.legal_entity WHERE id = o.billing_entity_id FOR UPDATE;
  SELECT coalesce(max(number), 0) + 1 INTO next_number FROM finance.invoice WHERE billing_entity_id = o.billing_entity_id;
  INSERT INTO finance.invoice (group_id, billing_entity_id, order_id, number, issued_on, payer_person_id, currency, total_minor)
  VALUES (o.group_id, o.billing_entity_id, o.id, next_number, coalesce(o.paid_at, now())::date, o.payer_person_id, o.currency, o.total_minor)
  ON CONFLICT (order_id) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION finance.issue_invoice(uuid) FROM PUBLIC;

CREATE FUNCTION finance.invoice_paid_order() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM finance.issue_invoice(NEW.id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION finance.invoice_paid_order() FROM PUBLIC;
CREATE TRIGGER invoice_paid_order AFTER UPDATE OF status ON commerce.customer_order
  FOR EACH ROW WHEN (NEW.status = 'paid' AND OLD.status <> 'paid')
  EXECUTE FUNCTION finance.invoice_paid_order();

-- Orders already paid get theirs now, in the order they were paid.
DO $$
DECLARE
  paid uuid;
BEGIN
  FOR paid IN
    SELECT id FROM commerce.customer_order
     WHERE status IN ('paid', 'partially_refunded', 'refunded') ORDER BY paid_at, id
  LOOP
    PERFORM finance.issue_invoice(paid);
  END LOOP;
END $$;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON finance.budget FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON finance.expense FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON finance.budget  FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON finance.invoice FOR EACH ROW EXECUTE FUNCTION audit.log_change();

ALTER TABLE finance.expense ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.invoice ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT (id, group_id, school_id, category, description, supplier_id, currency, amount_minor, spent_on, recorded_by)
  ON finance.expense TO pyth_api;
GRANT SELECT, INSERT (id, group_id, school_id, academic_year, category, amount_minor), UPDATE (amount_minor)
  ON finance.budget TO pyth_api;
GRANT SELECT ON finance.invoice TO pyth_api;

CREATE POLICY read ON finance.expense FOR SELECT TO pyth_api USING (access.has_permission('finance.read', school_id));
CREATE POLICY manage_insert ON finance.expense FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('finance.manage', school_id));

CREATE POLICY read ON finance.budget FOR SELECT TO pyth_api USING (access.has_permission('finance.read', school_id));
CREATE POLICY manage_insert ON finance.budget FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('finance.manage', school_id));
CREATE POLICY manage_update ON finance.budget FOR UPDATE TO pyth_api
  USING (access.has_permission('finance.manage', school_id))
  WITH CHECK (access.has_permission('finance.manage', school_id));

-- The family that paid sees its invoices, and group finance sees them all.
CREATE POLICY read ON finance.invoice FOR SELECT TO pyth_api
  USING (payer_person_id = app.current_person_id()
         OR (group_id = access.current_group_id() AND access.has_permission('accounting.export', NULL)));

-- migrate:down
DROP TRIGGER invoice_paid_order ON commerce.customer_order;
DROP FUNCTION finance.invoice_paid_order();
DROP FUNCTION finance.issue_invoice(uuid);
DROP TABLE finance.invoice;
DROP FUNCTION finance.school_income(uuid, date, date);
DROP TABLE finance.budget;
DROP TABLE finance.expense;
DROP SCHEMA finance;
