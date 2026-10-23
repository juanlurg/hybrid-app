-- ═══════════════════════════════════════════════════════════════
-- Web Push: one row per device the athlete turned "Avisos del coach"
-- on for. The coach (MCP) leaves a pending proposal; the server pushes
-- to every row of that athlete. `endpoint` is the browser's unique push
-- URL, so a device re-subscribing replaces itself.
-- ═══════════════════════════════════════════════════════════════
create table public.push_subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions: owner only"
  on public.push_subscriptions for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
