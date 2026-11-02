-- migrate:up

-- Staff sign in with a second factor (M8.3, ADR 0034). The platform, not the
-- identity provider, knows who is staff: anyone holding a role now. The API
-- asks this before accepting a token that was issued without the second
-- factor, so a role granted or revoked takes effect at the next request and
-- nothing has to be copied into Keycloak. Families hold no roles and are never
-- asked for one.
CREATE FUNCTION access.requires_second_factor(p_person_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM access.role_assignment ra
    WHERE ra.person_id = p_person_id
      AND ra.revoked_at IS NULL
      AND ra.valid_from <= now()
      AND (ra.valid_until IS NULL OR ra.valid_until > now())
  )
$$;
COMMENT ON FUNCTION access.requires_second_factor(uuid) IS
  'True while the person holds any role: their sign-in needs a second factor. Called by the API before any person context exists.';
GRANT EXECUTE ON FUNCTION access.requires_second_factor(uuid) TO pyth_api;

-- migrate:down

DROP FUNCTION access.requires_second_factor(uuid);
