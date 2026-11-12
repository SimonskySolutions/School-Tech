-- migrate:up

-- Admissions M5.5: the pipeline in numbers. Two functions count inquiries and
-- applications per school, intake and source, and return nothing else: no
-- name, address or child. They answer the school's admissions staff for their
-- schools and, with the new permission admissions.report, the CEO for every
-- school, who otherwise reads no admissions record at all (ADR 0026).

INSERT INTO access.permission (code, description) VALUES
  ('admissions.report', 'See admissions numbers per school, without personal data');
INSERT INTO access.role_permission (role_code, permission_code) VALUES ('group_ceo', 'admissions.report');

-- Applications per intake and state.
CREATE FUNCTION admissions.intake_counts()
RETURNS TABLE (
  school_id uuid, school_name text, intake_id uuid, school_year text, grade text, places integer, intake_status text,
  submitted integer, under_review integer, waitlisted integer, offered integer, accepted integer, enrolled integer,
  declined integer, expired integer, rejected integer, withdrawn integer, from_inquiry integer
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT s.id, s.name, it.id, it.school_year, it.grade, it.places, it.status,
         count(a.id) FILTER (WHERE a.status = 'submitted')::int,
         count(a.id) FILTER (WHERE a.status = 'under_review')::int,
         count(a.id) FILTER (WHERE a.status = 'waitlisted')::int,
         count(a.id) FILTER (WHERE a.status = 'offered')::int,
         count(a.id) FILTER (WHERE a.status = 'accepted')::int,
         count(a.id) FILTER (WHERE a.status = 'enrolled')::int,
         count(a.id) FILTER (WHERE a.status = 'declined')::int,
         count(a.id) FILTER (WHERE a.status = 'expired')::int,
         count(a.id) FILTER (WHERE a.status = 'rejected')::int,
         count(a.id) FILTER (WHERE a.status = 'withdrawn')::int,
         -- Applications from parents who were invited after an inquiry to that school.
         count(a.id) FILTER (WHERE EXISTS (SELECT 1 FROM admissions.inquiry i
                                            WHERE i.applicant_person_id = a.applicant_person_id
                                              AND i.school_id = a.school_id))::int
    FROM admissions.intake it
    JOIN org.school s ON s.id = it.school_id
    LEFT JOIN admissions.application a ON a.intake_id = it.id
   WHERE app.current_person_id() IS NOT NULL AND it.group_id = access.current_group_id()
     AND (access.has_permission('admissions.manage', it.school_id) OR access.has_permission('admissions.report', it.school_id))
   GROUP BY s.id, s.name, it.id
   ORDER BY s.name, it.school_year, it.grade
$$;
REVOKE ALL ON FUNCTION admissions.intake_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.intake_counts() TO pyth_api;

-- Inquiries per school and the website they came from, received since a day
-- (all when null). Erased inquiries still count: only their contents go.
CREATE FUNCTION admissions.inquiry_counts(p_since date)
RETURNS TABLE (
  school_id uuid, school_name text, website_id uuid, website_name text,
  received integer, waiting integer, contacted integer, closed integer, applied integer, invited integer
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT s.id, s.name, w.id, w.name,
         count(*)::int,
         count(*) FILTER (WHERE i.status = 'new')::int,
         count(*) FILTER (WHERE i.status = 'contacted')::int,
         count(*) FILTER (WHERE i.status = 'closed')::int,
         count(*) FILTER (WHERE i.outcome = 'applied')::int,
         count(*) FILTER (WHERE i.applicant_person_id IS NOT NULL)::int
    FROM admissions.inquiry i
    JOIN org.school s ON s.id = i.school_id
    JOIN org.website w ON w.id = i.website_id
   WHERE app.current_person_id() IS NOT NULL AND i.group_id = access.current_group_id()
     AND (p_since IS NULL OR (i.received_at AT TIME ZONE s.time_zone)::date >= p_since)
     AND (access.has_permission('admissions.manage', i.school_id) OR access.has_permission('admissions.report', i.school_id))
   GROUP BY s.id, s.name, w.id, w.name
   ORDER BY s.name, w.name
$$;
REVOKE ALL ON FUNCTION admissions.inquiry_counts(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.inquiry_counts(date) TO pyth_api;

-- migrate:down
DROP FUNCTION admissions.inquiry_counts(date);
DROP FUNCTION admissions.intake_counts();
DELETE FROM access.role_permission WHERE permission_code = 'admissions.report';
DELETE FROM access.permission WHERE code = 'admissions.report';
