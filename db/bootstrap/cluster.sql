-- Cluster-level bootstrap: roles and their limits. Run as the postgres superuser.
-- Idempotent: safe to re-run to rotate passwords or reapply settings.
-- Passwords are read from Docker secrets with psql backticks, so they never
-- appear in process arguments, and statement logging is off for this session.

\set ON_ERROR_STOP on
SET log_statement = 'none';
SET password_encryption = 'scram-sha-256';

\set migrator_password `cat /run/secrets/pg_migrator_password`
\set api_password `cat /run/secrets/pg_api_password`
\set worker_password `cat /run/secrets/pg_worker_password`
\set reporting_password `cat /run/secrets/pg_reporting_password`
\set backup_password `cat /run/secrets/pg_backup_password`
\set keycloak_password `cat /run/secrets/pg_keycloak_password`

-- Owner of every schema and object. Cannot log in.
SELECT 'CREATE ROLE pyth_owner NOLOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pyth_owner') \gexec

SELECT format('CREATE ROLE %I LOGIN', r)
FROM unnest(ARRAY['pyth_migrator', 'pyth_api', 'pyth_worker', 'pyth_reporting', 'pyth_backup', 'pyth_keycloak']) AS r
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r) \gexec

ALTER ROLE pyth_owner     NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE pyth_migrator  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2  PASSWORD :'migrator_password';
ALTER ROLE pyth_api       LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 80 PASSWORD :'api_password';
ALTER ROLE pyth_worker    LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20 PASSWORD :'worker_password';
ALTER ROLE pyth_reporting LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5  PASSWORD :'reporting_password';
-- Backups must read every row, so this role bypasses RLS but can write nothing.
ALTER ROLE pyth_backup    LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS   CONNECTION LIMIT 3  PASSWORD :'backup_password';
-- Keycloak owns its own database and nothing else (ADR 0009).
ALTER ROLE pyth_keycloak  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 30 PASSWORD :'keycloak_password';

-- The migrator acts as the owner, so every object it creates belongs to pyth_owner.
GRANT pyth_owner TO pyth_migrator WITH INHERIT TRUE, SET TRUE;
ALTER ROLE pyth_migrator SET role = 'pyth_owner';
GRANT pg_read_all_data TO pyth_backup;

-- Per-role safety limits.
ALTER ROLE pyth_migrator  SET lock_timeout = '10s';
ALTER ROLE pyth_migrator  SET statement_timeout = '0';
ALTER ROLE pyth_api       SET statement_timeout = '15s';
ALTER ROLE pyth_api       SET lock_timeout = '5s';
ALTER ROLE pyth_api       SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE pyth_worker    SET statement_timeout = '120s';
ALTER ROLE pyth_worker    SET lock_timeout = '10s';
ALTER ROLE pyth_worker    SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE pyth_reporting SET statement_timeout = '60s';
ALTER ROLE pyth_reporting SET default_transaction_read_only = on;
ALTER ROLE pyth_backup    SET default_transaction_read_only = on;

-- Nobody but the superuser connects to the maintenance databases.
REVOKE ALL ON DATABASE postgres FROM PUBLIC;
REVOKE ALL ON DATABASE template1 FROM PUBLIC;
