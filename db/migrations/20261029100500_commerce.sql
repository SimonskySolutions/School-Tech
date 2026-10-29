-- migrate:up

CREATE SEQUENCE commerce.order_number_seq AS bigint START 1000;

-- An order belongs to exactly one billing entity (ADR 0008). A basket that
-- spans entities becomes several orders sharing a checkout_group_id.
CREATE TABLE commerce.customer_order (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id             uuid NOT NULL,
  order_number         text NOT NULL UNIQUE DEFAULT ('PY-' || lpad(nextval('commerce.order_number_seq')::text, 8, '0')),
  billing_entity_id    uuid NOT NULL,
  payer_person_id      uuid NOT NULL,
  checkout_group_id    uuid NOT NULL DEFAULT uuidv7(),
  origin               text NOT NULL CHECK (origin IN ('family_portal', 'staff_invoice')),
  currency             char(3) NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  total_minor          bigint NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  status               text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'pending_payment', 'paid', 'partially_refunded', 'refunded', 'cancelled', 'expired')),
  due_date             date,
  expires_at           timestamptz,
  placed_at            timestamptz,
  paid_at              timestamptz,
  cancelled_at         timestamptz,
  idempotency_key      text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  created_by_person_id uuid REFERENCES people.person (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payer_person_id, idempotency_key),
  UNIQUE (id, billing_entity_id),
  FOREIGN KEY (billing_entity_id, group_id) REFERENCES org.legal_entity (id, group_id),
  FOREIGN KEY (payer_person_id, group_id) REFERENCES people.person (id, group_id),
  CHECK (status <> 'paid' OR paid_at IS NOT NULL),
  CHECK (status <> 'pending_payment' OR placed_at IS NOT NULL)
);
CREATE INDEX customer_order_payer_idx ON commerce.customer_order (payer_person_id, created_at DESC);
CREATE INDEX customer_order_billing_entity_idx ON commerce.customer_order (billing_entity_id, status);
CREATE INDEX customer_order_checkout_group_idx ON commerce.customer_order (checkout_group_id);
CREATE INDEX customer_order_expiry_idx ON commerce.customer_order (expires_at) WHERE status = 'pending_payment';
CREATE INDEX customer_order_created_by_idx ON commerce.customer_order (created_by_person_id);

-- An order line copies the agreed price and terms at the moment of ordering.
CREATE TABLE commerce.order_line (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id           uuid NOT NULL REFERENCES org.education_group (id),
  order_id           uuid NOT NULL,
  billing_entity_id  uuid NOT NULL,
  line_no            integer NOT NULL CHECK (line_no > 0),
  school_id          uuid NOT NULL,
  offering_id        uuid NOT NULL,
  session_id         uuid,
  student_person_id  uuid,
  price_version_id   uuid NOT NULL,
  policy_version_id  uuid,
  description        text NOT NULL CHECK (length(description) BETWEEN 1 AND 300),
  service_date       date,
  quantity           integer NOT NULL CHECK (quantity > 0),
  currency           char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  unit_amount_minor  bigint NOT NULL CHECK (unit_amount_minor >= 0),
  vat_rate_bp        integer NOT NULL CHECK (vat_rate_bp BETWEEN 0 AND 10000),
  line_total_minor   bigint NOT NULL CHECK (line_total_minor >= 0),
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, line_no),
  UNIQUE (id, billing_entity_id, school_id),
  UNIQUE (id, school_id, student_person_id),
  CHECK (line_total_minor = unit_amount_minor * quantity),
  -- Same billing entity as the order, and as the offering being sold.
  FOREIGN KEY (order_id, billing_entity_id) REFERENCES commerce.customer_order (id, billing_entity_id),
  FOREIGN KEY (offering_id, billing_entity_id) REFERENCES catalog.school_offering (id, billing_entity_id),
  FOREIGN KEY (offering_id, school_id) REFERENCES catalog.school_offering (id, school_id),
  FOREIGN KEY (session_id, school_id) REFERENCES scheduling.session (id, school_id),
  FOREIGN KEY (price_version_id, offering_id) REFERENCES catalog.price_version (id, offering_id),
  FOREIGN KEY (policy_version_id, offering_id) REFERENCES catalog.policy_version (id, offering_id),
  FOREIGN KEY (student_person_id, group_id) REFERENCES people.person (id, group_id)
);
CREATE INDEX order_line_school_idx ON commerce.order_line (school_id, status);
CREATE INDEX order_line_offering_idx ON commerce.order_line (offering_id);
CREATE INDEX order_line_session_idx ON commerce.order_line (session_id);
CREATE INDEX order_line_student_idx ON commerce.order_line (student_person_id);
CREATE INDEX order_line_price_version_idx ON commerce.order_line (price_version_id);
CREATE INDEX order_line_policy_version_idx ON commerce.order_line (policy_version_id);
CREATE INDEX order_line_billing_entity_idx ON commerce.order_line (billing_entity_id);

