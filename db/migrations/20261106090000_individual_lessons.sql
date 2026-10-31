-- migrate:up

-- Individual lessons (M4.3, ADR 0022): teachers and rooms with weekly
-- availability, lesson slots that never put a teacher or a room in two places
-- at once, packages of lessons bought through the normal checkout and spent
-- one booking at a time, and the cancellation rule.

-- Teachers and rooms of a school. Parents see the display name only.
CREATE TABLE scheduling.resource (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id      uuid NOT NULL,
  school_id     uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('teacher', 'room')),
  display_name  text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  person_id     uuid,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, kind, display_name),
  FOREIGN KEY (school_id, group_id) REFERENCES org.school (id, group_id),
  FOREIGN KEY (person_id, group_id) REFERENCES people.person (id, group_id),
  CHECK (kind = 'teacher' OR person_id IS NULL)
);
CREATE INDEX resource_person_idx ON scheduling.resource (person_id);

-- When a resource can be used, every week, in the school's local time.
CREATE TABLE scheduling.resource_availability (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id     uuid NOT NULL REFERENCES org.education_group (id),
  school_id    uuid NOT NULL,
  resource_id  uuid NOT NULL,
  weekday      smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  starts       time NOT NULL,
  ends         time NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (resource_id, school_id) REFERENCES scheduling.resource (id, school_id) ON DELETE CASCADE,
  CHECK (ends > starts)
);
CREATE INDEX resource_availability_resource_idx ON scheduling.resource_availability (resource_id, weekday);

-- Which resources a session (a lesson slot) uses, and when. The exclusion
-- constraint is the guarantee: one resource, never two overlapping live slots.
CREATE TABLE scheduling.session_resource (
  session_id   uuid NOT NULL,
  resource_id  uuid NOT NULL,
  group_id     uuid NOT NULL REFERENCES org.education_group (id),
  school_id    uuid NOT NULL,
  during       tstzrange NOT NULL CHECK (NOT isempty(during) AND NOT lower_inf(during) AND NOT upper_inf(during)),
  active       boolean NOT NULL DEFAULT true,
  PRIMARY KEY (session_id, resource_id),
  FOREIGN KEY (session_id, school_id) REFERENCES scheduling.session (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id, school_id) REFERENCES scheduling.resource (id, school_id),
  CONSTRAINT session_resource_never_twice EXCLUDE USING gist (resource_id WITH =, during WITH &&) WHERE (active)
);
CREATE INDEX session_resource_resource_idx ON scheduling.session_resource (resource_id);
COMMENT ON COLUMN scheduling.session_resource.active IS 'False once the session is cancelled. Maintained by triggers.';

-- A slot must lie inside the resource's weekly availability, on one local day.
CREATE FUNCTION scheduling.check_session_resource() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  zone text;
  local_start timestamp;
  local_end timestamp;
BEGIN
  IF NOT NEW.active THEN
    RETURN NEW;
  END IF;
  SELECT sc.time_zone INTO zone FROM org.school sc WHERE sc.id = NEW.school_id;
  IF NOT EXISTS (SELECT 1 FROM scheduling.resource r WHERE r.id = NEW.resource_id AND r.status = 'active') THEN
    RAISE EXCEPTION 'the teacher or room is no longer in use' USING ERRCODE = 'PY015';
  END IF;
  local_start := lower(NEW.during) AT TIME ZONE zone;
  local_end := upper(NEW.during) AT TIME ZONE zone;
  IF local_start::date <> (local_end - interval '1 microsecond')::date OR NOT EXISTS (
       SELECT 1 FROM scheduling.resource_availability a
        WHERE a.resource_id = NEW.resource_id
          AND a.weekday = extract(isodow FROM local_start)
          AND a.starts <= local_start::time
          AND a.ends >= (CASE WHEN local_end::time = TIME '00:00' THEN TIME '24:00' ELSE local_end::time END)) THEN
    RAISE EXCEPTION 'the slot is outside the teacher''s or room''s availability' USING ERRCODE = 'PY015';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION scheduling.check_session_resource() FROM PUBLIC;
