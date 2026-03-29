-- 1) Tables
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  display_name text unique not null check (char_length(display_name) between 3 and 30),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.games (
  id bigint generated always as identity primary key,
  round_no int not null,
  game_date date not null,
  white_player text not null,
  black_player text not null,
  result text null check (result in ('white_win', 'draw', 'black_win')),
  created_at timestamptz not null default now()
);

create table if not exists public.predictions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  game_id bigint not null references public.games(id) on delete cascade,
  prediction text not null check (prediction in ('white_win', 'draw', 'black_win')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, game_id)
);

create index if not exists idx_games_game_date on public.games(game_date);
create index if not exists idx_games_round_no on public.games(round_no);
create index if not exists idx_predictions_game_id on public.predictions(game_id);
create index if not exists idx_predictions_user_id on public.predictions(user_id);

-- 2) Helper function: prediction window closes at 5:59 PM IST on game day
create or replace function public.is_prediction_open(game_day date)
returns boolean
language sql
stable
as $$
  select (
    timezone('Asia/Kolkata', now())::date = game_day
    and extract(hour from timezone('Asia/Kolkata', now())) < 18
  );
$$;

-- 3) Updated-at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists predictions_set_updated_at on public.predictions;
create trigger predictions_set_updated_at
before update on public.predictions
for each row
execute function public.set_updated_at();

-- 4) Row Level Security
alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.predictions enable row level security;

drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated
on public.profiles
for select
to authenticated
using (true);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists games_select_authenticated on public.games;
create policy games_select_authenticated
on public.games
for select
to authenticated
using (true);

drop policy if exists games_admin_update on public.games;
create policy games_admin_update
on public.games
for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin = true
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin = true
  )
);

drop policy if exists predictions_select_authenticated on public.predictions;
create policy predictions_select_authenticated
on public.predictions
for select
to authenticated
using (true);

drop policy if exists predictions_insert_own_open on public.predictions;
create policy predictions_insert_own_open
on public.predictions
for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.games g
    where g.id = game_id
      and public.is_prediction_open(g.game_date)
  )
);

drop policy if exists predictions_update_own_open on public.predictions;
create policy predictions_update_own_open
on public.predictions
for update
to authenticated
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.games g
    where g.id = game_id
      and public.is_prediction_open(g.game_date)
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.games g
    where g.id = game_id
      and public.is_prediction_open(g.game_date)
  )
);
