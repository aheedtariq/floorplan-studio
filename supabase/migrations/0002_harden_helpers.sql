-- ============================================================
-- Hardening pass.
--
-- Two problems the Supabase linter caught after 0001, both real:
--
-- 1. The helper functions sat in `public`, which PostgREST exposes. That
--    published auth_role(), my_space_ids() and friends as callable RPC
--    endpoints — including to anonymous callers. They only ever return
--    the caller's own rows, so nothing leaked, but there is no reason to
--    publish them at all.
--
-- 2. They had a mutable search_path. A SECURITY DEFINER function without
--    a pinned search_path can be tricked into resolving a table name to
--    an attacker-controlled schema, and these run as the owner.
--
-- Fix: move them into a `private` schema that PostgREST does not expose,
-- and pin search_path on every one. Policies keep calling them, because
-- RLS expressions are evaluated as the querying user and we still grant
-- EXECUTE — they simply are not reachable over the API any more.
--
-- After this migration `get_advisors(security)` returns zero lints.
-- ============================================================

create schema if not exists private;

-- ---------- helpers, relocated and pinned ----------
create or replace function private.auth_role() returns app_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.profile where id = auth.uid() and active
$$;

create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select private.auth_role() in ('admin','planner','sales','crew')
$$;

create or replace function private.can_edit() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select private.auth_role() in ('admin','planner')
$$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select private.auth_role() = 'admin'
$$;

create or replace function private.show_is_frozen(sid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(freeze_date < current_date, false) from public.show where id = sid
$$;

create or replace function private.my_exhibitor_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.exhibitor where profile_id = auth.uid()
$$;

create or replace function private.my_space_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select el.id
  from public.element el
  join public.exhibitor ex on ex.id = el.exhibitor_id
  where ex.profile_id = auth.uid()
$$;

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profile (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function private.touch_updated_at() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- RLS expressions run as the querying role, so both anon and
-- authenticated need to be able to call these — but only from inside a
-- policy, never over the API, which the schema move already prevents.
grant usage on schema private to anon, authenticated, service_role;
grant execute on all functions in schema private to anon, authenticated, service_role;
grant execute on function private.handle_new_user() to supabase_auth_admin;

-- ---------- repoint triggers ----------
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

drop trigger if exists element_touch on element;
create trigger element_touch before update on element
  for each row execute function private.touch_updated_at();

-- ---------- repoint every policy ----------
drop policy if exists profile_self_read on profile;
create policy profile_self_read on profile for select
  using (id = auth.uid() or private.is_admin());

drop policy if exists profile_admin_write on profile;
create policy profile_admin_write on profile for all
  using (private.is_admin()) with check (private.is_admin());

drop policy if exists venue_read on venue;
create policy venue_read on venue for select using (private.is_staff());
drop policy if exists venue_write on venue;
create policy venue_write on venue for all
  using (private.can_edit()) with check (private.can_edit());

drop policy if exists hall_read on hall_template;
create policy hall_read on hall_template for select using (private.is_staff());
drop policy if exists hall_write on hall_template;
create policy hall_write on hall_template for all
  using (private.can_edit()) with check (private.can_edit());

drop policy if exists show_staff_read on show;
create policy show_staff_read on show for select using (private.is_staff());

drop policy if exists show_exhibitor_read on show;
create policy show_exhibitor_read on show for select using (
  exists (select 1 from exhibitor e
          where e.show_id = show.id and e.profile_id = auth.uid())
);

drop policy if exists show_write on show;
create policy show_write on show for all
  using (private.can_edit()) with check (private.can_edit());

drop policy if exists exhibitor_staff on exhibitor;
create policy exhibitor_staff on exhibitor for select using (private.is_staff());
drop policy if exists exhibitor_self on exhibitor;
create policy exhibitor_self on exhibitor for select using (profile_id = auth.uid());
drop policy if exists exhibitor_write on exhibitor;
create policy exhibitor_write on exhibitor for all
  using (private.can_edit()) with check (private.can_edit());

drop policy if exists element_staff_read on element;
create policy element_staff_read on element for select using (private.is_staff());

drop policy if exists element_exhibitor_read on element;
create policy element_exhibitor_read on element for select using (
  exhibitor_id in (select private.my_exhibitor_ids())
  or parent_id  in (select private.my_space_ids())
);

drop policy if exists element_staff_write on element;
create policy element_staff_write on element for all
  using (private.can_edit()) with check (private.can_edit());

drop policy if exists element_exhibitor_write on element;
create policy element_exhibitor_write on element for all
  using (
    not private.show_is_frozen(show_id)
    and parent_id in (select private.my_space_ids())
  )
  with check (
    not private.show_is_frozen(show_id)
    and parent_id in (select private.my_space_ids())
  );

drop policy if exists submission_staff on submission;
create policy submission_staff on submission for select using (private.is_staff());

drop policy if exists submission_self on submission;
create policy submission_self on submission for select using (
  exhibitor_id in (select private.my_exhibitor_ids())
);

drop policy if exists submission_self_write on submission;
create policy submission_self_write on submission for all
  using (
    exhibitor_id in (select private.my_exhibitor_ids())
    and not private.show_is_frozen(show_id)
  )
  with check (
    exhibitor_id in (select private.my_exhibitor_ids())
    and not private.show_is_frozen(show_id)
  );

drop policy if exists submission_staff_write on submission;
create policy submission_staff_write on submission for all
  using (private.is_staff()) with check (private.is_staff());

drop policy if exists change_read on change_event;
create policy change_read on change_event for select using (private.is_staff());
drop policy if exists change_insert on change_event;
create policy change_insert on change_event for insert with check (auth.uid() is not null);

-- ---------- drop the exposed originals ----------
drop function if exists public.my_space_ids();
drop function if exists public.my_exhibitor_ids();
drop function if exists public.show_is_frozen(uuid);
drop function if exists public.is_admin();
drop function if exists public.can_edit();
drop function if exists public.is_staff();
drop function if exists public.auth_role();
drop function if exists public.handle_new_user();
drop function if exists public.touch_updated_at();
