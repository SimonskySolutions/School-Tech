-- migrate:up

-- A family can queue for a full club. When every meeting still to come has a
-- seat again, the first child waiting is told; the place is theirs to book, and
-- nobody else is told until they book it or leave the list.

INSERT INTO notify.kind (code, essential, description) VALUES
  ('waitlist.place_free', false, 'A place is free in a club your child is waiting for');

CREATE TABLE scheduling.waiting_entry (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id           uuid NOT NULL REFERENCES org.education_group (id),
  school_id          uuid NOT NULL,
  offering_id        uuid NOT NULL,
  student_person_id  uuid NOT NULL REFERENCES people.person (id),
  added_by           uuid REFERENCES people.person (id),
  status             text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'place_free', 'booked', 'left')),
  told_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (offering_id, school_id) REFERENCES catalog.school_offering (id, school_id)
);
CREATE UNIQUE INDEX waiting_entry_one_live ON scheduling.waiting_entry (offering_id, student_person_id)
  WHERE status IN ('waiting', 'place_free');
CREATE INDEX waiting_entry_queue_idx ON scheduling.waiting_entry (offering_id, created_at);
CREATE INDEX waiting_entry_student_idx ON scheduling.waiting_entry (student_person_id);
CREATE INDEX waiting_entry_school_idx ON scheduling.waiting_entry (school_id);
CREATE INDEX waiting_entry_added_by_idx ON scheduling.waiting_entry (added_by);

