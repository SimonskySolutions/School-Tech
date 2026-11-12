-- migrate:up

-- The daily class register and grades. Families see their own child's; teachers
-- and school leaders keep them for the school's classes. Grades use the Bulgarian
-- scale, 2 to 6.

CREATE SCHEMA academic;
REVOKE ALL ON SCHEMA academic FROM PUBLIC;
GRANT USAGE ON SCHEMA academic TO pyth_api;

INSERT INTO access.permission (code, description) VALUES
  ('class.teach', 'Take the class register and give grades in the school''s classes');
INSERT INTO access.role_permission (role_code, permission_code) VALUES
  ('teacher', 'class.teach'), ('principal', 'class.teach'), ('school_admin', 'class.teach');

CREATE TABLE academic.attendance (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id           uuid NOT NULL REFERENCES org.education_group (id),
  school_id          uuid NOT NULL,
  class_id           uuid NOT NULL,
  student_person_id  uuid NOT NULL REFERENCES people.person (id),
  day                date NOT NULL,
  status             text NOT NULL CHECK (status IN ('present', 'late', 'absent', 'excused')),
  marked_by          uuid REFERENCES people.person (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (class_id, school_id) REFERENCES scheduling.school_class (id, school_id),
  UNIQUE (class_id, student_person_id, day)
);
CREATE INDEX attendance_student_idx ON academic.attendance (student_person_id, day);
CREATE INDEX attendance_school_idx ON academic.attendance (school_id);
CREATE INDEX attendance_marked_by_idx ON academic.attendance (marked_by);

CREATE TABLE academic.grade (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id           uuid NOT NULL REFERENCES org.education_group (id),
  school_id          uuid NOT NULL,
  class_id           uuid NOT NULL,
  student_person_id  uuid NOT NULL REFERENCES people.person (id),
  subject            text NOT NULL CHECK (length(subject) BETWEEN 1 AND 80),
  term               smallint NOT NULL CHECK (term IN (1, 2)),
  value              smallint NOT NULL CHECK (value BETWEEN 2 AND 6),
  given_on           date NOT NULL DEFAULT current_date,
  given_by           uuid REFERENCES people.person (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (class_id, school_id) REFERENCES scheduling.school_class (id, school_id)
);
CREATE INDEX grade_class_idx ON academic.grade (class_id);
CREATE INDEX grade_student_idx ON academic.grade (student_person_id);
CREATE INDEX grade_school_idx ON academic.grade (school_id);
CREATE INDEX grade_given_by_idx ON academic.grade (given_by);

-- Only a child who sits in the class can be marked or graded in it.
CREATE FUNCTION academic.check_in_class() RETURNS trigger
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM people.enrolment
     WHERE class_id = NEW.class_id AND student_person_id = NEW.student_person_id
       AND status IN ('active', 'suspended')
  ) THEN
    RAISE EXCEPTION 'this child is not in this class' USING ERRCODE = 'PY029';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION academic.check_in_class() FROM PUBLIC;
CREATE TRIGGER check_in_class BEFORE INSERT OR UPDATE ON academic.attendance
  FOR EACH ROW EXECUTE FUNCTION academic.check_in_class();
CREATE TRIGGER check_in_class BEFORE INSERT OR UPDATE ON academic.grade
  FOR EACH ROW EXECUTE FUNCTION academic.check_in_class();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON academic.attendance FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON academic.attendance FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON academic.grade      FOR EACH ROW EXECUTE FUNCTION audit.log_change();

ALTER TABLE academic.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic.grade ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT (id, group_id, school_id, class_id, student_person_id, day, status, marked_by),
      UPDATE (status, marked_by)
  ON academic.attendance TO pyth_api;
GRANT SELECT, INSERT (id, group_id, school_id, class_id, student_person_id, subject, term, value, given_on, given_by), DELETE
  ON academic.grade TO pyth_api;

CREATE POLICY read ON academic.attendance FOR SELECT TO pyth_api
  USING (access.is_guardian_of(student_person_id, 'view') OR access.has_permission('class.teach', school_id));
CREATE POLICY keep_insert ON academic.attendance FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('class.teach', school_id));
CREATE POLICY keep_update ON academic.attendance FOR UPDATE TO pyth_api
  USING (access.has_permission('class.teach', school_id))
  WITH CHECK (access.has_permission('class.teach', school_id));

CREATE POLICY read ON academic.grade FOR SELECT TO pyth_api
  USING (access.is_guardian_of(student_person_id, 'view') OR access.has_permission('class.teach', school_id));
CREATE POLICY keep_insert ON academic.grade FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('class.teach', school_id));
CREATE POLICY keep_delete ON academic.grade FOR DELETE TO pyth_api
  USING (access.has_permission('class.teach', school_id));

-- migrate:down
DROP TABLE academic.grade;
DROP TABLE academic.attendance;
DROP FUNCTION academic.check_in_class();
DROP SCHEMA academic;
DELETE FROM access.role_permission WHERE permission_code = 'class.teach';
DELETE FROM access.permission WHERE code = 'class.teach';
