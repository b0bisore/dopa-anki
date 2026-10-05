-- プレイ状況の計測(イベント記録)を追加する設定
-- Supabase の「SQL Editor」にこのファイルの中身を全部貼り付けて「Run」を押してください。何度実行しても大丈夫です。

create table if not exists public.events (
  id bigint generated always as identity primary key,
  player_id uuid not null references auth.users(id) on delete cascade,
  game_id text not null references public.games(id),
  name text not null check (char_length(name) between 1 and 40),
  props jsonb not null default '{}'::jsonb check (pg_column_size(props) < 2000),
  created_at timestamptz not null default now()
);
create index if not exists events_game_time on public.events (game_id, created_at);
create index if not exists events_name_time on public.events (name, created_at);

alter table public.events enable row level security;
-- 自分の記録を書き込むことだけできる(一般の人は読めない)
drop policy if exists "events insert own" on public.events;
create policy "events insert own" on public.events for insert with check (auth.uid() = player_id);

-- 運営用の集計(スプレッドシートから呼ぶ。一般の人は呼べない)
create or replace function public.admin_event_daily()
returns table (day date, game_id text, name text, events bigint, users bigint)
language sql security definer set search_path = public as $$
  select (created_at at time zone 'Asia/Tokyo')::date, game_id, name, count(*), count(distinct player_id)
  from public.events group by 1, 2, 3 order by 1 desc, 2, 3
$$;
create or replace function public.admin_deck_daily()
returns table (day date, game_id text, deck text, starts bigint, ends bigint, avg_score numeric, avg_correct numeric)
language sql security definer set search_path = public as $$
  select (created_at at time zone 'Asia/Tokyo')::date, game_id, coalesce(props->>'deck',''),
         count(*) filter (where name = 'game_start'), count(*) filter (where name = 'game_end'),
         round(avg((props->>'score')::numeric) filter (where name = 'game_end'), 1),
         round(avg(case when name = 'game_end' and (props->>'ans')::numeric > 0 then (props->>'ok')::numeric / (props->>'ans')::numeric * 100 end), 1)
  from public.events where name in ('game_start','game_end') group by 1, 2, 3 order by 1 desc, 2, 3
$$;
revoke execute on function public.admin_event_daily() from public, anon, authenticated;
revoke execute on function public.admin_deck_daily() from public, anon, authenticated;
grant execute on function public.admin_event_daily() to service_role;
grant execute on function public.admin_deck_daily() to service_role;
