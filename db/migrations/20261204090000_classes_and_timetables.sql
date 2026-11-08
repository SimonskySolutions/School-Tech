-- migrate:up

-- Classes and the weekly timetable. A class is a real thing with a size limit
-- now, not only a label on an enrolment; the database refuses a child beyond
-- the limit and a teacher, room or class in two places at once.

INSERT INTO access.permission (code, description) VALUES
  ('timetable.manage', 'Create classes and set the school''s weekly timetable');
INSERT INTO access.role_permission (role_code, permission_code) VALUES
  ('group_admin', 'timetable.manage'), ('principal', 'timetable.manage'), ('school_admin', 'timetable.manage');

CREATE TABLE scheduling.school_class (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id         uuid NOT NULL,
  school_id        uuid NOT NULL,
  academic_year    text NOT NULL CHECK (academic_year ~ '^[0-9]{4}/[0-9]{4}$'),
  grade_level      text NOT NULL CHECK (length(grade_level) BETWEEN 1 AND 40),
  label            text NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  capacity         integer NOT NULL CHECK (capacity BETWEEN 1 AND 60),
  form_teacher_id  uuid,
  home_room_id     uuid,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, academic_year, label),
  UNIQUE (id, school_id),
  UNIQUE (id, school_id, academic_year),
  FOREIGN KEY (school_id, group_id) REFERENCES org.school (id, group_id),
  FOREIGN KEY (form_teacher_id, school_id) REFERENCES scheduling.resource (id, school_id),
  FOREIGN KEY (home_room_id, school_id) REFERENCES scheduling.resource (id, school_id)
);
CREATE INDEX school_class_form_teacher_idx ON scheduling.school_class (form_teacher_id);
CREATE INDEX school_class_home_room_idx ON scheduling.school_class (home_room_id);

ALTER TABLE people.enrolment ADD COLUMN class_id uuid,
  ADD FOREIGN KEY (class_id, school_id) REFERENCES scheduling.school_class (id, school_id);
CREATE INDEX enrolment_class_idx ON people.enrolment (class_id);
COMMENT ON COLUMN people.enrolment.class_id IS
  'The class the child sits in. Set by place_in_class from class_label when a class of that name exists, so class_label stays in step.';
GRANT INSERT (class_id), UPDATE (class_id) ON people.enrolment TO pyth_api;

-- The bell schedule of a school: the same lesson periods every day.
CREATE TABLE scheduling.timetable_period (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id    uuid NOT NULL,
  school_id   uuid NOT NULL,
  position    smallint NOT NULL CHECK (position BETWEEN 1 AND 12),
  starts      time NOT NULL,
  ends        time NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, position),
  UNIQUE (id, school_id),
  FOREIGN KEY (school_id, group_id) REFERENCES org.school (id, group_id),
  CHECK (ends > starts)
);

-- One lesson in the week. The three UNIQUE constraints are the guarantee that a
-- class, a teacher and a room are each in one place in a period.
CREATE TABLE scheduling.timetable_entry (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id       uuid NOT NULL REFERENCES org.education_group (id),
  school_id      uuid NOT NULL,
  academic_year  text NOT NULL,
  class_id       uuid NOT NULL,
  weekday        smallint NOT NULL CHECK (weekday BETWEEN 1 AND 5),
  period_id      uuid NOT NULL,
  subject        text NOT NULL CHECK (length(subject) BETWEEN 1 AND 80),
  teacher_id     uuid NOT NULL,
  room_id        uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (class_id, school_id, academic_year) REFERENCES scheduling.school_class (id, school_id, academic_year),
  FOREIGN KEY (period_id, school_id) REFERENCES scheduling.timetable_period (id, school_id),
  FOREIGN KEY (teacher_id, school_id) REFERENCES scheduling.resource (id, school_id),
  FOREIGN KEY (room_id, school_id) REFERENCES scheduling.resource (id, school_id),
  CONSTRAINT timetable_class_free UNIQUE (class_id, weekday, period_id),
  CONSTRAINT timetable_teacher_free UNIQUE (academic_year, teacher_id, weekday, period_id),
  CONSTRAINT timetable_room_free UNIQUE (academic_year, room_id, weekday, period_id)
);
CREATE INDEX timetable_entry_school_idx ON scheduling.timetable_entry (school_id, academic_year);
CREATE INDEX timetable_entry_period_idx ON scheduling.timetable_entry (period_id);
CREATE INDEX timetable_entry_teacher_idx ON scheduling.timetable_entry (teacher_id);
CREATE INDEX timetable_entry_room_idx ON scheduling.timetable_entry (room_id);

-- Puts a child in the class their enrolment names and keeps the class's limit.
-- The class row is locked first, so two admissions at once cannot both take the
-- last seat. A label with no class behind it stays a plain label, as before.
CREATE FUNCTION people.place_in_class() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  chosen scheduling.school_class%ROWTYPE;
  seated integer;
BEGIN
  IF NEW.class_id IS NULL AND NEW.class_label IS NOT NULL THEN
    SELECT id INTO NEW.class_id FROM scheduling.school_class
     WHERE school_id = NEW.school_id AND academic_year = NEW.academic_year AND label = NEW.class_label;
  END IF;
  IF NEW.class_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO chosen FROM scheduling.school_class WHERE id = NEW.class_id AND school_id = NEW.school_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;  -- the foreign key refuses it
  END IF;
  NEW.class_label := chosen.label;
  NEW.grade_level := chosen.grade_level;

  IF NEW.status IN ('active', 'suspended')
     AND (TG_OP = 'INSERT' OR OLD.class_id IS DISTINCT FROM NEW.class_id OR OLD.status NOT IN ('active', 'suspended'))
  THEN
    SELECT count(*) INTO seated FROM people.enrolment
     WHERE class_id = chosen.id AND status IN ('active', 'suspended');
    IF seated >= chosen.capacity THEN
      RAISE EXCEPTION 'class % is full (% of %)', chosen.label, seated, chosen.capacity USING ERRCODE = 'PY027';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION people.place_in_class() FROM PUBLIC;