ALTER TABLE scheduling.booking
  ADD FOREIGN KEY (order_line_id, school_id, student_person_id)
  REFERENCES commerce.order_line (id, school_id, student_person_id);

-- Lines are written while the order is a draft, at the current price, and are
-- frozen afterwards except for their status.
CREATE FUNCTION commerce.check_order_line() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  o commerce.customer_order%ROWTYPE;
  p catalog.price_version%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT * INTO o FROM commerce.customer_order WHERE id = OLD.order_id;
    IF o.status <> 'draft' THEN
      RAISE EXCEPTION 'lines of order % can no longer be removed', o.order_number USING ERRCODE = 'PY004';
    END IF;
    RETURN OLD;
  END IF;

  SELECT * INTO o FROM commerce.customer_order WHERE id = NEW.order_id;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at')
     AND o.status <> 'draft' THEN
    RAISE EXCEPTION 'order % is placed; its lines are frozen', o.order_number USING ERRCODE = 'PY004';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF o.status <> 'draft' THEN
      RAISE EXCEPTION 'order % is placed; lines cannot be added', o.order_number USING ERRCODE = 'PY004';
    END IF;
    SELECT * INTO p FROM catalog.price_version WHERE id = NEW.price_version_id;
    IF NOT (p.valid_from <= now() AND (p.valid_until IS NULL OR p.valid_until > now())) THEN
      RAISE EXCEPTION 'price version % is not current', p.id USING ERRCODE = 'PY008';
    END IF;
    IF NEW.unit_amount_minor <> p.unit_amount_minor OR NEW.vat_rate_bp <> p.vat_rate_bp OR NEW.currency <> p.currency THEN
      RAISE EXCEPTION 'order line does not match price version %', p.id USING ERRCODE = 'PY008';
    END IF;
  END IF;

  IF NEW.currency <> o.currency THEN
    RAISE EXCEPTION 'order line currency % differs from order currency %', NEW.currency, o.currency USING ERRCODE = 'PY008';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER check_order_line BEFORE INSERT OR UPDATE OR DELETE ON commerce.order_line
  FOR EACH ROW EXECUTE FUNCTION commerce.check_order_line();

-- An order can only be placed with lines, and its total must equal them.
-- After placement the total is frozen.
CREATE FUNCTION commerce.check_order_total() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  lines_total bigint;
  lines_count integer;
BEGIN
  IF OLD.status <> 'draft' AND (NEW.total_minor <> OLD.total_minor OR NEW.currency <> OLD.currency
                                OR NEW.billing_entity_id <> OLD.billing_entity_id OR NEW.payer_person_id <> OLD.payer_person_id) THEN
    RAISE EXCEPTION 'order % is placed; its amounts and parties are frozen', OLD.order_number USING ERRCODE = 'PY004';
  END IF;
  IF OLD.status = 'draft' AND NEW.status <> 'draft' AND NEW.status <> 'cancelled' THEN
    SELECT coalesce(sum(line_total_minor), 0), count(*) INTO lines_total, lines_count
      FROM commerce.order_line WHERE order_id = NEW.id;
    IF lines_count = 0 OR lines_total <> NEW.total_minor THEN
      RAISE EXCEPTION 'order % total % does not match its % lines (%)', NEW.order_number, NEW.total_minor, lines_count, lines_total
        USING ERRCODE = 'PY008';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER check_order_total BEFORE UPDATE ON commerce.customer_order
  FOR EACH ROW EXECUTE FUNCTION commerce.check_order_total();

