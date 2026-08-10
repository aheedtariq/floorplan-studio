-- ============================================================
-- Last-admin guard test.
--
-- Proves you cannot lock yourself out of the project, and that the guard
-- does not interfere with ordinary admin edits.
--
-- Runs inside a transaction that ROLLS BACK, so it is safe against a
-- live project. Expected: 5 rows, every outcome marked "(correct)".
-- ============================================================

begin;
create temp table r(step text, outcome text) on commit drop;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('00000000-0000-0000-0000-000000000000','a1111111-1111-1111-1111-111111111111','authenticated','authenticated','admin1@test','x',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-000000000000','a2222222-2222-2222-2222-222222222222','authenticated','authenticated','admin2@test','x',now(),now(),now(),'{}','{}');

update profile set role='admin' where id in
 ('a1111111-1111-1111-1111-111111111111','a2222222-2222-2222-2222-222222222222');

-- with two admins, demoting one is fine
do $$ begin
  update profile set role='planner' where id='a2222222-2222-2222-2222-222222222222';
  insert into r values ('demote one of two admins','allowed (correct)');
exception when others then
  insert into r values ('demote one of two admins','BLOCKED: '||sqlerrm);
end $$;

-- one admin left: each of these would lock the project
do $$ begin
  update profile set role='crew' where id='a1111111-1111-1111-1111-111111111111';
  insert into r values ('demote the last admin','ALLOWED (bad)');
exception when others then
  insert into r values ('demote the last admin','blocked (correct)');
end $$;

do $$ begin
  update profile set active=false where id='a1111111-1111-1111-1111-111111111111';
  insert into r values ('deactivate the last admin','ALLOWED (bad)');
exception when others then
  insert into r values ('deactivate the last admin','blocked (correct)');
end $$;

do $$ begin
  delete from profile where id='a1111111-1111-1111-1111-111111111111';
  insert into r values ('delete the last admin','ALLOWED (bad)');
exception when others then
  insert into r values ('delete the last admin','blocked (correct)');
end $$;

-- the guard must not block edits that keep the admin an admin
do $$ begin
  update profile set full_name='Renamed' where id='a1111111-1111-1111-1111-111111111111';
  insert into r values ('rename the last admin','allowed (correct)');
exception when others then
  insert into r values ('rename the last admin','BLOCKED: '||sqlerrm);
end $$;

select * from r;
rollback;
