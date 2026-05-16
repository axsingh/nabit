-- Nabit schema. Multi-tenant, fully private per user.
--
-- RLS principle (architect-mandated): every policy is exactly
-- `user_id = auth.uid()`. There is NO admin branch in RLS (a role-check
-- policy on profiles causes recursive RLS evaluation). Admin/worker
-- operations run server-side with the Supabase SERVICE ROLE key, which
-- bypasses RLS by design.

-- ─────────────────────────── profiles ───────────────────────────
create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  email           text,
  display_name    text,
  role            text not null default 'user',     -- 'user' | 'admin'
  status          text not null default 'pending',   -- 'pending' | 'approved' | 'disabled'
  push_subscription jsonb,                            -- Web Push (VAPID) sub
  phone_e164      text,                               -- Twilio SMS (opt-in)
  created_at      timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "own profile read"  on public.profiles
  for select using (id = auth.uid());
create policy "own profile update" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
-- No insert/delete policy: rows created by trigger below; never user-deleted.

-- Auto-create a pending profile when a user signs up.
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────── watches ────────────────────────────
create table public.watches (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  name             text not null,
  description      text,                  -- natural-language intent (source of truth)
  type             text,                  -- 'product'|'flight'|'hotel'|'rss'|'custom'
  source           text not null,         -- adapter key, e.g. 'apple-refurb'
  category         text,                  -- adapter sub-target, e.g. 'macbook-pro'
  sources          jsonb,                 -- [{kind,target,method}] for generic adapters
  extraction_prompt text,                 -- LLM extraction instructions (HTML sources)
  criteria         jsonb not null,        -- user-provided structured match criteria
  match_criteria   text,                  -- natural-language match rule (fallback)
  schedule         jsonb not null default '{"everyMinutes":10}'::jsonb,
  channels         text[] not null default '{email}',
  alert_mode       text not null default 'once_then_pause',
  status           text not null default 'active',  -- 'active'|'paused'
  fail_count       int  not null default 0,
  last_checked_at  timestamptz,
  last_result      jsonb,                 -- {hash, snapshot} to skip unchanged pages
  created_at       timestamptz not null default now()
);
alter table public.watches enable row level security;
create index watches_user_idx   on public.watches (user_id);
create index watches_active_idx on public.watches (status) where status = 'active';

create policy "own watches all" on public.watches
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─────────────────────────── alerts ─────────────────────────────
create table public.alerts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  watch_id         uuid not null references public.watches (id) on delete cascade,
  matched_at       timestamptz not null default now(),
  dedupe_key       text not null,         -- stable per-item key
  payload          jsonb not null,
  channels_sent    text[],
  delivery_status  jsonb
);
alter table public.alerts enable row level security;
-- Prevents re-alerting the same item for a watch (architect fix #4).
create unique index alerts_dedupe_uidx on public.alerts (watch_id, dedupe_key);
create index alerts_user_idx on public.alerts (user_id);

create policy "own alerts read" on public.alerts
  for select using (user_id = auth.uid());
-- Inserts done by worker via service role (bypasses RLS).

-- ────────────────────────── watch_runs ──────────────────────────
-- Observability: per-run log for debugging + Gemini burn tracking.
create table public.watch_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  watch_id    uuid not null references public.watches (id) on delete cascade,
  ran_at      timestamptz not null default now(),
  status      text not null,            -- ok|no_match|match|fetch_error|extract_error
  duration_ms int,
  llm_calls   int not null default 0,
  error       text
);
alter table public.watch_runs enable row level security;
create index watch_runs_watch_idx on public.watch_runs (watch_id, ran_at desc);

create policy "own runs read" on public.watch_runs
  for select using (user_id = auth.uid());
-- Inserts done by worker via service role.

-- ─────────────────── conversations / messages ───────────────────
create table public.conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text,
  created_at timestamptz not null default now()
);
alter table public.conversations enable row level security;
create policy "own conversations all" on public.conversations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role            text not null,        -- 'user'|'assistant'|'tool'
  content         jsonb not null,
  created_at      timestamptz not null default now()
);
alter table public.messages enable row level security;
create index messages_conv_idx on public.messages (conversation_id, created_at);
create policy "own messages all" on public.messages
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ───────────────────────────── notes ────────────────────────────
-- After the first user signs up, the owner promotes themselves once:
--   update public.profiles
--      set role = 'admin', status = 'approved'
--    where email = 'singh.ashutosh@gmail.com';
-- All subsequent users stay 'pending' until approved via the admin page.