-- A payment attempt for one order through one provider.
CREATE TABLE commerce.payment (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id              uuid NOT NULL REFERENCES org.education_group (id),
  order_id              uuid NOT NULL,
  billing_entity_id     uuid NOT NULL,
  provider              text NOT NULL CHECK (provider IN ('stripe', 'bank_transfer', 'cash_desk')),
  provider_mode         text NOT NULL CHECK (provider_mode IN ('test', 'live')),
  provider_checkout_id  text,
  provider_payment_id   text,
  amount_minor          bigint NOT NULL CHECK (amount_minor > 0),
  currency              char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status                text NOT NULL DEFAULT 'created'
                        CHECK (status IN ('created', 'pending', 'requires_action', 'processing', 'succeeded', 'failed', 'cancelled', 'expired')),
  provider_status       text,
  provider_status_at    timestamptz,
  failure_code          text,
  succeeded_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_checkout_id),
  UNIQUE (provider, provider_payment_id),
  UNIQUE (id, billing_entity_id),
  FOREIGN KEY (order_id, billing_entity_id) REFERENCES commerce.customer_order (id, billing_entity_id),
  CHECK (status <> 'succeeded' OR succeeded_at IS NOT NULL)
);
CREATE INDEX payment_order_idx ON commerce.payment (order_id);
CREATE INDEX payment_billing_entity_idx ON commerce.payment (billing_entity_id);
COMMENT ON COLUMN commerce.payment.provider_status_at IS 'Creation time of the provider event that set the status; older events are ignored.';

-- Credit owed by one billing entity to a payer, e.g. after an approved cancellation.
CREATE TABLE commerce.account_credit (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id               uuid NOT NULL,
  billing_entity_id      uuid NOT NULL,
  holder_person_id       uuid NOT NULL,
  currency               char(3) NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  original_amount_minor  bigint NOT NULL CHECK (original_amount_minor > 0),
  remaining_amount_minor bigint NOT NULL CHECK (remaining_amount_minor >= 0),
  reason                 text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  source_order_line_id   uuid REFERENCES commerce.order_line (id),
  status                 text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'expired', 'voided')),
  expires_at             timestamptz,
  issued_by_person_id    uuid REFERENCES people.person (id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, billing_entity_id),
  FOREIGN KEY (billing_entity_id, group_id) REFERENCES org.legal_entity (id, group_id),
  FOREIGN KEY (holder_person_id, group_id) REFERENCES people.person (id, group_id),
  CHECK (remaining_amount_minor <= original_amount_minor),
  CHECK (status <> 'used' OR remaining_amount_minor = 0)
);
CREATE INDEX account_credit_holder_idx ON commerce.account_credit (holder_person_id, status);
CREATE INDEX account_credit_billing_entity_idx ON commerce.account_credit (billing_entity_id);
CREATE INDEX account_credit_source_line_idx ON commerce.account_credit (source_order_line_id);
CREATE INDEX account_credit_issued_by_idx ON commerce.account_credit (issued_by_person_id);

-- Credit used towards an order of the same billing entity.
CREATE TABLE commerce.credit_application (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id          uuid NOT NULL REFERENCES org.education_group (id),
  credit_id         uuid NOT NULL,
  order_id          uuid NOT NULL,
  billing_entity_id uuid NOT NULL,
  amount_minor      bigint NOT NULL CHECK (amount_minor > 0),
  applied_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (credit_id, billing_entity_id) REFERENCES commerce.account_credit (id, billing_entity_id),
  FOREIGN KEY (order_id, billing_entity_id) REFERENCES commerce.customer_order (id, billing_entity_id)
);
CREATE INDEX credit_application_credit_idx ON commerce.credit_application (credit_id);
CREATE INDEX credit_application_order_idx ON commerce.credit_application (order_id);

CREATE FUNCTION commerce.apply_credit_balance() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE commerce.account_credit
     SET remaining_amount_minor = remaining_amount_minor - NEW.amount_minor,
         status = CASE WHEN remaining_amount_minor - NEW.amount_minor = 0 THEN 'used' ELSE status END
   WHERE id = NEW.credit_id AND status = 'active' AND remaining_amount_minor >= NEW.amount_minor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit % is not active or has insufficient balance', NEW.credit_id USING ERRCODE = 'PY009';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER apply_credit_balance AFTER INSERT ON commerce.credit_application
  FOR EACH ROW EXECUTE FUNCTION commerce.apply_credit_balance();