CREATE TRIGGER check_session_resource BEFORE INSERT OR UPDATE ON scheduling.session_resource
  FOR EACH ROW EXECUTE FUNCTION scheduling.check_session_resource();

-- A session's resources follow it: moved with it, released when it is cancelled.
CREATE FUNCTION scheduling.follow_session() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE scheduling.session_resource
     SET during = CASE WHEN NEW.starts_at IS NOT NULL AND NEW.ends_at IS NOT NULL
                       THEN tstzrange(NEW.starts_at, NEW.ends_at, '[)') ELSE during END,
         active = NEW.status <> 'cancelled'
   WHERE session_id = NEW.id;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION scheduling.follow_session() FROM PUBLIC;
CREATE TRIGGER follow_session AFTER UPDATE OF starts_at, ends_at, status ON scheduling.session
  FOR EACH ROW EXECUTE FUNCTION scheduling.follow_session();

-- Packages: created when the paid order line is confirmed, spent through a ledger.
CREATE TABLE scheduling.lesson_package (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id           uuid NOT NULL,
  school_id          uuid NOT NULL,
  offering_id        uuid NOT NULL,
  student_person_id  uuid NOT NULL,
  order_line_id      uuid NOT NULL UNIQUE REFERENCES commerce.order_line (id),
  lessons_bought     integer NOT NULL CHECK (lessons_bought > 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (offering_id, school_id) REFERENCES catalog.school_offering (id, school_id),
  FOREIGN KEY (student_person_id, group_id) REFERENCES people.person (id, group_id)
);
CREATE INDEX lesson_package_student_idx ON scheduling.lesson_package (student_person_id);
CREATE INDEX lesson_package_offering_idx ON scheduling.lesson_package (offering_id);

CREATE TABLE scheduling.package_entry (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id              uuid NOT NULL REFERENCES org.education_group (id),
  package_id            uuid NOT NULL REFERENCES scheduling.lesson_package (id),
  kind                  text NOT NULL CHECK (kind IN ('purchase', 'booking', 'returned')),
  delta                 integer NOT NULL,
  booking_id            uuid REFERENCES scheduling.booking (id),
  created_by_person_id  uuid REFERENCES people.person (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'purchase' AND delta > 0 AND booking_id IS NULL)
      OR (kind = 'booking' AND delta = -1 AND booking_id IS NOT NULL)
      OR (kind = 'returned' AND delta = 1 AND booking_id IS NOT NULL)),
  UNIQUE (booking_id, kind)
);
CREATE INDEX package_entry_package_idx ON scheduling.package_entry (package_id);
CREATE INDEX package_entry_created_by_idx ON scheduling.package_entry (created_by_person_id);

CREATE FUNCTION scheduling.append_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '%.% rows are permanent', TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'PY004';
END $$;
REVOKE ALL ON FUNCTION scheduling.append_only() FROM PUBLIC;
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON scheduling.package_entry
  FOR EACH ROW EXECUTE FUNCTION scheduling.append_only();

CREATE FUNCTION scheduling.package_balance(p_package_id uuid) RETURNS integer
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT coalesce(sum(delta), 0)::int FROM scheduling.package_entry WHERE package_id = p_package_id $$;
REVOKE ALL ON FUNCTION scheduling.package_balance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scheduling.package_balance(uuid) TO pyth_api;

-- The paid line of a package becomes the child's package, in the same transaction.
CREATE FUNCTION scheduling.create_package_on_confirmation() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  size int;
  package uuid;
BEGIN
  SELECT pv.package_size INTO size
    FROM catalog.price_version pv
   WHERE pv.id = NEW.price_version_id AND pv.price_unit = 'per_package';
  IF size IS NULL OR NEW.student_person_id IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO scheduling.lesson_package (group_id, school_id, offering_id, student_person_id, order_line_id, lessons_bought)
  VALUES (NEW.group_id, NEW.school_id, NEW.offering_id, NEW.student_person_id, NEW.id, size * NEW.quantity)
  ON CONFLICT (order_line_id) DO NOTHING
  RETURNING id INTO package;
  IF package IS NOT NULL THEN
    INSERT INTO scheduling.package_entry (group_id, package_id, kind, delta)
    VALUES (NEW.group_id, package, 'purchase', size * NEW.quantity);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION scheduling.create_package_on_confirmation() FROM PUBLIC;