-- Tells the next child in the queue, if every meeting to come has a seat and
-- nobody is holding the offer already.
CREATE FUNCTION scheduling.offer_next_place(p_offering_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  next_entry scheduling.waiting_entry%ROWTYPE;
BEGIN
  IF EXISTS (
    SELECT 1 FROM scheduling.session s
     WHERE s.offering_id = p_offering_id AND s.status = 'scheduled'
       AND coalesce(s.starts_at, s.service_date::timestamptz) > now()
       AND s.capacity IS NOT NULL AND s.reserved_count + s.confirmed_count >= s.capacity
  ) OR EXISTS (
    SELECT 1 FROM scheduling.waiting_entry WHERE offering_id = p_offering_id AND status = 'place_free'
  ) THEN
    RETURN;
  END IF;
  SELECT * INTO next_entry FROM scheduling.waiting_entry
   WHERE offering_id = p_offering_id AND status = 'waiting'
   ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF FOUND THEN
    UPDATE scheduling.waiting_entry SET status = 'place_free', told_at = now() WHERE id = next_entry.id;
    PERFORM notify.note_event(next_entry.group_id, 'scheduling.waiting_entry', next_entry.id,
                              'scheduling.waiting_entry.place_free', jsonb_build_object('entry_id', next_entry.id));
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION scheduling.offer_next_place(uuid) FROM PUBLIC;

CREATE FUNCTION scheduling.seat_freed() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM scheduling.offer_next_place(NEW.offering_id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION scheduling.seat_freed() FROM PUBLIC;
CREATE TRIGGER seat_freed AFTER UPDATE OF reserved_count, confirmed_count ON scheduling.session
  FOR EACH ROW WHEN (NEW.reserved_count + NEW.confirmed_count < OLD.reserved_count + OLD.confirmed_count)
  EXECUTE FUNCTION scheduling.seat_freed();

-- Booking the club takes the child off the list.
CREATE FUNCTION scheduling.close_waiting_entry() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE scheduling.waiting_entry w SET status = 'booked'
    FROM scheduling.session s
   WHERE s.id = NEW.session_id AND w.offering_id = s.offering_id
     AND w.student_person_id = NEW.student_person_id AND w.status IN ('waiting', 'place_free');
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION scheduling.close_waiting_entry() FROM PUBLIC;
CREATE TRIGGER close_waiting_entry AFTER INSERT ON scheduling.booking
  FOR EACH ROW EXECUTE FUNCTION scheduling.close_waiting_entry();

-- A family joins only for a child they may book for, and only when the club is full.
CREATE FUNCTION scheduling.join_waiting_list(p_offering_id uuid, p_student_id uuid) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  offering catalog.school_offering%ROWTYPE;
  entry_id uuid;
BEGIN
  IF NOT access.is_guardian_of(p_student_id, 'manage_bookings') THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO offering FROM catalog.school_offering WHERE id = p_offering_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such club' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM scheduling.session s
     WHERE s.offering_id = p_offering_id AND s.status = 'scheduled'
       AND coalesce(s.starts_at, s.service_date::timestamptz) > now()
       AND s.capacity IS NOT NULL AND s.reserved_count + s.confirmed_count >= s.capacity
  ) THEN
    RAISE EXCEPTION 'this club has places' USING ERRCODE = 'PY031';
  END IF;
  INSERT INTO scheduling.waiting_entry (group_id, school_id, offering_id, student_person_id, added_by)
  VALUES (offering.group_id, offering.school_id, p_offering_id, p_student_id, app.current_person_id())
  RETURNING id INTO entry_id;
  RETURN entry_id;
END;
$$;
REVOKE ALL ON FUNCTION scheduling.join_waiting_list(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scheduling.join_waiting_list(uuid, uuid) TO pyth_api;

-- Leaving the list passes a free place to the next child.
CREATE FUNCTION scheduling.leave_waiting_list(p_entry_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  entry scheduling.waiting_entry%ROWTYPE;
BEGIN
  SELECT * INTO entry FROM scheduling.waiting_entry
   WHERE id = p_entry_id AND status IN ('waiting', 'place_free') FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such place in the queue' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (access.is_guardian_of(entry.student_person_id, 'manage_bookings')
          OR access.has_permission('bookings.manage', entry.school_id)) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  UPDATE scheduling.waiting_entry SET status = 'left' WHERE id = p_entry_id;
  PERFORM scheduling.offer_next_place(entry.offering_id);
END;
$$;
REVOKE ALL ON FUNCTION scheduling.leave_waiting_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scheduling.leave_waiting_list(uuid) TO pyth_api;

-- A place in the queue. A family sees only its own entry, so the counting is done here.
CREATE FUNCTION scheduling.queue_position(p_entry_id uuid) RETURNS integer
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT count(*)::integer
    FROM scheduling.waiting_entry w
    JOIN scheduling.waiting_entry q ON q.offering_id = w.offering_id
   WHERE w.id = p_entry_id AND q.status IN ('waiting', 'place_free')
     AND (q.created_at, q.id) <= (w.created_at, w.id)
$$;
REVOKE ALL ON FUNCTION scheduling.queue_position(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scheduling.queue_position(uuid) TO pyth_api;

-- The guardians who can book get the news.
CREATE FUNCTION notify.on_place_free(p_entry_id uuid) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  g record;
  v_count integer := 0;
BEGIN
  FOR g IN
    SELECT w.group_id, gr.guardian_person_id, w.student_person_id, o.name AS offering_name, ch.given_name
      FROM scheduling.waiting_entry w
      JOIN catalog.school_offering o ON o.id = w.offering_id
      JOIN people.person ch ON ch.id = w.student_person_id
      JOIN people.guardian_relationship gr ON gr.student_person_id = w.student_person_id
     WHERE w.id = p_entry_id AND gr.status = 'active' AND gr.can_manage_bookings
  LOOP
    IF notify.queue_message(g.group_id, g.guardian_person_id, 'waitlist.place_free', 'place:' || p_entry_id,
                            jsonb_build_object('childName', g.given_name, 'offeringName', g.offering_name,
                                               'studentId', g.student_person_id)) IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION notify.on_place_free(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify.on_place_free(uuid) TO pyth_worker;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON scheduling.waiting_entry FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON scheduling.waiting_entry FOR EACH ROW EXECUTE FUNCTION audit.log_change();

ALTER TABLE scheduling.waiting_entry ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON scheduling.waiting_entry TO pyth_api;
CREATE POLICY read ON scheduling.waiting_entry FOR SELECT TO pyth_api
  USING (access.is_guardian_of(student_person_id, 'view')
         OR access.has_permission('enrolment.read', school_id)
         OR access.has_permission('bookings.read', school_id));

-- migrate:down
DROP TRIGGER close_waiting_entry ON scheduling.booking;
DROP TRIGGER seat_freed ON scheduling.session;
DROP FUNCTION notify.on_place_free(uuid);
DROP FUNCTION scheduling.queue_position(uuid);
DROP FUNCTION scheduling.leave_waiting_list(uuid);
DROP FUNCTION scheduling.join_waiting_list(uuid, uuid);
DROP FUNCTION scheduling.close_waiting_entry();
DROP FUNCTION scheduling.seat_freed();
DROP FUNCTION scheduling.offer_next_place(uuid);
DROP TABLE scheduling.waiting_entry;
DELETE FROM notify.message WHERE kind_code = 'waitlist.place_free';
DELETE FROM notify.preference WHERE kind_code = 'waitlist.place_free';
DELETE FROM notify.kind WHERE code = 'waitlist.place_free';
