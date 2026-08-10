-- ============================================================
-- RLS isolation test.
--
-- Proves the claim the whole Phase 2 design rests on: an exhibitor sees
-- their own booth and nothing else, and that this is true at the
-- DATABASE, not in the UI. Run it against any environment.
--
-- The whole thing runs inside a transaction that ROLLS BACK, so it
-- leaves no fixtures behind and is safe to run against a live project.
--
-- Expected: 10 rows, all PASS.
--
-- Run with:  supabase db execute --file supabase/tests/rls_isolation_test.sql
-- or paste into the SQL editor.
-- ============================================================

begin;

create temp table result(step text, expected text, actual text, pass boolean) on commit drop;
-- the role-switched sections below need to write their findings here
grant all on result to authenticated, anon;

-- ---------- fixtures ----------
-- One planner, two competing exhibitors, one show.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('00000000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111','authenticated','authenticated','planner@sourceone.test','x',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-000000000000','22222222-2222-2222-2222-222222222222','authenticated','authenticated','encore@test','x',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-000000000000','33333333-3333-3333-3333-333333333333','authenticated','authenticated','freeman@test','x',now(),now(),now(),'{}','{}');

-- the signup trigger created the profiles; promote them deliberately
update profile set role='planner'   where id='11111111-1111-1111-1111-111111111111';
update profile set role='exhibitor' where id='22222222-2222-2222-2222-222222222222';
update profile set role='exhibitor' where id='33333333-3333-3333-3333-333333333333';

insert into show (id, name, freeze_date)
values ('aaaaaaaa-0000-0000-0000-000000000001','RLS Test Show', null);

insert into exhibitor (id, show_id, company, profile_id) values
 ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Encore Global','22222222-2222-2222-2222-222222222222'),
 ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Freeman','33333333-3333-3333-3333-333333333333');

-- two booths, each with one item inside, plus one hall element owned by
-- nobody. Five elements on the floor in total.
insert into element (id, show_id, parent_id, exhibitor_id, kind, shape, layer, geometry) values
 ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',null,'bbbbbbbb-0000-0000-0000-000000000001','space','rect','spaces','{"x":0,"y":0,"w":20,"h":20}'),
 ('cccccccc-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',null,'bbbbbbbb-0000-0000-0000-000000000002','space','rect','spaces','{"x":40,"y":0,"w":20,"h":20}'),
 ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001',null,'table','rect','contents','{"x":2,"y":2,"w":6,"h":3}'),
 ('dddddddd-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002',null,'table','rect','contents','{"x":42,"y":2,"w":6,"h":3}');

insert into element (show_id, kind, shape, layer, geometry)
values ('aaaaaaaa-0000-0000-0000-000000000001','fire-exit','rect','safety','{"x":0,"y":50,"w":2,"h":8}');

-- ============ as Encore Global, an exhibitor ============
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

insert into result select 'exhibitor sees own booth','1',count(*)::text,count(*)=1
  from element where id='cccccccc-0000-0000-0000-000000000001';
insert into result select 'exhibitor CANNOT see rival booth','0',count(*)::text,count(*)=0
  from element where id='cccccccc-0000-0000-0000-000000000002';
insert into result select 'exhibitor sees own booth contents','1',count(*)::text,count(*)=1
  from element where id='dddddddd-0000-0000-0000-000000000001';
insert into result select 'exhibitor CANNOT see rival contents','0',count(*)::text,count(*)=0
  from element where id='dddddddd-0000-0000-0000-000000000002';
insert into result select 'exhibitor CANNOT see hall fire exit','0',count(*)::text,count(*)=0
  from element where kind='fire-exit';
insert into result select 'exhibitor total visibility','2',count(*)::text,count(*)=2
  from element;
insert into result select 'exhibitor sees only own company row','1',count(*)::text,count(*)=1
  from exhibitor;

-- ============ as a planner ============
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into result select 'planner sees whole floor','5',count(*)::text,count(*)=5
  from element;
insert into result select 'planner sees both exhibitors','2',count(*)::text,count(*)=2
  from exhibitor;

-- ============ as an anonymous visitor ============
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

insert into result select 'anonymous sees nothing','0',count(*)::text,count(*)=0
  from element;

reset role;
select step, expected, actual, case when pass then 'PASS' else 'FAIL' end as verdict
from result;

rollback;