-- A refund of (part of) a payment, back to the card or as account credit.
CREATE TABLE commerce.refund (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id               uuid NOT NULL REFERENCES org.education_group (id),
  payment_id             uuid NOT NULL,
  billing_entity_id      uuid NOT NULL,
  order_line_id          uuid REFERENCES commerce.order_line (id),
  amount_minor           bigint NOT NULL CHECK (amount_minor > 0),
  currency               char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  method                 text NOT NULL CHECK (method IN ('original_payment', 'account_credit')),
  status                 text NOT NULL DEFAULT 'requested'
                         CHECK (status IN ('requested', 'approved', 'processing', 'succeeded', 'failed', 'rejected', 'cancelled')),
  reason                 text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  provider_refund_id     text UNIQUE,
  requested_by_person_id uuid REFERENCES people.person (id),
  approved_by_person_id  uuid REFERENCES people.person (id),
  approved_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (payment_id, billing_entity_id) REFERENCES commerce.payment (id, billing_entity_id),
  CHECK (status NOT IN ('approved', 'processing', 'succeeded') OR approved_at IS NOT NULL)
);
CREATE INDEX refund_payment_idx ON commerce.refund (payment_id);
CREATE INDEX refund_order_line_idx ON commerce.refund (order_line_id);
CREATE INDEX refund_billing_entity_idx ON commerce.refund (billing_entity_id);
CREATE INDEX refund_requested_by_idx ON commerce.refund (requested_by_person_id);
CREATE INDEX refund_approved_by_idx ON commerce.refund (approved_by_person_id);

-- Refunds that are open or done can never exceed the payment.
CREATE FUNCTION commerce.check_refund_total() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  paid bigint;
  refunded bigint;
BEGIN
  SELECT amount_minor INTO paid FROM commerce.payment WHERE id = NEW.payment_id AND status = 'succeeded' FOR UPDATE;
  IF paid IS NULL THEN
    RAISE EXCEPTION 'payment % has not succeeded', NEW.payment_id USING ERRCODE = 'PY010';
  END IF;
  SELECT coalesce(sum(amount_minor), 0) INTO refunded
    FROM commerce.refund
   WHERE payment_id = NEW.payment_id AND id <> NEW.id AND status NOT IN ('failed', 'rejected', 'cancelled');
  IF NEW.status NOT IN ('failed', 'rejected', 'cancelled') AND refunded + NEW.amount_minor > paid THEN
    RAISE EXCEPTION 'refunds would exceed payment % (% + % > %)', NEW.payment_id, refunded, NEW.amount_minor, paid
      USING ERRCODE = 'PY010';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER check_refund_total BEFORE INSERT OR UPDATE OF amount_minor, status ON commerce.refund
  FOR EACH ROW EXECUTE FUNCTION commerce.check_refund_total();

-- Append-only financial ledger per order line, school and billing entity.
-- Positive amounts are money received, negative amounts money given back or
-- turned into credit. School revenue is the sum of these rows.
CREATE TABLE commerce.payment_allocation (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id              uuid NOT NULL REFERENCES org.education_group (id),
  order_line_id         uuid NOT NULL,
  billing_entity_id     uuid NOT NULL,
  school_id             uuid NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('payment', 'refund', 'credit_issued', 'credit_applied')),
  payment_id            uuid REFERENCES commerce.payment (id),
  refund_id             uuid REFERENCES commerce.refund (id),
  credit_id             uuid REFERENCES commerce.account_credit (id),
  credit_application_id uuid REFERENCES commerce.credit_application (id),
  currency              char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor          bigint NOT NULL CHECK (amount_minor <> 0),
  allocated_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (order_line_id, billing_entity_id, school_id) REFERENCES commerce.order_line (id, billing_entity_id, school_id),
  CHECK (CASE kind
           WHEN 'payment'        THEN payment_id IS NOT NULL AND amount_minor > 0
           WHEN 'refund'         THEN refund_id IS NOT NULL AND amount_minor < 0
           WHEN 'credit_issued'  THEN credit_id IS NOT NULL AND amount_minor < 0
           WHEN 'credit_applied' THEN credit_application_id IS NOT NULL AND amount_minor > 0
         END)
);
CREATE INDEX payment_allocation_line_idx ON commerce.payment_allocation (order_line_id);
CREATE INDEX payment_allocation_school_idx ON commerce.payment_allocation (school_id, allocated_at);
CREATE INDEX payment_allocation_entity_idx ON commerce.payment_allocation (billing_entity_id, allocated_at);
CREATE INDEX payment_allocation_payment_idx ON commerce.payment_allocation (payment_id);
CREATE INDEX payment_allocation_refund_idx ON commerce.payment_allocation (refund_id);
CREATE INDEX payment_allocation_credit_idx ON commerce.payment_allocation (credit_id);
CREATE INDEX payment_allocation_credit_application_idx ON commerce.payment_allocation (credit_application_id);

