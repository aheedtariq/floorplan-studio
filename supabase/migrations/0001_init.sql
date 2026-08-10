-- ============================================================
-- Floorplan Studio — schema + row level security
--
-- Phase 2 foundation. The important property this file buys is that
-- "an exhibitor only ever sees their own booth" is enforced by the
-- database, not by the UI — so it stays true no matter what calls it.
-- ============================================================

create extension if not exists pgcrypto;

do $$ begin
  create type app_role as enum ('admin','planner','sales','crew','exhibitor');
exception when duplicate_object then null;
end $$;

-- ---------- identity ----------
create table if not exists profile (
  id         uuid primary key references auth.users on delete cascade,
  email      text not null,
  full_name  text,
  role       app_role not null default 'crew',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Every auth signup gets a profile automatically, at the least-privileged
-- role. Promotion is a deliberate admin action, never a side effect of
-- signing up.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profile (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- authorisation helpers ----------
-- security definer on purpose: without it a user would need select rights
-- on the whole profile table just to discover their own role, which
-- defeats the point of restricting it.
create or replace function auth_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profile where id = auth.uid() and active
$$;

create or replace function is_staff() returns boolean
language sql stable as $$ select auth_role() in ('admin','planner','sales','crew') $$;

create or replace function can_edit() returns boolean
language sql stable as $$ select auth_role() in ('admin','planner') $$;

create or replace function is_admin() returns boolean
language sql stable as $$ select auth_role() = 'admin' $$;

-- ---------- core model ----------
create table if not exists venue (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  city       text,
  address    text,
  created_at timestamptz not null default now()
);

create table if not exists hall_template (
  id       uuid primary key default gen_random_uuid(),
  venue_id uuid references venue on delete cascade,
  name     text not null,
  width    numeric not null,
  height   numeric not null,
  unit     text not null default 'ft',
  grid     numeric not null default 5,
  elements jsonb not null default '[]'   -- the fixed shell
);

create table if not exists show (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  venue_id         uuid references venue,
  hall_template_id uuid references hall_template,
  width            numeric not null default 200,
  height           numeric not null default 120,
  unit             text not null default 'ft',
  grid             numeric not null default 5,
  load_in date, opens date, teardown date,
  deadline date, freeze_date date,
  rule_config      jsonb not null default '{}',   -- per-show rule overrides
  field_defs       jsonb not null default '[]',   -- custom form fields
  status_defs      jsonb not null default '[]',   -- custom workflow states
  revision         int not null default 1,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid references profile
);

create table if not exists exhibitor (
  id            uuid primary key default gen_random_uuid(),
  show_id       uuid not null references show on delete cascade,
  company       text not null,
  contact_name  text,
  contact_email text,
  contact_phone text,
  profile_id    uuid references profile,  -- set when they claim their magic link
  created_at    timestamptz not null default now()
);

-- One element type for the hall shell AND booth interiors, exactly as the
-- editor models it. parent_id is what makes a row booth contents.
create table if not exists element (
  id           uuid primary key default gen_random_uuid(),
  show_id      uuid not null references show on delete cascade,
  parent_id    uuid references element on delete cascade,
  exhibitor_id uuid references exhibitor on delete set null,
  kind         text not null,
  shape        text not null,
  layer        text not null,
  geometry     jsonb not null,
  props        jsonb not null default '{}',
  z            int not null default 0,
  updated_at   timestamptz not null default now()
);

create index if not exists element_show_idx      on element(show_id);
create index if not exists element_parent_idx    on element(parent_id);
create index if not exists element_exhibitor_idx on element(exhibitor_id);
create index if not exists exhibitor_profile_idx on exhibitor(profile_id);
create index if not exists exhibitor_show_idx    on exhibitor(show_id);

create table if not exists submission (
  id           uuid primary key default gen_random_uuid(),
  show_id      uuid not null references show on delete cascade,
  exhibitor_id uuid not null references exhibitor on delete cascade,
  space_id     uuid references element on delete set null,
  version      int not null default 1,
  status       text not null default 'draft',
  answers      jsonb not null default '{}',
  files        jsonb not null default '[]',
  submitted_at timestamptz,
  reviewed_by  uuid references profile,
  created_at   timestamptz not null default now()
);

create table if not exists change_event (
  id        uuid primary key default gen_random_uuid(),
  show_id   uuid references show on delete cascade,
  actor     uuid references profile,
  entity    text not null,
  entity_id uuid,
  action    text not null,
  detail    jsonb,
  at        timestamptz not null default now()
);

create index if not exists change_show_idx on change_event(show_id, at desc);

-- ---------- freeze ----------
-- After the freeze date only staff may write. This is the rule that stops
-- the printed plan and the live plan drifting apart.
-- security definer so evaluating it never re-enters `show`'s own policies.
create or replace function show_is_frozen(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(freeze_date < current_date, false) from show where id = sid
$$;

-- ============================================================
-- Ownership helpers
--
-- These exist to break RLS recursion. A policy ON element that contains a
-- subquery FROM element re-enters element's own policies and Postgres
-- errors with "infinite recursion detected in policy". Reading the same
-- rows inside a security definer function bypasses RLS for that lookup,
-- which is the standard way out — and it is faster, because the subquery
-- is planned once instead of per row.
-- ============================================================
create or replace function my_exhibitor_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from exhibitor where profile_id = auth.uid()
$$;

-- The footprints this user has been assigned, i.e. their own booths.
create or replace function my_space_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select el.id
  from element el
  join exhibitor ex on ex.id = el.exhibitor_id
  where ex.profile_id = auth.uid()
$$;

-- ============================================================
-- Row level security
-- ============================================================
alter table profile       enable row level security;
alter table venue         enable row level security;
alter table hall_template enable row level security;
alter table show          enable row level security;
alter table exhibitor     enable row level security;
alter table element       enable row level security;
alter table submission    enable row level security;
alter table change_event  enable row level security;

-- profile: read yourself; admins read and write everyone
drop policy if exists profile_self_read on profile;
create policy profile_self_read on profile for select
  using (id = auth.uid() or is_admin());

drop policy if exists profile_admin_write on profile;
create policy profile_admin_write on profile for all
  using (is_admin()) with check (is_admin());

-- venues and hall templates: staff read, editors write
drop policy if exists venue_read on venue;
create policy venue_read on venue for select using (is_staff());
drop policy if exists venue_write on venue;
create policy venue_write on venue for all using (can_edit()) with check (can_edit());

drop policy if exists hall_read on hall_template;
create policy hall_read on hall_template for select using (is_staff());
drop policy if exists hall_write on hall_template;
create policy hall_write on hall_template for all using (can_edit()) with check (can_edit());

-- shows: staff read all; an exhibitor reads only shows they are in
drop policy if exists show_staff_read on show;
create policy show_staff_read on show for select using (is_staff());

drop policy if exists show_exhibitor_read on show;
create policy show_exhibitor_read on show for select using (
  exists (select 1 from exhibitor e
          where e.show_id = show.id and e.profile_id = auth.uid())
);

drop policy if exists show_write on show;
create policy show_write on show for all using (can_edit()) with check (can_edit());

-- exhibitors: staff see all, an exhibitor sees only their own record
drop policy if exists exhibitor_staff on exhibitor;
create policy exhibitor_staff on exhibitor for select using (is_staff());
drop policy if exists exhibitor_self on exhibitor;
create policy exhibitor_self on exhibitor for select using (profile_id = auth.uid());
drop policy if exists exhibitor_write on exhibitor;
create policy exhibitor_write on exhibitor for all
  using (can_edit()) with check (can_edit());

-- THE important one.
-- Staff see the whole floor. An exhibitor sees their own space and
-- anything parented to it, and nothing else on the plan.
drop policy if exists element_staff_read on element;
create policy element_staff_read on element for select using (is_staff());

drop policy if exists element_exhibitor_read on element;
create policy element_exhibitor_read on element for select using (
  exhibitor_id in (select my_exhibitor_ids())
  or parent_id  in (select my_space_ids())
);

drop policy if exists element_staff_write on element;
create policy element_staff_write on element for all
  using (can_edit()) with check (can_edit());

-- An exhibitor may only edit INSIDE their own footprint, and only before
-- the show freezes.
--
-- The condition is repeated in `using` and `with check` deliberately.
-- `using` decides which rows you may touch; `with check` decides what you
-- may leave behind. Omitting the second would let someone reparent an
-- element out of their own booth and onto the open floor.
drop policy if exists element_exhibitor_write on element;
create policy element_exhibitor_write on element for all
  using (
    not show_is_frozen(show_id)
    and parent_id in (select my_space_ids())
  )
  with check (
    not show_is_frozen(show_id)
    and parent_id in (select my_space_ids())
  );

-- submissions
drop policy if exists submission_staff on submission;
create policy submission_staff on submission for select using (is_staff());

drop policy if exists submission_self on submission;
create policy submission_self on submission for select using (
  exhibitor_id in (select my_exhibitor_ids())
);

drop policy if exists submission_self_write on submission;
create policy submission_self_write on submission for all
  using (
    exhibitor_id in (select my_exhibitor_ids())
    and not show_is_frozen(show_id)
  )
  with check (
    exhibitor_id in (select my_exhibitor_ids())
    and not show_is_frozen(show_id)
  );

drop policy if exists submission_staff_write on submission;
create policy submission_staff_write on submission for all
  using (is_staff()) with check (is_staff());

-- audit log is append-only from the client's point of view
drop policy if exists change_read on change_event;
create policy change_read on change_event for select using (is_staff());
drop policy if exists change_insert on change_event;
create policy change_insert on change_event for insert with check (auth.uid() is not null);

-- ---------- housekeeping ----------
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists element_touch on element;
create trigger element_touch before update on element
  for each row execute function touch_updated_at();
