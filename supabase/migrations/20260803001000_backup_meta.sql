-- Non-negotiable 8 relies on a weekly manual export nobody is reminded
-- of. Stamp each export so Ajustes can say "última copia: hace N días"
-- and warn when it goes stale.
alter table public.profiles
  add column last_export_at timestamptz;
