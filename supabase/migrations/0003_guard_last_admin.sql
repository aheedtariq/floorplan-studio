-- ============================================================
-- Last-admin guard.
--
-- The admin panel hides the controls that would lock you out, but hiding
-- a button is not a guarantee — anyone holding the publishable key can
-- call the REST endpoint directly. So the invariant lives here: the
-- project must always retain at least one active admin.
--
-- Covers demotion, deactivation and deletion, because all three produce
-- the same locked-out project.
--
-- Verified (supabase/tests/last_admin_guard_test.sql):
--   demote one of two admins   -> allowed
--   demote the last admin      -> blocked
--   deactivate the last admin  -> blocked
--   delete the last admin      -> blocked
--   rename the last admin      -> allowed
-- ============================================================

create or replace function private.guard_last_admin() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  others int;
begin
  -- Only intervene when an ACTIVE ADMIN is losing that status. Every
  -- other edit — renames, unrelated role changes — passes straight
  -- through, so the guard never gets in the way of ordinary admin work.
  if tg_op = 'UPDATE'
     and old.role = 'admin' and old.active
     and (new.role <> 'admin' or new.active = false) then
    null;
  elsif tg_op = 'DELETE' and old.role = 'admin' and old.active then
    null;
  else
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select count(*) into others
  from public.profile
  where role = 'admin' and active and id <> old.id;

  if others = 0 then
    raise exception
      'Cannot remove the last active admin — promote another account first'
      using errcode = 'check_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists profile_guard_last_admin on profile;
create trigger profile_guard_last_admin
  before update or delete on profile
  for each row execute function private.guard_last_admin();
