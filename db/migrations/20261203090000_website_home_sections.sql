-- migrate:up

-- Every website's start page is built from the same blocks in the same colours;
-- each website chooses their order, so the schools look related but not identical.
ALTER TABLE org.website
  ADD COLUMN home_sections text[] NOT NULL DEFAULT ARRAY['hero', 'content', 'highlights', 'ask'],
  ADD CONSTRAINT website_home_sections_each_once CHECK (
    cardinality(home_sections) = 4
    AND home_sections @> ARRAY['hero', 'content', 'highlights', 'ask']
  );
COMMENT ON COLUMN org.website.home_sections IS
  'The order of the start page''s blocks: hero, content (CMS text), highlights (services for families), ask (call to ask about a place). Each block exactly once.';

-- Where a school's own website lives, so the group website can link to it. A
-- function because domains are not public: only this one, verified, live name is.
CREATE FUNCTION org.school_website_host(p_school_id uuid)
RETURNS text
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT d.hostname
  FROM org.website_school ws
  JOIN org.website w ON w.id = ws.website_id
  JOIN org.website_domain d ON d.website_id = w.id
  WHERE ws.school_id = p_school_id
    AND ws.is_primary_website_for_school
    AND w.status = 'live'
    AND d.is_primary
    AND d.status = 'verified'
$$;
REVOKE ALL ON FUNCTION org.school_website_host(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org.school_website_host(uuid) TO pyth_api;

-- migrate:down
DROP FUNCTION org.school_website_host(uuid);
ALTER TABLE org.website DROP COLUMN home_sections;