CREATE TRIGGER place_in_class BEFORE INSERT OR UPDATE OF class_id, class_label, status ON people.enrolment
  FOR EACH ROW EXECUTE FUNCTION people.place_in_class();

-- A class limit cannot go below the children already in the class.
CREATE FUNCTION scheduling.check_class_size() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  seated integer;
BEGIN
  SELECT count(*) INTO seated FROM people.enrolment
   WHERE class_id = NEW.id AND status IN ('active', 'suspended');
  IF NEW.capacity < seated THEN
    RAISE EXCEPTION 'class % already has % children', NEW.label, seated USING ERRCODE = 'PY027';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION scheduling.check_class_size() FROM PUBLIC;
CREATE TRIGGER check_class_size BEFORE UPDATE OF capacity ON scheduling.school_class
  FOR EACH ROW EXECUTE FUNCTION scheduling.check_class_size();

-- A timetable or class names people and rooms of the right kind.
CREATE FUNCTION scheduling.check_timetable_resources() RETURNS trigger
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  teacher uuid;
  room uuid;
BEGIN
  IF TG_TABLE_NAME = 'school_class' THEN
    teacher := NEW.form_teacher_id;
    room := NEW.home_room_id;
  ELSE
    teacher := NEW.teacher_id;
    room := NEW.room_id;
  END IF;
  IF teacher IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM scheduling.resource WHERE id = teacher AND kind = 'teacher' AND status = 'active'
  ) OR room IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM scheduling.resource WHERE id = room AND kind = 'room' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'not a teacher or a room in use here' USING ERRCODE = 'PY028';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION scheduling.check_timetable_resources() FROM PUBLIC;
CREATE TRIGGER check_resources BEFORE INSERT OR UPDATE ON scheduling.school_class
  FOR EACH ROW EXECUTE FUNCTION scheduling.check_timetable_resources();
CREATE TRIGGER check_resources BEFORE INSERT OR UPDATE ON scheduling.timetable_entry
  FOR EACH ROW EXECUTE FUNCTION scheduling.check_timetable_resources();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON scheduling.school_class FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON scheduling.school_class     FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON scheduling.timetable_period FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON scheduling.timetable_entry  FOR EACH ROW EXECUTE FUNCTION audit.log_change();

ALTER TABLE scheduling.school_class ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling.timetable_period ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling.timetable_entry ENABLE ROW LEVEL SECURITY;

GRANT SELECT,
      INSERT (id, group_id, school_id, academic_year, grade_level, label, capacity, form_teacher_id, home_room_id),
      UPDATE (grade_level, capacity, form_teacher_id, home_room_id, status)
  ON scheduling.school_class TO pyth_api;
GRANT SELECT, INSERT (id, group_id, school_id, position, starts, ends), DELETE
  ON scheduling.timetable_period TO pyth_api;
GRANT SELECT, INSERT (id, group_id, school_id, academic_year, class_id, weekday, period_id, subject, teacher_id, room_id), DELETE
  ON scheduling.timetable_entry TO pyth_api;

-- Classes and the timetable are no secret inside the group: families see their
-- child's week and staff plan across schools. Who is in a class is an enrolment,
-- and stays under the enrolment's rules.
CREATE POLICY read ON scheduling.school_class FOR SELECT TO pyth_api USING (group_id = access.current_group_id());
CREATE POLICY manage_insert ON scheduling.school_class FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('timetable.manage', school_id));
CREATE POLICY manage_update ON scheduling.school_class FOR UPDATE TO pyth_api
  USING (access.has_permission('timetable.manage', school_id))
  WITH CHECK (access.has_permission('timetable.manage', school_id));

CREATE POLICY read ON scheduling.timetable_period FOR SELECT TO pyth_api USING (group_id = access.current_group_id());
CREATE POLICY manage_insert ON scheduling.timetable_period FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('timetable.manage', school_id));
CREATE POLICY manage_delete ON scheduling.timetable_period FOR DELETE TO pyth_api
  USING (access.has_permission('timetable.manage', school_id));

CREATE POLICY read ON scheduling.timetable_entry FOR SELECT TO pyth_api USING (group_id = access.current_group_id());
CREATE POLICY manage_insert ON scheduling.timetable_entry FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('timetable.manage', school_id));
CREATE POLICY manage_delete ON scheduling.timetable_entry FOR DELETE TO pyth_api
  USING (access.has_permission('timetable.manage', school_id));

-- migrate:down
DROP TABLE scheduling.timetable_entry;
DROP TABLE scheduling.timetable_period;
DROP TRIGGER place_in_class ON people.enrolment;
ALTER TABLE people.enrolment DROP COLUMN class_id;
DROP TABLE scheduling.school_class;
DROP FUNCTION scheduling.check_timetable_resources();
DROP FUNCTION scheduling.check_class_size();
DROP FUNCTION people.place_in_class();
DELETE FROM access.role_permission WHERE permission_code = 'timetable.manage';
DELETE FROM access.permission WHERE code = 'timetable.manage';
