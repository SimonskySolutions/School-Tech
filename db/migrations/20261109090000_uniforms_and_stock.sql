-- migrate:up

-- Uniforms (M4.6, ADR 0025): a product is an offering of kind "uniform" with
-- variants, each with its own price versions and stock. Stock is never
-- oversold: reserved + allocated <= on_hand, kept by triggers on stock
-- reservations made in the same transaction as the order.

CREATE TABLE catalog.product_variant (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id             uuid NOT NULL REFERENCES org.education_group (id),
  school_id            uuid NOT NULL,
  offering_id          uuid NOT NULL,
  sku                  text NOT NULL CHECK (sku ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),
  size                 text CHECK (length(size) BETWEEN 1 AND 40),
  colour               text CHECK (length(colour) BETWEEN 1 AND 40),
  low_stock_threshold  integer NOT NULL DEFAULT 3 CHECK (low_stock_threshold >= 0),
  on_hand              integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved             integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  allocated            integer NOT NULL DEFAULT 0 CHECK (allocated >= 0),
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offering_id, sku),
  UNIQUE (id, offering_id),
  FOREIGN KEY (offering_id, school_id) REFERENCES catalog.school_offering (id, school_id),
  CONSTRAINT product_variant_never_oversold CHECK (reserved + allocated <= on_hand)
);
CREATE INDEX product_variant_school_idx ON catalog.product_variant (school_id);
COMMENT ON COLUMN catalog.product_variant.on_hand IS 'Items in the store. Changed only by catalog.adjust_stock and hand-overs.';
COMMENT ON COLUMN catalog.product_variant.reserved IS 'Held by unpaid orders. Maintained by stock reservation triggers.';
COMMENT ON COLUMN catalog.product_variant.allocated IS 'Paid, not yet handed over. Maintained by stock reservation triggers.';

CREATE FUNCTION catalog.check_product_variant() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM catalog.school_offering o JOIN catalog.service_definition d ON d.id = o.service_definition_id
                  WHERE o.id = NEW.offering_id AND o.group_id = NEW.group_id AND d.kind = 'uniform') THEN
    RAISE EXCEPTION 'variants are for uniform products' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION catalog.check_product_variant() FROM PUBLIC;
CREATE TRIGGER check_variant BEFORE INSERT OR UPDATE OF offering_id ON catalog.product_variant
  FOR EACH ROW EXECUTE FUNCTION catalog.check_product_variant();

-- Prices per variant: uniqueness and the no-overlap rule are per offering and variant.
ALTER TABLE catalog.price_version ADD COLUMN variant_id uuid;
ALTER TABLE catalog.price_version
  ADD CONSTRAINT price_version_variant_fkey FOREIGN KEY (variant_id, offering_id) REFERENCES catalog.product_variant (id, offering_id);
CREATE INDEX price_version_variant_idx ON catalog.price_version (variant_id);
ALTER TABLE catalog.price_version DROP CONSTRAINT price_version_offering_id_version_key;
ALTER TABLE catalog.price_version
  ADD CONSTRAINT price_version_offering_variant_version_key UNIQUE NULLS NOT DISTINCT (offering_id, variant_id, version);
