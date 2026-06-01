-- Per-user daily heartbeat: a daily "still watching, here's what happened
-- in the last 24h" email. Throttled with last_heartbeat_at to guard against
-- duplicate sends across retried cron runs.

alter table public.profiles
  add column if not exists last_heartbeat_at  timestamptz,
  add column if not exists daily_digest_enabled boolean not null default true;