CREATE FUNCTION commerce.forbid_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '%.% is append-only', TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'PY004';
END $$;
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON commerce.payment_allocation
  FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON commerce.credit_application
  FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();

-- Triggers
CREATE TRIGGER set_updated_at BEFORE UPDATE ON commerce.customer_order FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON commerce.order_line     FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON commerce.payment        FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON commerce.account_credit FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON commerce.refund         FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON commerce.customer_order     FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON commerce.order_line         FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON commerce.payment            FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON commerce.account_credit     FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON commerce.credit_application FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON commerce.refund             FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON commerce.payment_allocation FOR EACH ROW EXECUTE FUNCTION audit.log_change();

INSERT INTO meta.state_transition (machine, from_state, to_state) VALUES
  ('customer_order', 'draft', 'pending_payment'), ('customer_order', 'draft', 'cancelled'),
  ('customer_order', 'pending_payment', 'paid'), ('customer_order', 'pending_payment', 'expired'),
  ('customer_order', 'pending_payment', 'cancelled'),
  -- Late payment recovery: the provider confirms after the reservation expired.
  ('customer_order', 'expired', 'paid'),
  ('customer_order', 'paid', 'partially_refunded'), ('customer_order', 'paid', 'refunded'),
  ('customer_order', 'partially_refunded', 'refunded'),
  ('order_line', 'pending', 'confirmed'), ('order_line', 'pending', 'cancelled'), ('order_line', 'confirmed', 'cancelled'),
  ('payment', 'created', 'pending'), ('payment', 'created', 'requires_action'), ('payment', 'created', 'processing'),
  ('payment', 'created', 'succeeded'), ('payment', 'created', 'failed'), ('payment', 'created', 'cancelled'),
  ('payment', 'created', 'expired'),
  ('payment', 'pending', 'requires_action'), ('payment', 'pending', 'processing'), ('payment', 'pending', 'succeeded'),
  ('payment', 'pending', 'failed'), ('payment', 'pending', 'cancelled'), ('payment', 'pending', 'expired'),
  ('payment', 'requires_action', 'processing'), ('payment', 'requires_action', 'succeeded'),
  ('payment', 'requires_action', 'failed'), ('payment', 'requires_action', 'cancelled'), ('payment', 'requires_action', 'expired'),
  ('payment', 'processing', 'succeeded'), ('payment', 'processing', 'failed'),
  -- An asynchronous payment can still succeed after the checkout session expired.
  ('payment', 'expired', 'succeeded'),
  ('account_credit', 'active', 'used'), ('account_credit', 'active', 'expired'), ('account_credit', 'active', 'voided'),
  ('refund', 'requested', 'approved'), ('refund', 'requested', 'rejected'), ('refund', 'requested', 'cancelled'),
  ('refund', 'approved', 'processing'), ('refund', 'approved', 'succeeded'), ('refund', 'approved', 'failed'),
  ('refund', 'processing', 'succeeded'), ('refund', 'processing', 'failed'), ('refund', 'failed', 'approved');

CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON commerce.customer_order FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('customer_order');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON commerce.order_line     FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('order_line');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON commerce.payment        FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('payment');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON commerce.account_credit FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('account_credit');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON commerce.refund         FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('refund');

-- migrate:down
DELETE FROM meta.state_transition WHERE machine IN ('customer_order', 'order_line', 'payment', 'account_credit', 'refund');
DROP TABLE commerce.payment_allocation;
DROP FUNCTION commerce.forbid_change() CASCADE;
DROP TABLE commerce.refund;
DROP FUNCTION commerce.check_refund_total();
DROP TABLE commerce.credit_application;
DROP FUNCTION commerce.apply_credit_balance();
DROP TABLE commerce.account_credit;
DROP TABLE commerce.payment;
DROP FUNCTION commerce.check_order_total() CASCADE;
ALTER TABLE scheduling.booking DROP CONSTRAINT booking_order_line_id_school_id_student_person_id_fkey;
DROP TABLE commerce.order_line;
DROP FUNCTION commerce.check_order_line();
DROP TABLE commerce.customer_order;
DROP SEQUENCE commerce.order_number_seq;
