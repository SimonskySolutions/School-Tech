-- migrate:up

-- Activity eligibility and attendance (M4.2).
--
-- Eligibility: catalog.school_offering.eligibility has existed since M0 but
-- nothing read it. It now has a fixed shape, and every new booking is checked
-- against it here, so no request can book a child outside it:
--   {"grades": ["2", "3"], "min_age": 7, "max_age": 11}   (each part optional)
-- grades: the child's grade at the offering's school (people.enrolment.grade_level);
-- ages: whole years on the day of the session, in the school's time zone.

CREATE FUNCTION catalog.is_valid_eligibility(p_rules jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT jsonb_typeof(p_rules) = 'object'
     AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p_rules) k WHERE k NOT IN ('grades', 'min_age', 'max_age'))
     AND (NOT p_rules ? 'grades' OR (
           jsonb_typeof(p_rules -> 'grades') = 'array'
           AND jsonb_array_length(p_rules -> 'grades') BETWEEN 1 AND 20
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_rules -> 'grades') g
                            WHERE jsonb_typeof(g) <> 'string' OR length(g #>> '{}') NOT BETWEEN 1 AND 40)))
     AND (NOT p_rules ? 'min_age' OR (jsonb_typeof(p_rules -> 'min_age') = 'number'
           AND (p_rules ->> 'min_age')::numeric IN (SELECT generate_series(0, 25))))
     AND (NOT p_rules ? 'max_age' OR (jsonb_typeof(p_rules -> 'max_age') = 'number'
           AND (p_rules ->> 'max_age')::numeric IN (SELECT generate_series(0, 25))))
     AND (NOT (p_rules ? 'min_age' AND p_rules ? 'max_age')
          OR (p_rules ->> 'min_age')::int <= (p_rules ->> 'max_age')::int)
$$;
REVOKE ALL ON FUNCTION catalog.is_valid_eligibility(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.is_valid_eligibility(jsonb) TO pyth_api, pyth_worker;

ALTER TABLE catalog.school_offering
  ADD CONSTRAINT school_offering_eligibility_shape CHECK (catalog.is_valid_eligibility(eligibility));

-- Why this child may not take this offering on this day, or NULL if they may.
-- About a child the caller may not see it says nothing (NULL): row-level
-- security then refuses the booking itself, and nothing about the child leaks.
CREATE FUNCTION catalog.eligibility_problem(p_offering_id uuid, p_student_id uuid, p_on date) RETURNS text
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  rules jsonb;
  school uuid;
  grade text;
  born date;
  age int;
BEGIN
  IF app.current_person_id() IS NOT NULL
     AND NOT access.is_guardian_of(p_student_id, 'view')
     AND NOT access.has_permission_for_person('people.read', p_student_id) THEN
    RETURN NULL;
  END IF;
  SELECT o.eligibility, o.school_id INTO rules, school FROM catalog.school_offering o WHERE o.id = p_offering_id;
  IF rules IS NULL THEN
    RETURN 'no such offering';
  END IF;
  IF rules ? 'grades' THEN
    SELECT e.grade_level INTO grade
      FROM people.enrolment e
     WHERE e.student_person_id = p_student_id AND e.school_id = school AND e.status = 'active'
       AND e.start_date <= p_on AND (e.end_date IS NULL OR e.end_date > p_on)
     ORDER BY e.start_date DESC LIMIT 1;
    IF grade IS NULL OR NOT (rules -> 'grades') ? grade THEN
      RETURN 'for grades ' || (SELECT string_agg(g, ', ') FROM jsonb_array_elements_text(rules -> 'grades') g) || ' only';
    END IF;
  END IF;
  IF rules ? 'min_age' OR rules ? 'max_age' THEN
    SELECT p.date_of_birth INTO born FROM people.person p WHERE p.id = p_student_id;
    IF born IS NULL THEN
      RETURN 'needs the child''s date of birth, which the school has not recorded';
    END IF;
    age := extract(year FROM age(p_on, born))::int;
    IF age < coalesce((rules ->> 'min_age')::int, 0) OR age > coalesce((rules ->> 'max_age')::int, 200) THEN
      RETURN 'for ages ' || coalesce(rules ->> 'min_age', '0') || '–' || coalesce(rules ->> 'max_age', 'any') || ' only';
    END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION catalog.eligibility_problem(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.eligibility_problem(uuid, uuid, date) TO pyth_api;

CREATE FUNCTION scheduling.check_eligibility() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  offering uuid;
  on_day date;
  problem text;
BEGIN
  SELECT s.offering_id, coalesce(s.service_date, (s.starts_at AT TIME ZONE sc.time_zone)::date)
    INTO offering, on_day
    FROM scheduling.session s JOIN org.school sc ON sc.id = s.school_id
   WHERE s.id = NEW.session_id;
  IF offering IS NULL THEN
    RETURN NEW;  -- no such session: check_session_open refuses it
  END IF;
  problem :=catalog.eligibility_problem(offering, NEW.student_person_id, on_day);
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'not eligible: %', problem USING ERRCODE = 'PY012';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION scheduling.check_eligibility() FROM PUBLIC;
CREATE TRIGGER check_eligibility BEFORE INSERT ON scheduling.booking
  FOR EACH ROW EXECUTE FUNCTION scheduling.check_eligibility();

-- Attendance: who marked it and when. Staff with attendance.mark at the school
-- mark a paid booking attended or absent, only once the session has started,
-- and only through scheduling.mark_attendance.
INSERT INTO access.permission (code, description) VALUES
  ('attendance.mark', 'Mark children attended or absent on registers');
INSERT INTO access.role_permission (role_code, permission_code) VALUES
  ('school_life_coordinator', 'attendance.mark'), ('principal', 'attendance.mark'),
  ('school_admin', 'attendance.mark'), ('teacher', 'attendance.mark');

ALTER TABLE scheduling.booking
  ADD COLUMN attendance_marked_by_person_id uuid REFERENCES people.person (id),
  ADD COLUMN attendance_marked_at timestamptz,
  ADD CONSTRAINT booking_attendance_marked_together
    CHECK ((attendance_marked_by_person_id IS NULL) = (attendance_marked_at IS NULL));
CREATE INDEX booking_attendance_marked_by_idx ON scheduling.booking (attendance_marked_by_person_id);

CREATE FUNCTION scheduling.mark_attendance(p_booking_id uuid, p_status text) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  b record;
BEGIN
  IF p_status NOT IN ('attended', 'absent') THEN
    RAISE EXCEPTION 'attendance is attended or absent' USING ERRCODE = '22023';
  END IF;
  SELECT bk.id, bk.school_id, bk.status, coalesce(s.starts_at, (s.service_date::timestamp AT TIME ZONE sc.time_zone)) AS starts
    INTO b
    FROM scheduling.booking bk
    JOIN scheduling.session s ON s.id = bk.session_id
    JOIN org.school sc ON sc.id = bk.school_id
   WHERE bk.id = p_booking_id AND bk.group_id = access.current_group_id()
   FOR UPDATE OF bk;
  IF NOT FOUND OR NOT access.has_permission('bookings.read', b.school_id) THEN
    RAISE EXCEPTION 'no such booking' USING ERRCODE = 'P0002';
  END IF;
  IF NOT access.has_permission('attendance.mark', b.school_id) THEN
    RAISE EXCEPTION 'not permitted to mark attendance at this school' USING ERRCODE = '42501';
  END IF;
  IF b.starts > now() THEN
    RAISE EXCEPTION 'the session has not started yet' USING ERRCODE = 'PY013';
  END IF;
  IF b.status NOT IN ('confirmed', 'attended', 'absent') THEN
    RAISE EXCEPTION 'only paid bookings are on the register' USING ERRCODE = 'PY001';
  END IF;
  UPDATE scheduling.booking
     SET status = p_status, attendance_marked_by_person_id = app.current_person_id(), attendance_marked_at = now()
   WHERE id = p_booking_id;
  RETURN p_status;
END $$;
REVOKE ALL ON FUNCTION scheduling.mark_attendance(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scheduling.mark_attendance(uuid, text) TO pyth_api;

-- migrate:down
DROP FUNCTION scheduling.mark_attendance(uuid, text);
DROP INDEX scheduling.booking_attendance_marked_by_idx;
ALTER TABLE scheduling.booking
  DROP CONSTRAINT booking_attendance_marked_together,
  DROP COLUMN attendance_marked_at,
  DROP COLUMN attendance_marked_by_person_id;
DELETE FROM access.role_permission WHERE permission_code = 'attendance.mark';
DELETE FROM access.permission WHERE code = 'attendance.mark';
DROP TRIGGER check_eligibility ON scheduling.booking;
DROP FUNCTION scheduling.check_eligibility();
DROP FUNCTION catalog.eligibility_problem(uuid, uuid, date);
ALTER TABLE catalog.school_offering DROP CONSTRAINT school_offering_eligibility_shape;
DROP FUNCTION catalog.is_valid_eligibility(jsonb);
