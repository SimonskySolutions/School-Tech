-- migrate:up

-- Lunch menus and declared allergens (M4.1).
--
-- The 14 allergens that EU Regulation 1169/2011 (Annex II) requires caterers
-- to declare, as stable codes. Dishes on a menu and a child's dietary needs
-- use the same codes, so the kitchen list can warn when a booked child's
-- allergen is in that day's food.
CREATE FUNCTION catalog.allergen_codes() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT ARRAY['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soybeans', 'milk', 'nuts',
               'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs']::text[]
$$;
REVOKE ALL ON FUNCTION catalog.allergen_codes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.allergen_codes() TO pyth_api, pyth_worker;

INSERT INTO access.permission (code, description) VALUES
  ('menus.manage', 'Publish and change lunch menus and their allergens');
INSERT INTO access.role_permission (role_code, permission_code) VALUES
  ('school_life_coordinator', 'menus.manage'), ('principal', 'menus.manage'), ('kitchen', 'menus.manage');

-- One row per dish on one lunch session (an offering on one day).
CREATE TABLE scheduling.menu_dish (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id    uuid NOT NULL REFERENCES org.education_group (id),
  school_id   uuid NOT NULL,
  session_id  uuid NOT NULL,
  position    smallint NOT NULL CHECK (position BETWEEN 1 AND 12),
  course      text NOT NULL CHECK (course IN ('starter', 'soup', 'main', 'side', 'dessert', 'drink', 'other')),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  allergens   text[] NOT NULL DEFAULT '{}' CHECK (allergens <@ catalog.allergen_codes()),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, position),
  FOREIGN KEY (session_id, school_id) REFERENCES scheduling.session (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, group_id) REFERENCES org.school (id, group_id)
);
CREATE INDEX menu_dish_school_idx ON scheduling.menu_dish (school_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON scheduling.menu_dish FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON scheduling.menu_dish FOR EACH ROW EXECUTE FUNCTION audit.log_change();

-- Menus belong to lunch sessions of the same group, nothing else.
CREATE FUNCTION scheduling.check_menu_session() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM scheduling.session s
      JOIN catalog.school_offering o ON o.id = s.offering_id
      JOIN catalog.service_definition d ON d.id = o.service_definition_id
     WHERE s.id = NEW.session_id AND s.group_id = NEW.group_id AND d.kind = 'lunch'
  ) THEN
    RAISE EXCEPTION 'menus are for lunch sessions only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION scheduling.check_menu_session() FROM PUBLIC;
CREATE TRIGGER check_menu_session BEFORE INSERT OR UPDATE OF session_id, group_id ON scheduling.menu_dish
  FOR EACH ROW EXECUTE FUNCTION scheduling.check_menu_session();

ALTER TABLE scheduling.menu_dish ENABLE ROW LEVEL SECURITY;
GRANT SELECT, DELETE,
      INSERT (id, group_id, school_id, session_id, position, course, name, allergens),
      UPDATE (position, course, name, allergens)
  ON scheduling.menu_dish TO pyth_api;
GRANT SELECT ON scheduling.menu_dish TO pyth_worker;
-- Whoever may see the session sees its menu: parents for published lunch, staff of the school.
CREATE POLICY read ON scheduling.menu_dish FOR SELECT TO pyth_api
  USING (EXISTS (SELECT 1 FROM scheduling.session s WHERE s.id = session_id));
CREATE POLICY manage_insert ON scheduling.menu_dish FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('menus.manage', school_id));
CREATE POLICY manage_update ON scheduling.menu_dish FOR UPDATE TO pyth_api
  USING (access.has_permission('menus.manage', school_id))
  WITH CHECK (access.has_permission('menus.manage', school_id));
CREATE POLICY manage_delete ON scheduling.menu_dish FOR DELETE TO pyth_api
  USING (access.has_permission('menus.manage', school_id));

-- Dietary needs: the declared allergens, and when they were verified.
ALTER TABLE sensitive.dietary_requirement
  ADD COLUMN allergens text[] NOT NULL DEFAULT '{}' CHECK (allergens <@ catalog.allergen_codes()),
  ADD COLUMN verified_at timestamptz;
UPDATE sensitive.dietary_requirement SET verified_at = updated_at WHERE verified_by_person_id IS NOT NULL;
ALTER TABLE sensitive.dietary_requirement
  ADD CONSTRAINT dietary_requirement_verified_together
  CHECK ((verified_by_person_id IS NULL) = (verified_at IS NULL));
GRANT INSERT (allergens), UPDATE (allergens) ON sensitive.dietary_requirement TO pyth_api;

-- Who verified what is decided here, not by the caller:
-- * staff with sensitive.dietary.manage who record or change a need verify it
--   themselves (as themselves, now);
-- * a guardian's new need, or any change by a guardian, is unverified until
--   staff look at it again, so a verified need can never change unseen;
-- * nobody else can set or forge a verification.
-- Without a signed-in person (seed, erasure by the worker) rows are left as given.
CREATE FUNCTION sensitive.dietary_verification() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  me constant uuid := app.current_person_id();
BEGIN
  IF me IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW.kind, NEW.description, NEW.severity, NEW.allergens, NEW.valid_from, NEW.valid_until)
         IS NOT DISTINCT FROM (OLD.kind, OLD.description, OLD.severity, OLD.allergens, OLD.valid_from, OLD.valid_until)
     AND NEW.verified_by_person_id IS NOT DISTINCT FROM OLD.verified_by_person_id THEN
    NEW.verified_at := OLD.verified_at;
    RETURN NEW;
  END IF;
  IF access.has_permission_for_person('sensitive.dietary.manage', NEW.student_person_id) THEN
    NEW.verified_by_person_id := me;
    NEW.verified_at := now();
  ELSIF NEW.verified_by_person_id IS NOT NULL
        AND (TG_OP = 'INSERT' OR NEW.verified_by_person_id IS DISTINCT FROM OLD.verified_by_person_id) THEN
    RAISE EXCEPTION 'only School Life staff verify dietary needs' USING ERRCODE = '42501';
  ELSE
    NEW.verified_by_person_id := NULL;
    NEW.verified_at := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sensitive.dietary_verification() FROM PUBLIC;
CREATE TRIGGER verification BEFORE INSERT OR UPDATE ON sensitive.dietary_requirement
  FOR EACH ROW EXECUTE FUNCTION sensitive.dietary_verification();

-- A guardian may take back a need they recorded by mistake while nobody has
-- verified it yet; a verified need is ended with an end date, so the kitchen
-- and the audit log keep its history.
CREATE POLICY withdraw ON sensitive.dietary_requirement FOR DELETE TO pyth_api
  USING (verified_by_person_id IS NULL AND provided_by_person_id = app.current_person_id()
         AND access.is_guardian_of(student_person_id, 'manage_bookings'));

-- migrate:down
DROP POLICY withdraw ON sensitive.dietary_requirement;
DROP TRIGGER verification ON sensitive.dietary_requirement;
DROP FUNCTION sensitive.dietary_verification();
REVOKE INSERT (allergens), UPDATE (allergens) ON sensitive.dietary_requirement FROM pyth_api;
ALTER TABLE sensitive.dietary_requirement
  DROP CONSTRAINT dietary_requirement_verified_together,
  DROP COLUMN verified_at,
  DROP COLUMN allergens;
DROP TABLE scheduling.menu_dish;
DROP FUNCTION scheduling.check_menu_session();
DELETE FROM access.role_permission WHERE permission_code = 'menus.manage';
DELETE FROM access.permission WHERE code = 'menus.manage';
DROP FUNCTION catalog.allergen_codes();