CREATE TRIGGER create_package AFTER UPDATE OF status ON commerce.order_line
  FOR EACH ROW WHEN (NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed')
  EXECUTE FUNCTION scheduling.create_package_on_confirmation();

-- Fills each day's shared availability of the teacher and the room with
-- back-to-back slots of p_minutes, skipping any that would overlap an existing
-- slot of either. Runs as the caller: row-level security decides (catalog.manage).
CREATE FUNCTION scheduling.create_lesson_slots(
  p_offering_id uuid, p_teacher_id uuid, p_room_id uuid, p_from date, p_to date, p_minutes integer
) RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  o record;
  zone text;
  d date;
  w record;
  t time;
  starts timestamptz;
  ends timestamptz;
  slot uuid;
  created int := 0;
BEGIN
  IF p_minutes NOT BETWEEN 15 AND 240 OR p_to < p_from OR p_to - p_from > 92 THEN
    RAISE EXCEPTION 'slots are 15-240 minutes, over at most 93 days' USING ERRCODE = '22023';
  END IF;
  SELECT so.id, so.group_id, so.school_id, d2.kind INTO o
    FROM catalog.school_offering so JOIN catalog.service_definition d2 ON d2.id = so.service_definition_id
   WHERE so.id = p_offering_id;
  IF NOT FOUND OR o.kind <> 'lesson' THEN
    RAISE EXCEPTION 'slots are for lesson offerings' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM scheduling.resource WHERE id = p_teacher_id AND kind = 'teacher' AND school_id = o.school_id)
     OR NOT EXISTS (SELECT 1 FROM scheduling.resource WHERE id = p_room_id AND kind = 'room' AND school_id = o.school_id) THEN
    RAISE EXCEPTION 'choose a teacher and a room of this school' USING ERRCODE = '23503';
  END IF;
  SELECT time_zone INTO zone FROM org.school WHERE id = o.school_id;

  FOR d IN SELECT g::date FROM generate_series(p_from, p_to, interval '1 day') g LOOP
    FOR w IN
      SELECT greatest(ta.starts, ra.starts) AS starts, least(ta.ends, ra.ends) AS ends
        FROM scheduling.resource_availability ta
        JOIN scheduling.resource_availability ra
          ON ra.resource_id = p_room_id AND ra.weekday = ta.weekday
         AND ra.starts < ta.ends AND ta.starts < ra.ends
       WHERE ta.resource_id = p_teacher_id AND ta.weekday = extract(isodow FROM d)
       ORDER BY 1
    LOOP
      t := w.starts;
      WHILE t + make_interval(mins => p_minutes) <= w.ends AND t + make_interval(mins => p_minutes) > t LOOP
        starts := (d + t) AT TIME ZONE zone;
        ends := starts + make_interval(mins => p_minutes);
        IF starts > now() THEN
          BEGIN
            INSERT INTO scheduling.session
              (group_id, school_id, offering_id, starts_at, ends_at, capacity, booking_cutoff_at, cancellation_cutoff_at)
            VALUES (o.group_id, o.school_id, o.id, starts, ends, 1, starts - interval '2 hours', starts - interval '24 hours')
            RETURNING id INTO slot;
            INSERT INTO scheduling.session_resource (session_id, resource_id, group_id, school_id, during)
            VALUES (slot, p_teacher_id, o.group_id, o.school_id, tstzrange(starts, ends, '[)')),
                   (slot, p_room_id, o.group_id, o.school_id, tstzrange(starts, ends, '[)'));
            created := created + 1;
          EXCEPTION WHEN exclusion_violation THEN
            NULL;  -- the teacher or the room is already taken then: no slot
          END;
        END IF;
        t := t + make_interval(mins => p_minutes);
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN created;
END $$;
REVOKE ALL ON FUNCTION scheduling.create_lesson_slots(uuid, uuid, uuid, date, date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scheduling.create_lesson_slots(uuid, uuid, uuid, date, date, integer) TO pyth_api;

-- A family (or staff) spends one lesson of the child's package on a slot.
CREATE FUNCTION scheduling.book_lesson(p_session_id uuid, p_student_id uuid, p_package_id uuid) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  me constant uuid := app.current_person_id();
  p record;
  s record;
  booking uuid;
BEGIN
  SELECT * INTO p FROM scheduling.lesson_package WHERE id = p_package_id FOR UPDATE;
  IF me IS NULL OR NOT FOUND OR p.student_person_id <> p_student_id
     OR NOT (access.is_guardian_of(p_student_id, 'manage_bookings') OR access.has_permission('bookings.manage', p.school_id)) THEN
    RAISE EXCEPTION 'no such package for this child' USING ERRCODE = 'P0002';
  END IF;
  SELECT x.id, x.offering_id, x.school_id, x.status, x.starts_at, x.booking_cutoff_at INTO s
    FROM scheduling.session x WHERE x.id = p_session_id;
  IF NOT FOUND OR s.offering_id <> p.offering_id THEN
    RAISE EXCEPTION 'this slot is not for the lessons in the package' USING ERRCODE = '23503';
  END IF;
  IF s.status <> 'scheduled' OR s.starts_at <= now() OR (s.booking_cutoff_at IS NOT NULL AND s.booking_cutoff_at <= now()) THEN
    RAISE EXCEPTION 'this slot is no longer open for booking' USING ERRCODE = 'PY007';
  END IF;
  IF scheduling.package_balance(p_package_id) < 1 THEN
    RAISE EXCEPTION 'the package has no lessons left' USING ERRCODE = 'PY014';
  END IF;
  -- The capacity trigger locks the slot and refuses a second booking (PY002);
  -- the eligibility trigger checks the child (PY012).
  INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, confirmed_at, created_by_person_id)
  VALUES (p.group_id, s.school_id, s.id, p_student_id, 'confirmed', now(), me)
  RETURNING id INTO booking;
  INSERT INTO scheduling.package_entry (group_id, package_id, kind, delta, booking_id, created_by_person_id)
  VALUES (p.group_id, p_package_id, 'booking', -1, booking, me);
  RETURN booking;
