-- A person's copy of their own data (RA 10173 right of access). Depends on 0001 and 0002.
-- Returns only the caller's rows. It is security definer so it can read across the tables that
-- row-level security would otherwise hide, so every query filters on current_user_id() itself.
-- It never includes audit_log (admin records about other people) or other people's data.

create or replace function export_my_data() returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := current_user_id();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  return jsonb_build_object(
    'exported_at', now(),
    'profile', (
      select jsonb_build_object(
        'email', p.email,
        'name', p.name,
        'language', p.language,
        'privacy_version_accepted', p.consent_privacy_version,
        'terms_version_accepted', p.consent_terms_version,
        'consented_at', p.consented_at,
        'created_at', p.created_at)
      from profiles p where p.id = v_user
    ),
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object('name', o.name, 'role', m.role) order by o.name)
      from memberships m join organizations o on o.id = m.org_id
      where m.user_id = v_user
    ), '[]'::jsonb),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object('kind', c.kind, 'version', c.version, 'accepted_at', c.accepted_at)
                       order by c.accepted_at)
      from consents c where c.user_id = v_user
    ), '[]'::jsonb),
    'data_requests', coalesce((
      select jsonb_agg(jsonb_build_object('kind', d.kind, 'status', d.status,
                                          'requested_at', d.requested_at, 'completed_at', d.completed_at)
                       order by d.requested_at)
      from data_requests d where d.user_id = v_user
    ), '[]'::jsonb)
  );
end
$$;

revoke execute on function export_my_data() from public;
grant execute on function export_my_data() to authenticated;
