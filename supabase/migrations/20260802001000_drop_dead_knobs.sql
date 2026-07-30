-- Ajustes advertised eight mechanisms that did not exist: lb/mi units,
-- an FC MÁX zone model, and three notification toggles no code ever
-- read — no push handler, no cron, no consumer anywhere. The app's own
-- copy voice is "state the mechanism"; a stored preference with no
-- mechanism is vaporware, so the columns go with the controls. (The
-- enums each had a single consumer column — verified before dropping.)
alter table public.profiles
  drop column units,
  drop column distance_unit,
  drop column zone_model,
  drop column notify_session,
  drop column notify_deload,
  drop column notify_weekly_summary;

drop type public.unit_system;
drop type public.distance_unit;
drop type public.zone_model;
