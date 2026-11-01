-- migrate:up

-- Messages for staff and families (M7.2, ADR 0031). What happens is noted as
-- an outbox event with identifiers only, by triggers on the tables where it
-- happens; the worker turns each event into messages through one function
-- here, which decides who is told. Only identifiers, a title and a school's
-- name go into a message's parameters; never a request's subject, a child's
-- needs or a document's contents.

INSERT INTO notify.kind (code, essential, description) VALUES
  ('approval.waiting', false, 'A document is waiting for your approval'),
  ('task.assigned', false, 'Someone has given you a task'),
  ('request.answered', false, 'The school has replied to your message'),
  ('consent.asked_again', false, 'The school asks for your consent again after changing what it asks'),
  ('admissions.invited', true, 'A school invites you to apply for a place');

-- The events -------------------------------------------------------------

CREATE FUNCTION notify.note_event(p_group_id uuid, p_aggregate_type text, p_aggregate_id uuid, p_event_type text, p_payload jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  INSERT INTO integration.outbox_event (group_id, aggregate_type, aggregate_id, event_type, payload)
  VALUES (p_group_id, p_aggregate_type, p_aggregate_id, p_event_type, p_payload)
$$;
REVOKE ALL ON FUNCTION notify.note_event(uuid, text, uuid, text, jsonb) FROM PUBLIC;

-- An approval request moves on: its first step on creation, the next one each time a step is approved.
CREATE FUNCTION notify.approval_step_changed() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.step_no = 1) OR (TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status = 'pending') THEN
    PERFORM notify.note_event(NEW.group_id, 'documents.approval_request', NEW.request_id, 'documents.approval.advanced',
                              jsonb_build_object('request_id', NEW.request_id));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER notify AFTER INSERT OR UPDATE OF status ON documents.approval_step
  FOR EACH ROW EXECUTE FUNCTION notify.approval_step_changed();

-- A task is given to someone other than whoever set it, or handed on.
CREATE FUNCTION notify.task_assigned() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.assignee_person_id <> NEW.created_by_person_id)
     OR (TG_OP = 'UPDATE' AND NEW.assignee_person_id IS DISTINCT FROM OLD.assignee_person_id
         AND NEW.assignee_person_id IS DISTINCT FROM app.current_person_id()) THEN
    PERFORM notify.note_event(NEW.group_id, 'work.task', NEW.id, 'work.task.assigned',
                              jsonb_build_object('task_id', NEW.id, 'assignee_id', NEW.assignee_person_id));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER notify AFTER INSERT OR UPDATE OF assignee_person_id ON work.task
  FOR EACH ROW EXECUTE FUNCTION notify.task_assigned();

-- The school replies to a family's request.
CREATE FUNCTION notify.request_answered() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.from_school THEN
    PERFORM notify.note_event(NEW.group_id, 'people.family_request', NEW.request_id, 'people.family_request.answered',
                              jsonb_build_object('request_id', NEW.request_id, 'message_id', NEW.id));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER notify AFTER INSERT ON people.family_request_message
  FOR EACH ROW EXECUTE FUNCTION notify.request_answered();

-- New consent wording that asks families again.
CREATE FUNCTION notify.wording_published() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.renewal_required THEN
    PERFORM notify.note_event(NEW.group_id, 'privacy.consent_wording', NEW.id, 'privacy.consent_wording.renewal',
                              jsonb_build_object('wording_id', NEW.id));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER notify AFTER INSERT ON privacy.consent_wording
  FOR EACH ROW EXECUTE FUNCTION notify.wording_published();

-- A family is invited to apply.
CREATE FUNCTION notify.applicant_invited() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.invited_at IS NOT NULL AND NEW.invited_at IS DISTINCT FROM OLD.invited_at AND NEW.applicant_person_id IS NOT NULL THEN
    PERFORM notify.note_event(NEW.group_id, 'admissions.inquiry', NEW.id, 'admissions.inquiry.invited',
                              jsonb_build_object('inquiry_id', NEW.id));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER notify AFTER UPDATE OF invited_at ON admissions.inquiry
  FOR EACH ROW EXECUTE FUNCTION notify.applicant_invited();

