-- migrate:up

-- Reminders (M7.3, ADR 0031), queued by the worker once a day: a task due
-- tomorrow (once per task and due date), a summary of one's overdue tasks
-- (once a day), the staff whose qualifications or record checks need seeing
-- to (to the school's principal and administrators, once a week) and an
-- admission offer with three days or less left to answer (once per offer).
-- Each is queued once per person and thing by notify.queue_message.

INSERT INTO notify.kind (code, essential, description) VALUES
  ('task.due', false, 'A task of yours is due tomorrow'),
  ('task.overdue', false, 'A summary of your overdue tasks, once a day'),
  ('staff.renewals', false, 'Staff qualifications and record checks to see to, once a week'),
  ('offer.expiring', true, 'An offer of a place is about to expire');

-- The same rule as the staff page (M6.2): employed here now without a valid
-- check or with one ending within 60 days; a teacher without a valid licence;
-- a qualification expired or ending within 60 days.
CREATE FUNCTION notify.staff_needing_attention(p_school_id uuid, p_today date) RETURNS integer
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT count(*)::int FROM (
    SELECT p.id
      FROM people.person p
     WHERE p.status = 'active' AND p_school_id IN (SELECT staff.current_schools(p.id))
       AND (
         (EXISTS (SELECT 1 FROM staff.employment e
                   WHERE e.person_id = p.id AND e.school_id = p_school_id
                     AND e.start_date <= p_today AND (e.end_date IS NULL OR e.end_date >= p_today))
          AND coalesce((SELECT max(c.valid_until) FROM staff.record_check c WHERE c.person_id = p.id), p_today - 1)
              <= p_today + 60)
         OR (EXISTS (SELECT 1 FROM access.role_assignment ra
                      WHERE ra.person_id = p.id AND ra.school_id = p_school_id AND ra.role_code = 'teacher'
                        AND ra.revoked_at IS NULL AND (ra.valid_until IS NULL OR ra.valid_until > now()))
             AND NOT EXISTS (SELECT 1 FROM staff.qualification q
                              WHERE q.person_id = p.id AND q.kind = 'teaching_licence' AND q.withdrawn_at IS NULL
                                AND (q.expires_on IS NULL OR q.expires_on >= p_today)))
         OR EXISTS (SELECT 1 FROM staff.qualification q
                     WHERE q.person_id = p.id AND q.withdrawn_at IS NULL AND q.expires_on <= p_today + 60))
  ) needing
$$;
REVOKE ALL ON FUNCTION notify.staff_needing_attention(uuid, date) FROM PUBLIC;

-- Everything due on this day; returns how many messages were queued, per kind.
CREATE FUNCTION notify.queue_reminders(p_today date) RETURNS TABLE (kind text, queued integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record;
  v_due integer := 0;
  v_overdue integer := 0;
  v_staff integer := 0;
  v_offers integer := 0;
  v_leader record;
BEGIN
  -- Due tomorrow, to the person doing it.
  FOR r IN
    SELECT t.id, t.group_id, t.assignee_person_id, t.title, t.due_on, s.name AS school_name, pr.name AS project_name
      FROM work.task t
      LEFT JOIN org.school s ON s.id = t.school_id
      LEFT JOIN work.project pr ON pr.id = t.project_id
     WHERE t.status IN ('open', 'in_progress') AND t.due_on = p_today + 1
  LOOP
    IF notify.queue_message(r.group_id, r.assignee_person_id, 'task.due',
                            'task:' || r.id || ':due-' || to_char(r.due_on, 'YYYY-MM-DD'),
                            jsonb_build_object('title', r.title, 'dueOn', to_char(r.due_on, 'YYYY-MM-DD'),
                                               'schoolName', r.school_name, 'projectName', r.project_name)) IS NOT NULL THEN
      v_due := v_due + 1;
    END IF;
  END LOOP;

  -- Overdue: one summary a day per person, with the oldest three by name.
  FOR r IN
    SELECT t.group_id, t.assignee_person_id, count(*)::int AS overdue,
           (array_agg(t.title ORDER BY t.due_on, t.created_at))[1:3] AS titles
      FROM work.task t
     WHERE t.status IN ('open', 'in_progress') AND t.due_on < p_today
     GROUP BY t.group_id, t.assignee_person_id
  LOOP
    IF notify.queue_message(r.group_id, r.assignee_person_id, 'task.overdue',
                            'overdue:' || r.assignee_person_id || ':' || to_char(p_today, 'YYYY-MM-DD'),
                            jsonb_build_object('count', r.overdue, 'titles', to_jsonb(r.titles))) IS NOT NULL THEN
      v_overdue := v_overdue + 1;
    END IF;
  END LOOP;

  -- Staff to see to: once a week, to each principal and school administrator of the school.
  FOR r IN
    SELECT s.id AS school_id, s.group_id, s.name, notify.staff_needing_attention(s.id, p_today) AS people
      FROM org.school s WHERE s.status = 'active'
  LOOP
    CONTINUE WHEN r.people = 0;
    FOR v_leader IN
      SELECT DISTINCT ra.person_id FROM access.role_assignment ra
        JOIN people.person p ON p.id = ra.person_id AND p.status = 'active'
       WHERE ra.school_id = r.school_id AND ra.role_code IN ('principal', 'school_admin') AND ra.revoked_at IS NULL
         AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
    LOOP
      IF notify.queue_message(r.group_id, v_leader.person_id, 'staff.renewals',
                              'school:' || r.school_id || ':' || to_char(p_today, 'IYYY-"w"IW'),
                              jsonb_build_object('schoolName', r.name, 'schoolId', r.school_id, 'people', r.people))
         IS NOT NULL THEN
        v_staff := v_staff + 1;
      END IF;
    END LOOP;
  END LOOP;

  -- Offers with three days or less to answer, to the parent who applied.
  FOR r IN
    SELECT a.id, a.group_id, a.applicant_person_id, a.offer_expires_at, a.offered_at, s.name AS school_name, s.time_zone
      FROM admissions.application a JOIN org.school s ON s.id = a.school_id
     WHERE a.status = 'offered' AND a.offer_expires_at > now()
       -- The offer is open until the end of its last day, school time.
       AND ((a.offer_expires_at AT TIME ZONE s.time_zone) - interval '1 second')::date <= p_today + 3
  LOOP
    IF notify.queue_message(r.group_id, r.applicant_person_id, 'offer.expiring',
                            'offer:' || r.id || ':' || to_char(r.offered_at, 'YYYY-MM-DD'),
                            jsonb_build_object('schoolName', r.school_name,
                                               'answerBy', to_char((r.offer_expires_at AT TIME ZONE r.time_zone) - interval '1 second', 'YYYY-MM-DD')))
       IS NOT NULL THEN
      v_offers := v_offers + 1;
    END IF;
  END LOOP;

  RETURN QUERY VALUES ('task.due', v_due), ('task.overdue', v_overdue), ('staff.renewals', v_staff), ('offer.expiring', v_offers);
END $$;
REVOKE ALL ON FUNCTION notify.queue_reminders(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify.queue_reminders(date) TO pyth_worker;

-- migrate:down
DROP FUNCTION notify.queue_reminders(date);
DROP FUNCTION notify.staff_needing_attention(uuid, date);
DELETE FROM notify.message WHERE kind_code IN ('task.due', 'task.overdue', 'staff.renewals', 'offer.expiring');
DELETE FROM notify.preference WHERE kind_code IN ('task.due', 'task.overdue', 'staff.renewals', 'offer.expiring');
DELETE FROM notify.kind WHERE code IN ('task.due', 'task.overdue', 'staff.renewals', 'offer.expiring');
