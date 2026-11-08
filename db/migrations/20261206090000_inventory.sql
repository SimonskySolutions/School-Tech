-- migrate:up

-- Everything a school keeps beyond uniforms: books, equipment and supplies, with
-- the suppliers they come from. Stock is a running count kept by an append-only
-- list of movements, so it can never go below zero and every change has a reason.

CREATE SCHEMA inventory;
REVOKE ALL ON SCHEMA inventory FROM PUBLIC;
GRANT USAGE ON SCHEMA inventory TO pyth_api;

INSERT INTO access.permission (code, description) VALUES
  ('inventory.read', 'See the school''s stock and suppliers'),
  ('inventory.manage', 'Change the school''s stock and suppliers');
INSERT INTO access.role_permission (role_code, permission_code) VALUES
  ('group_ceo', 'inventory.read'), ('group_finance', 'inventory.read'), ('group_admin', 'inventory.read'),
  ('principal', 'inventory.read'), ('school_admin', 'inventory.read'),
  ('group_admin', 'inventory.manage'), ('principal', 'inventory.manage'), ('school_admin', 'inventory.manage');

CREATE TABLE inventory.supplier (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id    uuid NOT NULL REFERENCES org.education_group (id),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  email       text CHECK (length(email) BETWEEN 3 AND 200),
  phone       text CHECK (length(phone) BETWEEN 3 AND 40),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, name)
);

CREATE TABLE inventory.item (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id       uuid NOT NULL,
  school_id      uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('book', 'equipment', 'supply')),
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  reorder_level  integer NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  supplier_id    uuid REFERENCES inventory.supplier (id),
  on_hand        integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name),
  UNIQUE (id, school_id),
  FOREIGN KEY (school_id, group_id) REFERENCES org.school (id, group_id)
);
CREATE INDEX item_supplier_idx ON inventory.item (supplier_id);
COMMENT ON COLUMN inventory.item.on_hand IS 'Kept by the movements. Never written directly.';

CREATE TABLE inventory.movement (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id    uuid NOT NULL REFERENCES org.education_group (id),
  school_id   uuid NOT NULL,
  item_id     uuid NOT NULL,
  reason      text NOT NULL CHECK (reason IN ('delivered', 'issued', 'returned', 'lost', 'counted')),
  change      integer NOT NULL CHECK (change <> 0),
  moved_by    uuid REFERENCES people.person (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (item_id, school_id) REFERENCES inventory.item (id, school_id)
);
CREATE INDEX movement_item_idx ON inventory.movement (item_id, created_at);
CREATE INDEX movement_school_idx ON inventory.movement (school_id);
CREATE INDEX movement_moved_by_idx ON inventory.movement (moved_by);

CREATE FUNCTION inventory.apply_movement() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE inventory.item SET on_hand = on_hand + NEW.change WHERE id = NEW.item_id;
  RETURN NULL;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'not enough of this item in stock' USING ERRCODE = 'PY030';
END;
$$;
REVOKE ALL ON FUNCTION inventory.apply_movement() FROM PUBLIC;
CREATE TRIGGER apply_movement AFTER INSERT ON inventory.movement
  FOR EACH ROW EXECUTE FUNCTION inventory.apply_movement();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON inventory.item FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON inventory.supplier FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON inventory.item     FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON inventory.movement FOR EACH ROW EXECUTE FUNCTION audit.log_change();

ALTER TABLE inventory.supplier ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.item ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.movement ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT (id, group_id, name, email, phone) ON inventory.supplier TO pyth_api;
GRANT SELECT, INSERT (id, group_id, school_id, kind, name, reorder_level, supplier_id),
      UPDATE (reorder_level, supplier_id)
  ON inventory.item TO pyth_api;
GRANT SELECT, INSERT (id, group_id, school_id, item_id, reason, change, moved_by) ON inventory.movement TO pyth_api;

-- Suppliers are the group's, so anyone who keeps stock at one of its schools uses them.
CREATE POLICY read ON inventory.supplier FOR SELECT TO pyth_api
  USING (group_id = access.current_group_id() AND access.has_permission_anywhere('inventory.read'));
CREATE POLICY manage_insert ON inventory.supplier FOR INSERT TO pyth_api
  WITH CHECK (group_id = access.current_group_id() AND access.has_permission_anywhere('inventory.manage'));

CREATE POLICY read ON inventory.item FOR SELECT TO pyth_api USING (access.has_permission('inventory.read', school_id));
CREATE POLICY manage_insert ON inventory.item FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('inventory.manage', school_id));
CREATE POLICY manage_update ON inventory.item FOR UPDATE TO pyth_api
  USING (access.has_permission('inventory.manage', school_id))
  WITH CHECK (access.has_permission('inventory.manage', school_id));

CREATE POLICY read ON inventory.movement FOR SELECT TO pyth_api USING (access.has_permission('inventory.read', school_id));
CREATE POLICY manage_insert ON inventory.movement FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('inventory.manage', school_id));

-- migrate:down
DROP TABLE inventory.movement;
DROP TABLE inventory.item;
DROP TABLE inventory.supplier;
DROP FUNCTION inventory.apply_movement();
DROP SCHEMA inventory;
DELETE FROM access.role_permission WHERE permission_code IN ('inventory.read', 'inventory.manage');
DELETE FROM access.permission WHERE code IN ('inventory.read', 'inventory.manage');
