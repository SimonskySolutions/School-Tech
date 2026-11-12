-- migrate:up

-- Linking an existing parent to a child at another school (M3.3). Staff only
-- see people connected to their own school, so a principal registering a new
-- child could not find a parent whose other children are elsewhere, and would
-- create a second record for them. This function answers one narrow question:
-- the id of the active person in the caller's group with exactly this e-mail.
-- It returns nothing else, only to staff who manage guardians at the given
-- school, and every lookup is written to the access log.
CREATE FUNCTION people.find_person_by_email(p_email text, p_school_id uuid) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  found uuid;
BEGIN
  IF app.current_person_id() IS NULL OR NOT access.has_permission('guardians.manage', p_school_id) THEN
    RETURN NULL;
  END IF;
  SELECT p.id INTO found
    FROM people.person p
   WHERE p.group_id = access.current_group_id() AND p.status = 'active' AND p.email = lower(trim(p_email))
   LIMIT 1;
  INSERT INTO audit.access_log (actor_person_id, action, resource, subject_person_id, school_id, record_count, request_id)
  VALUES (app.current_person_id(), 'view', 'people.person:find_by_email', found, p_school_id,
          CASE WHEN found IS NULL THEN 0 ELSE 1 END, app.current_request_id());
  RETURN found;
END $$;
REVOKE ALL ON FUNCTION people.find_person_by_email(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION people.find_person_by_email(text, uuid) TO pyth_api;

-- migrate:down
DROP FUNCTION people.find_person_by_email(text, uuid);