END $$;
REVOKE ALL ON FUNCTION scheduling.book_lesson(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scheduling.book_lesson(uuid, uuid, uuid) TO pyth_api;

-- Before the cutoff the lesson goes back to the package; after it, it counts as used.
-- Either way the slot is free again. Returns 'returned' or 'used'.
CREATE FUNCTION scheduling.cancel_lesson(p_booking_id uuid) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  me constant uuid := app.current_person_id();
  b record;
  in_time boolean;
BEGIN
  SELECT bk.id, bk.group_id, bk.school_id, bk.student_person_id, bk.status, s.starts_at, s.cancellation_cutoff_at, e.package_id
    INTO b
    FROM scheduling.booking bk
    JOIN scheduling.session s ON s.id = bk.session_id
    JOIN scheduling.package_entry e ON e.booking_id = bk.id AND e.kind = 'booking'
   WHERE bk.id = p_booking_id
   FOR UPDATE OF bk;
  IF me IS NULL OR NOT FOUND
     OR NOT (access.is_guardian_of(b.student_person_id, 'manage_bookings') OR access.has_permission('bookings.manage', b.school_id)) THEN
    RAISE EXCEPTION 'no such lesson booking' USING ERRCODE = 'P0002';
  END IF;
  IF b.status <> 'confirmed' OR b.starts_at <= now() THEN
    RAISE EXCEPTION 'only a booked lesson that has not started can be cancelled' USING ERRCODE = 'PY007';
  END IF;
  in_time := b.cancellation_cutoff_at IS NULL OR now() < b.cancellation_cutoff_at;
  UPDATE scheduling.booking
     SET status = 'cancelled', cancelled_at = now(), cancelled_by_person_id = me,
         cancellation_reason = CASE WHEN in_time THEN 'cancelled before the cutoff: lesson returned'
                                    ELSE 'cancelled after the cutoff: lesson counts as used' END
   WHERE id = p_booking_id;
  IF in_time THEN
    INSERT INTO scheduling.package_entry (group_id, package_id, kind, delta, booking_id, created_by_person_id)
    VALUES (b.group_id, b.package_id, 'returned', 1, p_booking_id, me);
    RETURN 'returned';
  END IF;
  RETURN 'used';
END $$;
REVOKE ALL ON FUNCTION scheduling.cancel_lesson(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scheduling.cancel_lesson(uuid) TO pyth_api;

-- Triggers, row-level security and grants.
CREATE TRIGGER set_updated_at BEFORE UPDATE ON scheduling.resource FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON scheduling.resource              FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON scheduling.resource_availability FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON scheduling.lesson_package        FOR EACH ROW EXECUTE FUNCTION audit.log_change();

ALTER TABLE scheduling.resource ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling.resource_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling.session_resource ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling.lesson_package ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling.package_entry ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT (id, group_id, school_id, kind, display_name, person_id), UPDATE (display_name, status)
  ON scheduling.resource TO pyth_api;
GRANT SELECT, INSERT (id, group_id, school_id, resource_id, weekday, starts, ends), DELETE
  ON scheduling.resource_availability TO pyth_api;
GRANT SELECT, INSERT (session_id, resource_id, group_id, school_id, during) ON scheduling.session_resource TO pyth_api;
GRANT SELECT ON scheduling.lesson_package, scheduling.package_entry TO pyth_api;

-- Names of teachers and rooms, their hours and their slots are visible in the
-- group (parents choose a slot by them); changing them needs catalog.manage.
CREATE POLICY read ON scheduling.resource FOR SELECT TO pyth_api USING (group_id = access.current_group_id());
CREATE POLICY manage_insert ON scheduling.resource FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('catalog.manage', school_id));
CREATE POLICY manage_update ON scheduling.resource FOR UPDATE TO pyth_api
  USING (access.has_permission('catalog.manage', school_id)) WITH CHECK (access.has_permission('catalog.manage', school_id));
CREATE POLICY read ON scheduling.resource_availability FOR SELECT TO pyth_api USING (group_id = access.current_group_id());
CREATE POLICY manage_insert ON scheduling.resource_availability FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('catalog.manage', school_id));
CREATE POLICY manage_delete ON scheduling.resource_availability FOR DELETE TO pyth_api
  USING (access.has_permission('catalog.manage', school_id));
