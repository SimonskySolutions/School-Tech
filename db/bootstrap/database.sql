-- Database-level bootstrap. Run as the postgres superuser, connected to the
-- target database, with psql variable dbname set. Idempotent.
--
--   psql -v dbname=pythagoras -d pythagoras -f database.sql

\set ON_ERROR_STOP on

REVOKE ALL ON DATABASE :"dbname" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"dbname" TO pyth_migrator, pyth_api, pyth_worker, pyth_reporting;
GRANT CONNECT ON DATABASE :"dbname" TO pyth_backup;

-- The public schema is not used; nobody may create objects in it.
ALTER SCHEMA public OWNER TO pyth_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- Extensions live in their own schema. pg_stat_statements needs a superuser.
CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION pyth_owner;
REVOKE ALL ON SCHEMA extensions FROM PUBLIC;
GRANT USAGE ON SCHEMA extensions TO pyth_api, pyth_worker, pyth_reporting;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;

-- Migration history lives in its own schema, owned by pyth_owner.
CREATE SCHEMA IF NOT EXISTS meta AUTHORIZATION pyth_owner;
REVOKE ALL ON SCHEMA meta FROM PUBLIC;
