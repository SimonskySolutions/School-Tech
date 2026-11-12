-- migrate:up

-- Admissions M5.6 (ADR 0026): storage limitation and requests from
-- prospective families. Inquiries and applications that did not lead to an
-- enrolment are erased (their contents emptied, the rows kept so admissions
-- can still be counted) once the group's approved retention policy
-- "admissions.unsuccessful" says so; without an approved policy the worker
-- erases nothing (ADR 0006). Admissions staff erase one on request, export
-- what is held about a sender (Art. 15) and record that the family withdrew
-- the open-day consent. Each erasure and export on request is recorded as a
-- completed data subject request.

-- What is held about a known child moves to their record at enrolment; an
-- erased application keeps neither the child nor what the family wrote.
-- Empties one inquiry and its log. The caller holds the row.
CREATE FUNCTION admissions.erase_inquiry_row(p_inquiry_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE admissions.inquiry
     SET status = 'closed', outcome = coalesce(outcome, 'no_response'), closed_at = coalesce(closed_at, now())
   WHERE id = p_inquiry_id AND status <> 'closed';
  UPDATE admissions.inquiry
     SET parent_name = NULL, email = NULL, phone = NULL, child_name = NULL, birth_year = NULL, grade_of_interest = NULL,
         intended_start = NULL, message = NULL, news_consent_at = NULL, news_consent_withdrawn_at = NULL, erased_at = now()
   WHERE id = p_inquiry_id;
  UPDATE admissions.inquiry_note SET body = NULL, erased_at = now() WHERE inquiry_id = p_inquiry_id AND erased_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION admissions.erase_inquiry_row(uuid) FROM PUBLIC;

-- Empties one application and its notes; a live one is withdrawn first.
-- Returns true when that gave a place back. The caller holds the intake lock.
CREATE FUNCTION admissions.erase_application_row(p_application_id uuid) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  previous text;
BEGIN
  SELECT status INTO previous FROM admissions.application WHERE id = p_application_id FOR UPDATE;
  IF previous IN ('submitted', 'under_review', 'waitlisted', 'offered', 'accepted') THEN
    UPDATE admissions.application SET status = 'withdrawn', withdrawn_at = now() WHERE id = p_application_id;
  END IF;
  UPDATE admissions.application
     SET child_given_name = NULL, child_family_name = NULL, child_birth_date = NULL, current_school = NULL,
         message = NULL, student_person_id = NULL, erased_at = now()
   WHERE id = p_application_id;
  UPDATE admissions.application_note SET body = NULL, erased_at = now()
   WHERE application_id = p_application_id AND erased_at IS NULL;
  RETURN previous IN ('offered', 'accepted');
END $$;
REVOKE ALL ON FUNCTION admissions.erase_application_row(uuid) FROM PUBLIC;

-- A request handled by admissions staff, recorded as completed (Art. 30, 12).
CREATE FUNCTION admissions.record_request(p_group_id uuid, p_kind text, p_note text) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  INSERT INTO privacy.data_subject_request (group_id, kind, status, completed_at, handled_by_person_id, outcome_note)
  VALUES (p_group_id, p_kind, 'completed', now(), app.current_person_id(), p_note)
$$;
REVOKE ALL ON FUNCTION admissions.record_request(uuid, text, text) FROM PUBLIC;

-- Staff erase an inquiry when the family asks.
CREATE FUNCTION admissions.erase_inquiry(p_inquiry_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM admissions.inquiry WHERE id = p_inquiry_id FOR UPDATE;
  IF app.current_person_id() IS NULL OR NOT FOUND OR NOT access.has_permission('admissions.manage', r.school_id) THEN
    RAISE EXCEPTION 'no such inquiry' USING ERRCODE = 'P0002';
  END IF;
  IF r.erased_at IS NOT NULL THEN
    RAISE EXCEPTION 'the inquiry is already erased' USING ERRCODE = 'PY001';
  END IF;
  PERFORM admissions.erase_inquiry_row(r.id);
  PERFORM admissions.record_request(r.group_id, 'erasure', 'Admissions inquiry erased on request');
END $$;
REVOKE ALL ON FUNCTION admissions.erase_inquiry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.erase_inquiry(uuid) TO pyth_api;

-- Staff erase an application when the family asks. An enrolled child's
-- details are their school record now, kept under its own rules.
CREATE FUNCTION admissions.erase_application(p_application_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM admissions.application WHERE id = p_application_id;
  IF app.current_person_id() IS NULL OR NOT FOUND OR NOT access.has_permission('admissions.manage', a.school_id) THEN
    RAISE EXCEPTION 'no such application' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM admissions.intake WHERE id = a.intake_id FOR UPDATE;
  SELECT * INTO a FROM admissions.application WHERE id = p_application_id FOR UPDATE;
  IF a.status = 'enrolled' THEN
    RAISE EXCEPTION 'an enrolled child''s details are part of their school record' USING ERRCODE = 'PY001';
  END IF;
  IF a.erased_at IS NOT NULL THEN
    RAISE EXCEPTION 'the application is already erased' USING ERRCODE = 'PY001';
  END IF;
  IF admissions.erase_application_row(a.id) THEN
    PERFORM admissions.offer_next(a.intake_id);
  END IF;
  PERFORM admissions.record_request(a.group_id, 'erasure', 'Admissions application erased on request');
END $$;
REVOKE ALL ON FUNCTION admissions.erase_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.erase_application(uuid) TO pyth_api;

-- Staff record that the family no longer wants news about open days.
CREATE FUNCTION admissions.withdraw_news_consent(p_inquiry_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM admissions.inquiry WHERE id = p_inquiry_id FOR UPDATE;
  IF app.current_person_id() IS NULL OR NOT FOUND OR NOT access.has_permission('admissions.manage', r.school_id) THEN
    RAISE EXCEPTION 'no such inquiry' USING ERRCODE = 'P0002';
  END IF;
  IF r.news_consent_at IS NULL OR r.news_consent_withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'there is no consent to withdraw' USING ERRCODE = 'PY001';
  END IF;
  UPDATE admissions.inquiry SET news_consent_withdrawn_at = now(), last_activity_at = now() WHERE id = r.id;
END $$;
REVOKE ALL ON FUNCTION admissions.withdraw_news_consent(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.withdraw_news_consent(uuid) TO pyth_api;

-- Everything held about the sender of an inquiry (Art. 15): the inquiry and
-- its log, and the applications the parent made to that school, with their
-- notes. Written to the access log and recorded as a completed request.
CREATE FUNCTION admissions.export_inquiry(p_inquiry_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record;
  result jsonb;
BEGIN
  SELECT * INTO r FROM admissions.inquiry WHERE id = p_inquiry_id;
  IF app.current_person_id() IS NULL OR NOT FOUND OR NOT access.has_permission('admissions.manage', r.school_id) THEN
    RAISE EXCEPTION 'no such inquiry' USING ERRCODE = 'P0002';
  END IF;
  SELECT jsonb_build_object(
           'exported_at', now(),
           'school', (SELECT name FROM org.school WHERE id = r.school_id),
           'privacy_notice_version', (SELECT version FROM admissions.privacy_notice WHERE id = r.notice_id),
           'inquiry', to_jsonb(r) - 'group_id' - 'school_id' - 'website_id' - 'notice_id' - 'applicant_person_id',
           'contact_log', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', n.kind, 'at', n.created_at, 'text', n.body) ORDER BY n.created_at)
                                      FROM admissions.inquiry_note n WHERE n.inquiry_id = r.id), '[]'::jsonb),
           'applications', coalesce((SELECT jsonb_agg(admissions.application_export(a.id) ORDER BY a.submitted_at)
                                       FROM admissions.application a
                                      WHERE r.applicant_person_id IS NOT NULL AND a.applicant_person_id = r.applicant_person_id
                                        AND a.school_id = r.school_id), '[]'::jsonb))
    INTO result;
  INSERT INTO audit.access_log (actor_person_id, action, resource, school_id, record_count, request_id)
  VALUES (app.current_person_id(), 'export', 'admissions.inquiry', r.school_id, 1, app.current_request_id());
  PERFORM admissions.record_request(r.group_id, 'access', 'Admissions inquiry exported on request');
  RETURN result;
END $$;

-- One application as it is held, with its notes.
CREATE FUNCTION admissions.application_export(p_application_id uuid) RETURNS jsonb
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object(
           'school_year', it.school_year, 'grade', it.grade, 'status', a.status,
           'child', CASE WHEN c.id IS NOT NULL
                         THEN jsonb_build_object('given_name', c.given_name, 'family_name', c.family_name, 'date_of_birth', c.date_of_birth)
                         ELSE jsonb_build_object('given_name', a.child_given_name, 'family_name', a.child_family_name, 'date_of_birth', a.child_birth_date) END,
           'current_school', a.current_school, 'message', a.message,
           'privacy_notice_version', n.version,
           'submitted_at', a.submitted_at, 'waitlisted_at', a.waitlisted_at, 'offered_at', a.offered_at,
           'offer_expires_at', a.offer_expires_at, 'decided_at', a.decided_at, 'withdrawn_at', a.withdrawn_at,
           'enrolled_at', a.enrolled_at, 'erased_at', a.erased_at,
           'notes', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', x.kind, 'at', x.created_at, 'text', x.body) ORDER BY x.created_at)
                                FROM admissions.application_note x WHERE x.application_id = a.id), '[]'::jsonb))
    FROM admissions.application a
    JOIN admissions.intake it ON it.id = a.intake_id
    JOIN admissions.privacy_notice n ON n.id = a.notice_id
    LEFT JOIN people.person c ON c.id = a.student_person_id
   WHERE a.id = p_application_id
$$;
REVOKE ALL ON FUNCTION admissions.application_export(uuid) FROM PUBLIC;

-- Staff export one application, for a family that applied without an inquiry.
CREATE FUNCTION admissions.export_application(p_application_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM admissions.application WHERE id = p_application_id;
  IF app.current_person_id() IS NULL OR NOT FOUND OR NOT access.has_permission('admissions.manage', a.school_id) THEN
    RAISE EXCEPTION 'no such application' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO audit.access_log (actor_person_id, action, resource, subject_person_id, school_id, record_count, request_id)
  VALUES (app.current_person_id(), 'export', 'admissions.application', a.applicant_person_id, a.school_id, 1, app.current_request_id());
  PERFORM admissions.record_request(a.group_id, 'access', 'Admissions application exported on request');
  RETURN jsonb_build_object('exported_at', now(), 'school', (SELECT name FROM org.school WHERE id = a.school_id),
                            'application', admissions.application_export(a.id));
END $$;
REVOKE ALL ON FUNCTION admissions.export_inquiry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.export_inquiry(uuid) TO pyth_api;
REVOKE ALL ON FUNCTION admissions.export_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.export_application(uuid) TO pyth_api;

-- The worker erases what the group's approved policy says is no longer
-- needed: inquiries closed (or untouched) longer than the period, and
-- applications that ended without a place longer than the period. Inquiries
-- whose parent's child was enrolled at that school stay with the school.
-- Without an approved policy nothing happens. Returns how many it erased.
CREATE FUNCTION admissions.apply_retention() RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  policy record;
  target record;
  erased integer := 0;
BEGIN
  FOR policy IN
    SELECT group_id, retain_for FROM privacy.retention_policy
     WHERE code = 'admissions.unsuccessful' AND status = 'approved'
  LOOP
    FOR target IN
      SELECT i.id FROM admissions.inquiry i
       WHERE i.group_id = policy.group_id AND i.erased_at IS NULL
         AND ((i.status = 'closed' AND i.closed_at < now() - policy.retain_for)
              OR (i.status <> 'closed' AND i.last_activity_at < now() - policy.retain_for))
         AND NOT EXISTS (SELECT 1 FROM admissions.application a
                          WHERE a.applicant_person_id = i.applicant_person_id AND a.school_id = i.school_id
                            AND a.status = 'enrolled')
       FOR UPDATE OF i SKIP LOCKED
    LOOP
      PERFORM admissions.erase_inquiry_row(target.id);
      erased := erased + 1;
    END LOOP;
    FOR target IN
      SELECT a.id FROM admissions.application a
       WHERE a.group_id = policy.group_id AND a.erased_at IS NULL
         AND a.status IN ('declined', 'expired', 'rejected', 'withdrawn')
         AND coalesce(a.withdrawn_at, a.decided_at) < now() - policy.retain_for
       FOR UPDATE SKIP LOCKED
    LOOP
      PERFORM admissions.erase_application_row(target.id);
      erased := erased + 1;
    END LOOP;
  END LOOP;
  RETURN erased;
END $$;
REVOKE ALL ON FUNCTION admissions.apply_retention() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.apply_retention() TO pyth_worker;

-- migrate:down
DROP FUNCTION admissions.apply_retention();
DROP FUNCTION admissions.export_application(uuid);
DROP FUNCTION admissions.export_inquiry(uuid);
DROP FUNCTION admissions.application_export(uuid);
DROP FUNCTION admissions.withdraw_news_consent(uuid);
DROP FUNCTION admissions.erase_application(uuid);
DROP FUNCTION admissions.erase_inquiry(uuid);
DROP FUNCTION admissions.record_request(uuid, text, text);
DROP FUNCTION admissions.erase_application_row(uuid);
DROP FUNCTION admissions.erase_inquiry_row(uuid);