ALTER TABLE catalog.price_version DROP CONSTRAINT price_version_offering_id_tstzrange_excl;
ALTER TABLE catalog.price_version
  ADD CONSTRAINT price_version_no_overlap EXCLUDE USING gist (
    offering_id WITH =,
    (coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    tstzrange(valid_from, valid_until, '[)') WITH &&);
GRANT INSERT (variant_id) ON catalog.price_version TO pyth_api;

-- The stock ledger: deliveries, counted corrections and hand-overs. Permanent.
CREATE TABLE catalog.stock_movement (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id              uuid NOT NULL REFERENCES org.education_group (id),
  school_id             uuid NOT NULL,
  variant_id            uuid NOT NULL REFERENCES catalog.product_variant (id),
  kind                  text NOT NULL CHECK (kind IN ('delivery', 'correction', 'handover')),
  delta                 integer NOT NULL CHECK (delta <> 0),
  reason                text CHECK (length(reason) BETWEEN 1 AND 300),
  reservation_id        uuid,
  created_by_person_id  uuid REFERENCES people.person (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'delivery' OR delta > 0),
  CHECK (kind <> 'handover' OR (delta < 0 AND reservation_id IS NOT NULL))
);
CREATE INDEX stock_movement_variant_idx ON catalog.stock_movement (variant_id, created_at);
CREATE INDEX stock_movement_reservation_idx ON catalog.stock_movement (reservation_id);
CREATE INDEX stock_movement_created_by_idx ON catalog.stock_movement (created_by_person_id);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON catalog.stock_movement
  FOR EACH ROW EXECUTE FUNCTION scheduling.append_only();

-- Stock held for an order line, like a booking holds a place.
CREATE TABLE commerce.stock_reservation (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id                 uuid NOT NULL,
  school_id                uuid NOT NULL,
  variant_id               uuid NOT NULL REFERENCES catalog.product_variant (id),
  order_line_id            uuid NOT NULL UNIQUE REFERENCES commerce.order_line (id),
  student_person_id        uuid NOT NULL,
  quantity                 integer NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  status                   text NOT NULL CHECK (status IN ('reserved', 'confirmed', 'handed_over', 'cancelled', 'expired')),
  reserved_until           timestamptz,
  confirmed_at             timestamptz,
  handed_over_at           timestamptz,
  handed_over_by_person_id uuid REFERENCES people.person (id),
  cancelled_at             timestamptz,
  created_by_person_id     uuid REFERENCES people.person (id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (student_person_id, group_id) REFERENCES people.person (id, group_id),
  CHECK (status <> 'reserved' OR reserved_until IS NOT NULL),
  CHECK (status <> 'handed_over' OR (handed_over_at IS NOT NULL AND handed_over_by_person_id IS NOT NULL))
);
CREATE INDEX stock_reservation_variant_idx ON commerce.stock_reservation (variant_id, status);
CREATE INDEX stock_reservation_student_idx ON commerce.stock_reservation (student_person_id);
CREATE INDEX stock_reservation_school_idx ON commerce.stock_reservation (school_id, status);
CREATE INDEX stock_reservation_handed_over_by_idx ON commerce.stock_reservation (handed_over_by_person_id);
CREATE INDEX stock_reservation_created_by_idx ON commerce.stock_reservation (created_by_person_id);
ALTER TABLE catalog.stock_movement
  ADD CONSTRAINT stock_movement_reservation_fkey FOREIGN KEY (reservation_id) REFERENCES commerce.stock_reservation (id);

INSERT INTO meta.state_transition (machine, from_state, to_state) VALUES
  ('stock_reservation', 'reserved', 'confirmed'), ('stock_reservation', 'reserved', 'expired'),
  ('stock_reservation', 'reserved', 'cancelled'), ('stock_reservation', 'expired', 'confirmed'),
  ('stock_reservation', 'expired', 'cancelled'), ('stock_reservation', 'confirmed', 'handed_over'),
  ('stock_reservation', 'confirmed', 'cancelled');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON commerce.stock_reservation
  FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('stock_reservation');

-- The reservation matches its line: the line's offering, the variant's price, the quantity, the child.
CREATE FUNCTION commerce.check_stock_reservation() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM commerce.order_line l
      JOIN catalog.price_version p ON p.id = l.price_version_id
      JOIN catalog.product_variant v ON v.id = NEW.variant_id
     WHERE l.id = NEW.order_line_id AND l.offering_id = v.offering_id AND p.variant_id = v.id
       AND l.quantity = NEW.quantity AND l.student_person_id = NEW.student_person_id
       AND l.school_id = NEW.school_id AND l.group_id = NEW.group_id AND v.status = 'active') THEN
    RAISE EXCEPTION 'the reservation does not match its order line' USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> 'reserved' THEN
    RAISE EXCEPTION 'stock is reserved first, then confirmed when paid' USING ERRCODE = 'PY001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION commerce.check_stock_reservation() FROM PUBLIC;
CREATE TRIGGER check_reservation BEFORE INSERT ON commerce.stock_reservation
  FOR EACH ROW EXECUTE FUNCTION commerce.check_stock_reservation();

-- Counters follow the reservation; the variant row lock serialises buyers,
-- and the variant's check refuses the one that would oversell.
CREATE FUNCTION commerce.maintain_stock_counts() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  old_reserved int := CASE WHEN TG_OP <> 'INSERT' AND OLD.status = 'reserved' THEN OLD.quantity ELSE 0 END;
  old_allocated int := CASE WHEN TG_OP <> 'INSERT' AND OLD.status = 'confirmed' THEN OLD.quantity ELSE 0 END;
  new_reserved int := CASE WHEN TG_OP <> 'DELETE' AND NEW.status = 'reserved' THEN NEW.quantity ELSE 0 END;
  new_allocated int := CASE WHEN TG_OP <> 'DELETE' AND NEW.status = 'confirmed' THEN NEW.quantity ELSE 0 END;
  handed int := CASE WHEN TG_OP = 'UPDATE' AND NEW.status = 'handed_over' AND OLD.status <> 'handed_over'
                     THEN NEW.quantity ELSE 0 END;
  target uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.variant_id ELSE NEW.variant_id END;
BEGIN
  IF new_reserved = old_reserved AND new_allocated = old_allocated AND handed = 0 THEN
    RETURN NULL;
  END IF;
  BEGIN
    UPDATE catalog.product_variant
       SET reserved = reserved + new_reserved - old_reserved,
           allocated = allocated + new_allocated - old_allocated,
           on_hand = on_hand - handed
     WHERE id = target;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'not enough of this item in stock' USING ERRCODE = 'PY019';
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION commerce.maintain_stock_counts() FROM PUBLIC;
CREATE TRIGGER maintain_stock_counts AFTER INSERT OR DELETE OR UPDATE OF status ON commerce.stock_reservation
  FOR EACH ROW EXECUTE FUNCTION commerce.maintain_stock_counts();

-- Staff hand a paid reservation over; the items leave the store.
CREATE FUNCTION commerce.hand_over_stock(p_reservation_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM commerce.stock_reservation WHERE id = p_reservation_id FOR UPDATE;
  IF app.current_person_id() IS NULL OR NOT FOUND OR NOT access.has_permission('bookings.read', r.school_id) THEN
    RAISE EXCEPTION 'no such reservation' USING ERRCODE = 'P0002';
  END IF;
  IF NOT access.has_permission('bookings.manage', r.school_id) THEN
    RAISE EXCEPTION 'not permitted to hand over items at this school' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'confirmed' THEN
    RAISE EXCEPTION 'only paid items not yet handed over can be handed over' USING ERRCODE = 'PY001';
  END IF;
  UPDATE commerce.stock_reservation
     SET status = 'handed_over', handed_over_at = now(), handed_over_by_person_id = app.current_person_id()
   WHERE id = p_reservation_id;
  INSERT INTO catalog.stock_movement (group_id, school_id, variant_id, kind, delta, reservation_id, created_by_person_id)
  VALUES (r.group_id, r.school_id, r.variant_id, 'handover', -r.quantity, r.id, app.current_person_id());
END $$;
REVOKE ALL ON FUNCTION commerce.hand_over_stock(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION commerce.hand_over_stock(uuid) TO pyth_api;

-- Deliveries in and counted corrections; never below what is held for orders.
CREATE FUNCTION catalog.adjust_stock(p_variant_id uuid, p_kind text, p_delta integer, p_reason text) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record;
  result int;
BEGIN
  SELECT * INTO v FROM catalog.product_variant WHERE id = p_variant_id FOR UPDATE;
  IF app.current_person_id() IS NULL OR NOT FOUND OR v.group_id <> access.current_group_id() THEN
    RAISE EXCEPTION 'no such variant' USING ERRCODE = 'P0002';
  END IF;
  IF NOT access.has_permission('catalog.manage', v.school_id) THEN
    RAISE EXCEPTION 'not permitted to change stock at this school' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('delivery', 'correction') OR p_delta = 0 OR (p_kind = 'delivery' AND p_delta < 0) THEN
    RAISE EXCEPTION 'a delivery adds items; a correction adds or removes them' USING ERRCODE = '22023';
  END IF;
  BEGIN
    UPDATE catalog.product_variant SET on_hand = on_hand + p_delta WHERE id = p_variant_id RETURNING on_hand INTO result;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'that would leave fewer items than are held for orders' USING ERRCODE = 'PY019';
  END;
  INSERT INTO catalog.stock_movement (group_id, school_id, variant_id, kind, delta, reason, created_by_person_id)
  VALUES (v.group_id, v.school_id, v.id, p_kind, p_delta, p_reason, app.current_person_id());
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION catalog.adjust_stock(uuid, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.adjust_stock(uuid, text, integer, text) TO pyth_api;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON catalog.product_variant FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON commerce.stock_reservation FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON catalog.product_variant   FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON commerce.stock_reservation FOR EACH ROW EXECUTE FUNCTION audit.log_change();

ALTER TABLE catalog.product_variant ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.stock_movement ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce.stock_reservation ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT (id, group_id, school_id, offering_id, sku, size, colour, low_stock_threshold),
      UPDATE (size, colour, low_stock_threshold, status)
  ON catalog.product_variant TO pyth_api;
GRANT SELECT ON catalog.product_variant TO pyth_worker;
GRANT SELECT ON catalog.stock_movement TO pyth_api;
GRANT SELECT,
      INSERT (id, group_id, school_id, variant_id, order_line_id, student_person_id, quantity, status, reserved_until,
              created_by_person_id)
  ON commerce.stock_reservation TO pyth_api;
GRANT SELECT, UPDATE (status, reserved_until, confirmed_at, cancelled_at) ON commerce.stock_reservation TO pyth_worker;

-- Variants and their stock counts are visible in the group (families see what is left);
-- the ledger to the school's catalogue staff.
CREATE POLICY read ON catalog.product_variant FOR SELECT TO pyth_api USING (group_id = access.current_group_id());
CREATE POLICY manage_insert ON catalog.product_variant FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('catalog.manage', school_id));
CREATE POLICY manage_update ON catalog.product_variant FOR UPDATE TO pyth_api
  USING (access.has_permission('catalog.manage', school_id)) WITH CHECK (access.has_permission('catalog.manage', school_id));
CREATE POLICY read ON catalog.stock_movement FOR SELECT TO pyth_api
  USING (access.has_permission('catalog.read', school_id) OR access.has_permission('bookings.read', school_id));
CREATE POLICY read ON commerce.stock_reservation FOR SELECT TO pyth_api
  USING (access.is_guardian_of(student_person_id, 'view') OR access.has_permission('bookings.read', school_id)
         OR access.has_permission('finance.read', school_id));
CREATE POLICY reserve ON commerce.stock_reservation FOR INSERT TO pyth_api
  WITH CHECK ((access.is_guardian_of(student_person_id, 'manage_bookings') AND status = 'reserved'
               AND created_by_person_id = app.current_person_id())
              OR access.has_permission('bookings.manage', school_id));
CREATE POLICY worker_system ON commerce.stock_reservation TO pyth_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_system ON catalog.product_variant FOR SELECT TO pyth_worker USING (true);

-- migrate:down
DROP FUNCTION catalog.adjust_stock(uuid, text, integer, text);
DROP FUNCTION commerce.hand_over_stock(uuid);
ALTER TABLE catalog.stock_movement DROP CONSTRAINT stock_movement_reservation_fkey;
DROP TABLE commerce.stock_reservation;
DROP FUNCTION commerce.maintain_stock_counts();
DROP FUNCTION commerce.check_stock_reservation();
DELETE FROM meta.state_transition WHERE machine = 'stock_reservation';
DROP TABLE catalog.stock_movement;
REVOKE INSERT (variant_id) ON catalog.price_version FROM pyth_api;
ALTER TABLE catalog.price_version DROP CONSTRAINT price_version_no_overlap;
ALTER TABLE catalog.price_version
  ADD CONSTRAINT price_version_offering_id_tstzrange_excl EXCLUDE USING gist (offering_id WITH =, tstzrange(valid_from, valid_until, '[)') WITH &&);
ALTER TABLE catalog.price_version DROP CONSTRAINT price_version_offering_variant_version_key;
ALTER TABLE catalog.price_version ADD CONSTRAINT price_version_offering_id_version_key UNIQUE (offering_id, version);
DROP INDEX catalog.price_version_variant_idx;
ALTER TABLE catalog.price_version DROP CONSTRAINT price_version_variant_fkey, DROP COLUMN variant_id;
DROP TABLE catalog.product_variant;
DROP FUNCTION catalog.check_product_variant();
