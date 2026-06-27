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
  device_id text
);

create table if not exists ncc_logs (
  id text primary key,
  user_id uuid references auth.users(id),
  date text not null,
  machine text not null,
  product text not null,
  qty integer not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  device_id text
);

create table if not exists adjust_logs (
  id text primary key,
  user_id uuid references auth.users(id),
  date text not null,
  machine text not null,
  product text not null,
  qty integer not null,
  reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  device_id text
);

alter table fill_logs enable row level security;
alter table ncc_logs enable row level security;
alter table adjust_logs enable row level security;

drop policy if exists "own fill logs" on fill_logs;
create policy "own fill logs"
on fill_logs
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "own ncc logs" on ncc_logs;
create policy "own ncc logs"
on ncc_logs
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "own adjust logs" on adjust_logs;
create policy "own adjust logs"
on adjust_logs
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
