-- Sprint 1: companies, people, roles, and invites, with row-level security.
-- Works on Supabase (auth user ids come from the JWT subject) and on plain Postgres for tests.

-- Current user id from the JWT subject. Supabase sets request.jwt.claim.sub for every request.
create or replace function current_user_id() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;

create table profiles (
  id uuid primary key,
  email text not null unique check (email = lower(email)),
  name text,
  language text not null default 'tl' check (language in ('tl', 'en')),
  consent_privacy_version text,
  consent_terms_version text,
  consented_at timestamptz,
  created_at timestamptz not null default now()
);

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

create table memberships (
  org_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'learner')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null check (role in ('owner', 'learner')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now()
);

-- Security definer helpers break the recursion between memberships and its own policies.
create or replace function is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from memberships m
    where m.org_id = p_org and m.user_id = current_user_id()
  )
$$;

create or replace function is_org_owner(p_org uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from memberships m
    where m.org_id = p_org and m.user_id = current_user_id() and m.role = 'owner'
  )
$$;

-- The only way to create a company: makes the caller its first owner in one step.
create or replace function create_organization(p_name text) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid;
  v_user uuid := current_user_id();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  insert into organizations (name) values (p_name) returning id into v_org;
  insert into memberships (org_id, user_id, role) values (v_org, v_user, 'owner');
  return v_org;
end
$$;

-- The only way to join a company: the invite token must match, be unexpired and unused,
-- and the signed-in user's email must be the one the invite was sent to.
create or replace function accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := current_user_id();
  v_email text;
  v_invite invites%rowtype;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select p.email into v_email from profiles p where p.id = v_user;
  select * into v_invite from invites i
    where i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
      and i.accepted_at is null
      and i.expires_at > now()
      and exists (
        select 1 from memberships m
        where m.org_id = i.org_id and m.user_id = i.created_by and m.role = 'owner'
      )
    for update;
  if not found then
    raise exception 'invite not found, expired, or already used' using errcode = 'P0002';
  end if;
  if v_invite.email is distinct from v_email then
    raise exception 'invite was sent to a different email' using errcode = '42501';
  end if;
  insert into memberships (org_id, user_id, role)
    values (v_invite.org_id, v_user, v_invite.role)
    on conflict (org_id, user_id) do nothing;
  update invites set accepted_at = now() where id = v_invite.id;
  return v_invite.org_id;
end
$$;

-- A company always keeps at least one owner. Triggers run even for table owners, so this
-- also protects admin scripts. Any change to an owner row (demotion, move, delete) is checked.
create or replace function guard_last_owner() returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'UPDATE' and old.role = 'owner'
      and (new.role is distinct from 'owner'
           or new.org_id is distinct from old.org_id
           or new.user_id is distinct from old.user_id))
     or (tg_op = 'DELETE' and old.role = 'owner') then
    -- Lock every owner row of this company, so two concurrent demotions run one after the other.
    perform 1 from memberships m
      where m.org_id = old.org_id and m.role = 'owner'
      for update;
    if not exists (
      select 1 from memberships m
      where m.org_id = old.org_id and m.role = 'owner' and m.user_id <> old.user_id
    ) then
      raise exception 'company must keep at least one owner' using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

create trigger memberships_keep_an_owner
  before update or delete on memberships
  for each row execute function guard_last_owner();

alter table profiles enable row level security;
alter table organizations enable row level security;
alter table memberships enable row level security;
alter table invites enable row level security;

create policy profiles_select_own on profiles
  for select using (id = current_user_id());
create policy profiles_update_own on profiles
  for update using (id = current_user_id()) with check (id = current_user_id());

create policy organizations_select_member on organizations
  for select using (is_org_member(id));
create policy organizations_update_owner on organizations
  for update using (is_org_owner(id)) with check (is_org_owner(id));

create policy memberships_select on memberships
  for select using (user_id = current_user_id() or is_org_owner(org_id));
create policy memberships_update_owner on memberships
  for update using (is_org_owner(org_id)) with check (is_org_owner(org_id));
create policy memberships_delete_owner on memberships
  for delete using (is_org_owner(org_id));
-- No insert policy on memberships: people join only through accept_invite or create_organization.

create policy invites_owner_all on invites
  for all using (is_org_owner(org_id)) with check (is_org_owner(org_id));

-- Privileges. Anonymous users get nothing (Supabase grants some by default, so revoke them).
-- Column grants keep email out of client writes and keep membership ownership fixed.
-- Supabase grants authenticated full table privileges by default. Revoke them first, so only
-- the grants below apply. Future tables created by this role get no default grants either.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon, authenticated;
grant usage on schema public to authenticated;
grant select on profiles to authenticated;
grant update (name, language) on profiles to authenticated;
grant select on organizations to authenticated;
grant update (name) on organizations to authenticated;
grant select, delete on memberships to authenticated;
grant update (role) on memberships to authenticated;
grant select, insert, delete on invites to authenticated;

revoke execute on function create_organization(text) from public;
revoke execute on function accept_invite(text) from public;
revoke execute on function is_org_member(uuid) from public;
revoke execute on function is_org_owner(uuid) from public;
revoke execute on function current_user_id() from public;
grant execute on function create_organization(text) to authenticated;
grant execute on function accept_invite(text) to authenticated;
grant execute on function is_org_member(uuid) to authenticated;
grant execute on function is_org_owner(uuid) to authenticated;
grant execute on function current_user_id() to authenticated;