CREATE POLICY read ON scheduling.session_resource FOR SELECT TO pyth_api USING (group_id = access.current_group_id());
CREATE POLICY manage_insert ON scheduling.session_resource FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('catalog.manage', school_id));
-- Packages: the child's guardians and the school's staff who read bookings or finance.
CREATE POLICY read ON scheduling.lesson_package FOR SELECT TO pyth_api
  USING (access.is_guardian_of(student_person_id, 'view') OR access.has_permission('bookings.read', school_id)
         OR access.has_permission('finance.read', school_id));
CREATE POLICY read ON scheduling.package_entry FOR SELECT TO pyth_api
  USING (EXISTS (SELECT 1 FROM scheduling.lesson_package p WHERE p.id = package_id));

-- migrate:down
DROP FUNCTION scheduling.cancel_lesson(uuid);
DROP FUNCTION scheduling.book_lesson(uuid, uuid, uuid);
DROP FUNCTION scheduling.create_lesson_slots(uuid, uuid, uuid, date, date, integer);
DROP TRIGGER create_package ON commerce.order_line;
DROP FUNCTION scheduling.create_package_on_confirmation();
DROP FUNCTION scheduling.package_balance(uuid);
DROP TABLE scheduling.package_entry;
DROP FUNCTION scheduling.append_only();
DROP TABLE scheduling.lesson_package;
DROP TRIGGER follow_session ON scheduling.session;
DROP FUNCTION scheduling.follow_session();
DROP TABLE scheduling.session_resource;
DROP FUNCTION scheduling.check_session_resource();
DROP TABLE scheduling.resource_availability;
DROP TABLE scheduling.resource;
