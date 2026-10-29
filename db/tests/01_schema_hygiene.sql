-- Structural checks a DBA would apply to every release.
BEGIN;
\ir _fixtures.sql
\echo '# 01 schema hygiene'

SELECT test.ok(NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND NOT c.relrowsecurity
    AND n.nspname IN ('audit', 'org', 'people', 'access', 'catalog', 'scheduling', 'commerce', 'integration', 'privacy', 'sensitive')
), 'every application table has row-level security enabled');

SELECT test.ok(NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'v', 'S', 'f') AND pg_get_userbyid(c.relowner) <> 'pyth_owner'
    AND n.nspname IN ('app', 'audit', 'org', 'people', 'access', 'catalog', 'scheduling', 'commerce', 'integration', 'privacy', 'sensitive', 'reporting', 'meta')
), 'every application relation is owned by pyth_owner');

-- Every foreign key's leading selective column (group_id aside) leads a full,
-- non-partial index. Keys that only point at the group root are exempt: group
-- rows are never deleted and group_id alone is not selective.
SELECT test.ok(NOT EXISTS (
  WITH fk AS (
    SELECT con.conrelid, con.confrelid,
           (SELECT k.attnum FROM unnest(con.conkey) WITH ORDINALITY AS k (attnum, ord)
              JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
             WHERE a.attname <> 'group_id' ORDER BY k.ord LIMIT 1) AS lead_col
    FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace
    WHERE con.contype = 'f'
      AND n.nspname IN ('audit', 'org', 'people', 'access', 'catalog', 'scheduling', 'commerce', 'integration', 'privacy', 'sensitive')
  )
  SELECT 1 FROM fk
  WHERE fk.confrelid <> 'org.education_group'::regclass
    AND NOT EXISTS (SELECT 1 FROM pg_index i
                    WHERE i.indrelid = fk.conrelid AND i.indpred IS NULL AND i.indkey[0] = fk.lead_col)
), 'every foreign key has a supporting index');

SELECT test.ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosecdef
    AND n.nspname IN ('app', 'audit', 'org', 'people', 'access', 'catalog', 'scheduling', 'commerce', 'integration', 'privacy', 'sensitive')
    AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%')
), 'every security-definer function pins its search_path');

SELECT test.ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
       LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  WHERE n.nspname IN ('app', 'audit', 'org', 'people', 'access', 'catalog', 'scheduling', 'commerce', 'integration', 'privacy', 'sensitive')
    AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
), 'no application function is executable by PUBLIC');

SELECT test.ok(NOT EXISTS (
  SELECT 1 FROM pg_namespace n, unnest(ARRAY['pyth_api', 'pyth_worker', 'pyth_reporting', 'pyth_backup']) r
  WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND n.nspname <> 'test'
    AND has_schema_privilege(r, n.oid, 'CREATE')
), 'runtime roles cannot create objects in any schema');

SELECT test.ok(NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname IN ('pyth_api', 'pyth_worker', 'pyth_reporting', 'pyth_migrator')
    AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)
), 'runtime and migration roles have no elevated attributes');

SELECT test.ok(NOT has_table_privilege('pyth_api', 'audit.change_log', 'UPDATE')
           AND NOT has_table_privilege('pyth_api', 'audit.change_log', 'DELETE')
           AND NOT has_table_privilege('pyth_api', 'audit.change_log', 'TRUNCATE')
           AND NOT has_table_privilege('pyth_worker', 'audit.change_log', 'INSERT'),
  'the audit log cannot be altered by runtime roles');

SELECT test.ok(NOT has_table_privilege('pyth_worker', 'sensitive.dietary_requirement', 'SELECT'),
  'the worker cannot read health data');

SELECT test.ok(current_setting('data_checksums') = 'on', 'data checksums are enabled');
SELECT test.ok(current_setting('TimeZone') = 'UTC', 'server time zone is UTC');
SELECT test.ok(current_setting('log_parameter_max_length') = '0'
           AND current_setting('log_parameter_max_length_on_error') = '0',
  'query parameter values are never written to server logs');
SELECT test.ok(current_setting('password_encryption') = 'scram-sha-256', 'passwords are hashed with SCRAM-SHA-256');

SELECT test.ok((SELECT count(*) FROM pg_inherits WHERE inhparent = 'audit.change_log'::regclass) >= 5,
  'audit log has a default partition and monthly partitions ahead');

ROLLBACK;
