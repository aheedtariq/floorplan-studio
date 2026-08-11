-- ============================================================
-- Catalog and orders.
--
-- SourceOne already has the product side solved in "Build an Exhibit":
-- BeMatrix booth packages, furniture, counters, accessories, carpet, and
-- graphics with exact artwork dimensions. What it lacks is persistence —
-- the configurator states outright that the layout resets on reload and
-- that uploaded artwork is never stored, so the exhibitor emails a PDF
-- and somebody re-keys it by hand.
--
-- These two tables close that loop. A catalog_item is a product record;
-- an order_line is one exhibitor wanting N of them for a specific booth
-- at a specific show. Because both hang off the same show/exhibitor
-- graph as everything else, an order can be printed onto the booth work
-- order the crew already carries.
-- ============================================================

create table if not exists catalog_item (
  id            uuid primary key default gen_random_uuid(),
  -- null show_id = available on every show; set it to scope a product
  -- to one show without duplicating the global catalog
  show_id       uuid references show on delete cascade,
  category      text not null,
  sku           text,
  name          text not null,
  description   text,
  image_url     text,
  -- null price means "quote on request" rather than free
  price         numeric,
  unit          text not null default 'each',
  options       jsonb not null default '{}',
  -- graphics carry their artwork spec here: px dimensions, bleed, format
  spec          jsonb not null default '{}',
  lead_time_days int,
  active        boolean not null default true,
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists catalog_show_idx on catalog_item(show_id);
create index if not exists catalog_cat_idx  on catalog_item(category, sort);

create table if not exists order_line (
  id              uuid primary key default gen_random_uuid(),
  show_id         uuid not null references show on delete cascade,
  exhibitor_id    uuid not null references exhibitor on delete cascade,
  submission_id   uuid references submission on delete set null,
  catalog_item_id uuid references catalog_item on delete set null,
  qty             int not null default 1 check (qty > 0),
  options         jsonb not null default '{}',
  -- price captured at order time; the catalog may be repriced later and
  -- an exhibitor must not silently owe a different number
  price_each      numeric,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists order_exhibitor_idx on order_line(exhibitor_id);
create index if not exists order_show_idx      on order_line(show_id);

drop trigger if exists order_line_touch on order_line;
create trigger order_line_touch before update on order_line
  for each row execute function private.touch_updated_at();

-- ---------- row level security ----------
alter table catalog_item enable row level security;
alter table order_line   enable row level security;

drop policy if exists catalog_read on catalog_item;
create policy catalog_read on catalog_item for select
  using (auth.uid() is not null and active);

drop policy if exists catalog_staff_read on catalog_item;
create policy catalog_staff_read on catalog_item for select
  using (private.is_staff());

drop policy if exists catalog_write on catalog_item;
create policy catalog_write on catalog_item for all
  using (private.can_edit()) with check (private.can_edit());

-- An exhibitor sees and edits only their own order, and only before the
-- show freezes — the same rule the layout and submission already follow.
drop policy if exists order_staff_read on order_line;
create policy order_staff_read on order_line for select using (private.is_staff());

drop policy if exists order_self_read on order_line;
create policy order_self_read on order_line for select
  using (exhibitor_id in (select private.my_exhibitor_ids()));

drop policy if exists order_self_write on order_line;
create policy order_self_write on order_line for all
  using (
    exhibitor_id in (select private.my_exhibitor_ids())
    and not private.show_is_frozen(show_id)
  )
  with check (
    exhibitor_id in (select private.my_exhibitor_ids())
    and not private.show_is_frozen(show_id)
  );

drop policy if exists order_staff_write on order_line;
create policy order_staff_write on order_line for all
  using (private.is_staff()) with check (private.is_staff());