-- Who is told -----------------------------------------------------------

-- The step now waiting: everyone who holds its role where it is decided
-- (the document's school, or the group), may read the document, and decided
-- no earlier step of the request.
CREATE FUNCTION notify.on_approval_advanced(p_request_id uuid) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  s record;
  v_count integer := 0;
  p record;
BEGIN
  SELECT st.id AS step_id, st.role_code, st.step_no, q.group_id, d.title, d.school_id, sc.name AS school_name,
         v.version_no, (SELECT count(*) FROM documents.approval_step a WHERE a.request_id = q.id) AS steps
    INTO s
    FROM documents.approval_request q
    JOIN documents.approval_step st ON st.request_id = q.id
    JOIN documents.version v ON v.id = q.version_id
    JOIN documents.document d ON d.id = v.document_id
    LEFT JOIN org.school sc ON sc.id = d.school_id
   WHERE q.id = p_request_id AND q.status = 'pending' AND st.status = 'pending' AND d.archived_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM documents.approval_step e
                      WHERE e.request_id = q.id AND e.step_no < st.step_no AND e.status <> 'approved')
   ORDER BY st.step_no
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  FOR p IN
    SELECT DISTINCT ra.person_id
      FROM access.role_assignment ra
      JOIN access.role r ON r.code = ra.role_code
      JOIN people.person pe ON pe.id = ra.person_id AND pe.status = 'active'
     WHERE ra.role_code = s.role_code AND ra.group_id = s.group_id AND ra.revoked_at IS NULL
       AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
       AND CASE r.scope_level WHEN 'group' THEN ra.school_id IS NULL ELSE ra.school_id = s.school_id END
       AND NOT EXISTS (SELECT 1 FROM documents.approval_step e
                        WHERE e.request_id = p_request_id AND e.decided_by_person_id = ra.person_id)
  LOOP
    IF notify.queue_message(s.group_id, p.person_id, 'approval.waiting', 'step:' || s.step_id,
                            jsonb_build_object('title', s.title, 'schoolName', s.school_name, 'versionNo', s.version_no,
                                               'stepNo', s.step_no, 'steps', s.steps)) IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION notify.on_approval_advanced(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify.on_approval_advanced(uuid) TO pyth_worker;

-- The person a task was given to, if it is still theirs and still to do.
CREATE FUNCTION notify.on_task_assigned(p_task_id uuid, p_assignee_id uuid) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  t record;
BEGIN
  SELECT tk.group_id, tk.assignee_person_id, tk.title, tk.due_on, pr.name AS project_name, sc.name AS school_name,
         c.given_name || ' ' || c.family_name AS set_by
    INTO t
    FROM work.task tk
    JOIN people.person c ON c.id = tk.created_by_person_id
    LEFT JOIN work.project pr ON pr.id = tk.project_id
    LEFT JOIN org.school sc ON sc.id = tk.school_id
   WHERE tk.id = p_task_id AND tk.assignee_person_id = p_assignee_id AND tk.status IN ('open', 'in_progress');
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  RETURN (notify.queue_message(t.group_id, t.assignee_person_id, 'task.assigned', 'task:' || p_task_id,
                               jsonb_build_object('title', t.title, 'dueOn', t.due_on, 'projectName', t.project_name,
                                                  'schoolName', t.school_name, 'setBy', t.set_by)) IS NOT NULL)::int;
END $$;
REVOKE ALL ON FUNCTION notify.on_task_assigned(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify.on_task_assigned(uuid, uuid) TO pyth_worker;

-- Whoever sent the request; never its subject or the reply itself.
CREATE FUNCTION notify.on_request_answered(p_request_id uuid, p_message_id uuid) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  SELECT fr.group_id, fr.requested_by_person_id, fr.student_person_id, sc.name AS school_name
    INTO r
    FROM people.family_request fr JOIN org.school sc ON sc.id = fr.school_id
   WHERE fr.id = p_request_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  RETURN (notify.queue_message(r.group_id, r.requested_by_person_id, 'request.answered', 'reply:' || p_message_id,
                               jsonb_build_object('schoolName', r.school_name, 'studentId', r.student_person_id)) IS NOT NULL)::int;
END $$;
REVOKE ALL ON FUNCTION notify.on_request_answered(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify.on_request_answered(uuid, uuid) TO pyth_worker;

-- For each consent the new wording stopped counting: the child's guardians who may consent.
CREATE FUNCTION notify.on_wording_renewal(p_wording_id uuid) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  g record;
  v_count integer := 0;
BEGIN
  FOR g IN
    SELECT DISTINCT c.id AS record_id, c.group_id, gr.guardian_person_id, c.subject_person_id, ch.given_name, pp.name
      FROM privacy.consent_wording w
      JOIN privacy.processing_purpose pp ON pp.id = w.purpose_id
      JOIN privacy.consent_record c ON c.purpose_id = w.purpose_id AND c.status = 'given'
      JOIN privacy.consent_wording cw ON cw.id = c.wording_id AND cw.version < w.version
      JOIN people.person ch ON ch.id = c.subject_person_id
      JOIN people.guardian_relationship gr ON gr.student_person_id = c.subject_person_id AND gr.status = 'active'
                                           AND gr.can_consent AND gr.valid_from <= current_date
                                           AND (gr.valid_until IS NULL OR gr.valid_until >= current_date)
     WHERE w.id = p_wording_id AND w.renewal_required
  LOOP
    IF notify.queue_message(g.group_id, g.guardian_person_id, 'consent.asked_again', 'consent:' || g.record_id,
                            jsonb_build_object('purposeName', g.name, 'childGivenName', g.given_name,
                                               'studentId', g.subject_person_id)) IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION notify.on_wording_renewal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify.on_wording_renewal(uuid) TO pyth_worker;

-- The invited parent.
CREATE FUNCTION notify.on_applicant_invited(p_inquiry_id uuid) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  i record;
BEGIN
  SELECT q.group_id, q.applicant_person_id, sc.name AS school_name
    INTO i
    FROM admissions.inquiry q JOIN org.school sc ON sc.id = q.school_id
   WHERE q.id = p_inquiry_id AND q.applicant_person_id IS NOT NULL;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  RETURN (notify.queue_message(i.group_id, i.applicant_person_id, 'admissions.invited', 'invite:' || p_inquiry_id,
                               jsonb_build_object('schoolName', i.school_name)) IS NOT NULL)::int;
END $$;
REVOKE ALL ON FUNCTION notify.on_applicant_invited(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify.on_applicant_invited(uuid) TO pyth_worker;

-- migrate:down
DROP FUNCTION notify.on_applicant_invited(uuid);
DROP FUNCTION notify.on_wording_renewal(uuid);
DROP FUNCTION notify.on_request_answered(uuid, uuid);
DROP FUNCTION notify.on_task_assigned(uuid, uuid);
DROP FUNCTION notify.on_approval_advanced(uuid);
DROP TRIGGER notify ON admissions.inquiry;
DROP TRIGGER notify ON privacy.consent_wording;
DROP TRIGGER notify ON people.family_request_message;
DROP TRIGGER notify ON work.task;
DROP TRIGGER notify ON documents.approval_step;
DROP FUNCTION notify.applicant_invited();
DROP FUNCTION notify.wording_published();
DROP FUNCTION notify.request_answered();
DROP FUNCTION notify.task_assigned();
DROP FUNCTION notify.approval_step_changed();
DROP FUNCTION notify.note_event(uuid, text, uuid, text, jsonb);
DELETE FROM notify.message WHERE kind_code IN ('approval.waiting', 'task.assigned', 'request.answered', 'consent.asked_again', 'admissions.invited');
DELETE FROM notify.preference WHERE kind_code IN ('approval.waiting', 'task.assigned', 'request.answered', 'consent.asked_again', 'admissions.invited');
DELETE FROM notify.kind WHERE code IN ('approval.waiting', 'task.assigned', 'request.answered', 'consent.asked_again', 'admissions.invited');
