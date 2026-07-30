-- ═══════════════════════════════════════════════════════════════
-- Table privileges.
--
-- This Postgres/Supabase image does not hand DML on newly created
-- public tables to the API roles, so PostgREST answers every query
-- with "permission denied" no matter what the RLS policies say.
-- Grant explicitly, and set the default for tables added later.
--
-- RLS is still what decides which ROWS a request can see; these
-- grants only open the door far enough for the policies to run.
-- `anon` deliberately gets nothing: there is no policy for it, and
-- no screen reads data before sign-in.
-- ═══════════════════════════════════════════════════════════════

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete
  on all tables in schema public
  to authenticated, service_role;

grant usage, select on all sequences in schema public
  to authenticated, service_role;

grant execute on all functions in schema public
  to authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables
  to authenticated, service_role;

alter default privileges in schema public
  grant usage, select on sequences
  to authenticated, service_role;

alter default privileges in schema public
  grant execute on functions
  to authenticated, service_role;

-- Templates stay read-only for athletes through the RLS policies in
-- 20260729000200_programs.sql, not through column privileges.
