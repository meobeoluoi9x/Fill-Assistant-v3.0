-- Fill Assistant V3.5.0
-- Public personal sync: no login required. Anyone with the project URL and
-- publishable key can read or change these tables.

create table if not exists fill_logs (
  id text primary key,
  user_id uuid references auth.users(id),
  date text not null,
  machine text not null,
  slot integer,
  product text not null,
  qty integer not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz,
  device_id text
);

create table if not exists ncc_logs (
  id text primary key,
  user_id uuid references auth.users(id),
  date text not null,
  machine text not null,
  product text not null,
  qty integer not null,
  boxes integer,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz,
  device_id text
);

create table if not exists adjust_logs (
  id text primary key,
  user_id uuid references auth.users(id),
  batch_id text,
  date text not null,
  machine text not null,
  product text not null,
  qty integer not null,
  actual integer,
  reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz,
  device_id text
);

alter table fill_logs add column if not exists deleted_at timestamptz;
alter table ncc_logs add column if not exists boxes integer;
alter table ncc_logs add column if not exists deleted_at timestamptz;
alter table adjust_logs add column if not exists batch_id text;
alter table adjust_logs add column if not exists actual integer;
alter table adjust_logs add column if not exists deleted_at timestamptz;

alter table fill_logs enable row level security;
alter table ncc_logs enable row level security;
alter table adjust_logs enable row level security;

drop policy if exists "own fill logs" on fill_logs;
drop policy if exists "own ncc logs" on ncc_logs;
drop policy if exists "own adjust logs" on adjust_logs;
drop policy if exists "public fill sync" on fill_logs;
drop policy if exists "public ncc sync" on ncc_logs;
drop policy if exists "public adjust sync" on adjust_logs;

create policy "public fill sync" on fill_logs for all to anon, authenticated using (true) with check (true);
create policy "public ncc sync" on ncc_logs for all to anon, authenticated using (true) with check (true);
create policy "public adjust sync" on adjust_logs for all to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on fill_logs to anon, authenticated;
grant select, insert, update, delete on ncc_logs to anon, authenticated;
grant select, insert, update, delete on adjust_logs to anon, authenticated;
