-- ═══════════════════════════════════════════════════════════════
-- AI refinement.
--
-- The model never writes to the plan directly. It returns a typed
-- diff; the athlete ticks the changes they accept; the server
-- applies them and stores a snapshot so "deshacer" is exact.
--
-- Nothing here can touch `lifts` — the weight engine stays out of
-- the model's reach by construction.
-- ═══════════════════════════════════════════════════════════════

create table public.ai_threads (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  program_id uuid references public.programs (id) on delete cascade,
  title text not null default 'Refinar el plan',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_threads_user_idx on public.ai_threads (user_id, updated_at desc);

create table public.ai_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  thread_id uuid not null references public.ai_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  /* Token/latency bookkeeping and the raw model name. */
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index ai_messages_thread_idx on public.ai_messages (thread_id, created_at);

create table public.ai_proposals (
  id uuid primary key default extensions.gen_random_uuid(),
  thread_id uuid references public.ai_threads (id) on delete cascade,
  message_id uuid references public.ai_messages (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  program_id uuid not null references public.programs (id) on delete cascade,
  phase_id uuid references public.program_phases (id) on delete cascade,

  question text not null default '',
  rationale text not null default '',
  /* Array of typed change ops — see lib/ai/schema.ts for the contract. */
  changes jsonb not null default '[]'::jsonb,
  status public.ai_proposal_status not null default 'pending',
  /* Indices of `changes` the athlete accepted. */
  accepted_indices integer[] not null default '{}',
  /* Full plan state before applying, for an exact undo. */
  snapshot jsonb,
  applied_at timestamptz,
  undone_at timestamptz,
  created_at timestamptz not null default now()
);

create index ai_proposals_user_idx on public.ai_proposals (user_id, created_at desc);
create index ai_proposals_program_idx on public.ai_proposals (program_id, status);

create trigger ai_threads_touch_updated_at
  before update on public.ai_threads
  for each row execute function public.touch_updated_at();

alter table public.ai_threads enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_proposals enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['ai_threads', 'ai_messages', 'ai_proposals'] loop
    execute format($f$
      create policy "%1$s: owner only"
        on public.%1$I for all
        to authenticated
        using (user_id = (select auth.uid()))
        with check (user_id = (select auth.uid()));
    $f$, t);
  end loop;
end;
$$;
