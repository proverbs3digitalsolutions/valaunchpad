-- Consent history, data-subject requests, and an append-only audit log.
-- Depends on 0001 (current_user_id, profiles).

-- Versions of the privacy notice and terms that have been published. Only rows here can be
-- accepted. The server publishes a version after counsel approves its text.
create table consent_versions (
  kind text not null check (kind in ('privacy', 'terms')),
  version text not null check (length(version) between 1 and 40),
  published_at timestamptz not null default now(),
  primary key (kind, version)
);

-- Every acceptance of a privacy notice or terms is kept as its own row. profiles keeps only the
-- latest versions for quick checks; this table is the record that proves what was accepted.
create table consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null,
  version text not null,
  accepted_at timestamptz not null default now(),
  foreign key (kind, version) references consent_versions (kind, version)
);
create index consents_user_idx on consents (user_id, accepted_at);

-- A person asks for a copy of their data (export) or for deletion. The request is created by
-- the person; the status is changed only by server code running with service privileges.
create table data_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('export', 'delete')),
  status text not null default 'requested' check (status in ('requested', 'completed', 'rejected')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'requested') = (completed_at is null)),
  check (completed_at is null or completed_at >= requested_at)
);
create index data_requests_user_idx on data_requests (user_id, requested_at);

-- Every admin action. Append-only: no client can read it, and no role may change or remove a row.
-- actor_id has no foreign key on purpose: erasing an admin's profile must not require editing
-- this log, and the record of who acted is kept as an id.
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null check (length(action) between 1 and 80),
  target_type text not null check (length(target_type) between 1 and 40),
  target_id text not null,
  at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);

create or replace function forbid_change_to_audit_log() returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only' using errcode = 'insufficient_privilege';
end
$$;

create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function forbid_change_to_audit_log();

-- TRUNCATE skips row-level triggers, so it needs its own statement-level guard.
create trigger audit_log_no_truncate
  before truncate on audit_log
  for each statement execute function forbid_change_to_audit_log();

-- Row-level security.
alter table consent_versions enable row level security;
alter table consents enable row level security;
alter table data_requests enable row level security;
alter table audit_log enable row level security;

create policy consent_versions_read on consent_versions
  for select using (true);
create policy consents_select_own on consents
  for select using (user_id = current_user_id());
create policy consents_insert_own on consents
  for insert with check (user_id = current_user_id());

create policy data_requests_select_own on data_requests
  for select using (user_id = current_user_id());
create policy data_requests_insert_own on data_requests
  for insert with check (user_id = current_user_id() and status = 'requested' and completed_at is null);

-- audit_log has no policies: with RLS on and none defined, authenticated users see and write nothing.

-- Privileges. Start from nothing for these tables, then grant only what the app needs.
revoke all on consent_versions, consents, data_requests, audit_log from anon, authenticated;
grant select on consent_versions to authenticated;
-- Column-level inserts: a person cannot backdate a consent or move a request to another state.
grant select on consents to authenticated;
grant insert (user_id, kind, version) on consents to authenticated;
grant select on data_requests to authenticated;
grant insert (user_id, kind) on data_requests to authenticated;
