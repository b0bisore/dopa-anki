-- 全ゲーム共通の倉庫(Supabase)の設定
-- 「SQL Editor」にこのファイルの中身を全部貼り付けて「Run」を押してください。
-- 何度実行しても壊れないように書いてあります。

-- ① ゲームの一覧(新しいゲームを作ったら1行足す)
create table if not exists public.games (
  id text primary key,
  name text not null
);
insert into public.games (id, name) values ('dopa-anki', 'ドパアンキ') on conflict (id) do nothing;

-- ② プレイヤー(全ゲーム共通。名前は1つ)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text check (nickname is null or char_length(nickname) between 1 and 12),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ③ ゲームごとの成績(1人×1ゲームで1行)
create table if not exists public.game_stats (
  player_id uuid not null references public.profiles(id) on delete cascade,
  game_id text not null references public.games(id),
  xp integer not null default 0 check (xp >= 0),
  lv integer not null default 1 check (lv between 1 and 9999),
  title text not null default '' check (char_length(title) <= 30),
  streak integer not null default 0 check (streak >= 0),
  day text not null default '',
  day_best integer not null default 0 check (day_best between 0 and 100000),
  plays integer not null default 0 check (plays >= 0),
  updated_at timestamptz not null default now(),
  primary key (player_id, game_id)
);

-- ④ 1回ごとのプレイ記録(運営の集計用)
create table if not exists public.plays (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.profiles(id) on delete cascade,
  game_id text not null references public.games(id),
  mode text not null default '' check (char_length(mode) <= 30),
  score integer not null default 0 check (score between 0 and 100000),
  correct integer not null default 0 check (correct between 0 and 1000),
  total integer not null default 0 check (total between 0 and 1000),
  played_at timestamptz not null default now()
);
create index if not exists plays_game_time on public.plays (game_id, played_at);

-- ⑤ 毎日の問題(ゲームごと)
create table if not exists public.daily_packs (
  game_id text not null references public.games(id),
  date text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (game_id, date)
);

-- 鍵のルール
alter table public.games enable row level security;
alter table public.profiles enable row level security;
alter table public.game_stats enable row level security;
alter table public.plays enable row level security;
alter table public.daily_packs enable row level security;

drop policy if exists "games readable" on public.games;
create policy "games readable" on public.games for select using (true);

drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select using (true);
drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "stats readable" on public.game_stats;
create policy "stats readable" on public.game_stats for select using (true);
drop policy if exists "stats insert own" on public.game_stats;
create policy "stats insert own" on public.game_stats for insert with check (auth.uid() = player_id);
drop policy if exists "stats update own" on public.game_stats;
create policy "stats update own" on public.game_stats for update using (auth.uid() = player_id) with check (auth.uid() = player_id);

drop policy if exists "plays insert own" on public.plays;
create policy "plays insert own" on public.plays for insert with check (auth.uid() = player_id);
drop policy if exists "plays read own" on public.plays;
create policy "plays read own" on public.plays for select using (auth.uid() = player_id);

drop policy if exists "packs readable" on public.daily_packs;
create policy "packs readable" on public.daily_packs for select using (true);

-- ランキング用の見え方(名前を決めた人だけ)
create or replace view public.leaderboard with (security_invoker = on) as
  select s.game_id, s.player_id, p.nickname, s.xp, s.lv, s.title, s.day, s.day_best, s.plays, s.updated_at
  from public.game_stats s join public.profiles p on p.id = s.player_id
  where p.nickname is not null;

create or replace view public.total_ranking with (security_invoker = on) as
  select p.id as player_id, p.nickname, sum(s.xp)::bigint as total_xp, count(*)::int as games, max(s.updated_at) as updated_at
  from public.profiles p join public.game_stats s on s.player_id = p.id
  where p.nickname is not null
  group by p.id, p.nickname;

grant select on public.leaderboard, public.total_ranking to anon, authenticated;

-- 運営用の集計(スプレッドシートから呼ぶ。一般の人は呼べない)
create or replace function public.admin_daily_summary()
returns table (day date, game_id text, plays bigint, players bigint, avg_correct numeric)
language sql security definer set search_path = public as $$
  select (played_at at time zone 'Asia/Tokyo')::date, game_id, count(*), count(distinct player_id),
         round(avg(case when total > 0 then correct::numeric / total * 100 end), 1)
  from public.plays group by 1, 2 order by 1 desc, 2
$$;
create or replace function public.admin_players()
returns table (nickname text, game_id text, xp integer, lv integer, plays integer, last_played timestamptz, created_at timestamptz)
language sql security definer set search_path = public as $$
  select p.nickname, s.game_id, s.xp, s.lv, s.plays, s.updated_at, p.created_at
  from public.game_stats s join public.profiles p on p.id = s.player_id
  order by s.updated_at desc
$$;
revoke execute on function public.admin_daily_summary() from public, anon, authenticated;
revoke execute on function public.admin_players() from public, anon, authenticated;
grant execute on function public.admin_daily_summary() to service_role;
grant execute on function public.admin_players() to service_role;

-- 最初のTODAY問題(2026年10月5日分)
insert into public.daily_packs (game_id, date, data) values ('dopa-anki', '2026-10-5', '{"date": "2026-10-5", "theme": "共テ頻出 英熟語10", "ask": "意味はどっち?", "lang": "en", "cards": [{"q": "look forward to", "a": "楽しみに待つ", "hook": ["分解", "forward(前)を look(見る) → 先のことを見て待つ → 楽しみに待つ"], "story": "to の後ろは名詞か -ing。look forward to see は定番のひっかけで、正しくは seeing。", "use": "I''m looking forward to the summer break.|夏休みを楽しみにしている。"}, {"q": "put off", "a": "延期する", "hook": ["イメージ", "予定を put(置いて) off(離す) → 先に回す → 延期する"], "story": "postpone と同じ意味。言い換え問題でペアにされやすい。", "use": "Don''t put off your homework until tomorrow.|宿題を明日に延ばさないで。"}, {"q": "give up", "a": "あきらめる", "hook": ["イメージ", "両手を up(上げて) 降参する姿 → あきらめる"], "story": "give up smoking(たばこをやめる)のように、習慣をやめる意味でもよく使う。", "use": "Never give up on your dream.|夢をあきらめないで。"}, {"q": "take part in", "a": "参加する", "hook": ["分解", "part(一部・役)を take(取る) → 役を担う → 参加する"], "story": "participate in と同じ意味。前に出た participate とセットで覚えると2倍おいしい。", "use": "Over 30 students took part in the contest.|30人以上の生徒がコンテストに参加した。"}, {"q": "come up with", "a": "思いつく", "hook": ["イメージ", "アイデアが頭の中に up(浮かび上がって) come(来る) → 思いつく"], "story": "think of とほぼ同じ意味。企画会議やグループワークでよく使う。", "use": "She came up with a great idea.|彼女はすごいアイデアを思いついた。"}, {"q": "get rid of", "a": "取り除く", "hook": ["語源", "rid は「自由にする」。いらない物から自由になる → 取り除く・処分する"], "story": "部屋の片付け、悪い習慣、ストレスなど、なくしたいもの全般に使える便利な熟語。", "use": "I want to get rid of this bad habit.|この悪いクセをなくしたい。"}, {"q": "make use of", "a": "利用する", "hook": ["分解", "use(使うこと)を make(する) → 利用する"], "story": "make good use of で「うまく活用する」。good や full をはさむ形がよく出る。", "use": "Make good use of your free time.|自由時間をうまく活用しよう。"}, {"q": "carry out", "a": "実行する", "hook": ["イメージ", "計画を外へ out まで carry(運び出す) → 最後までやり切る → 実行する"], "story": "実験・調査・計画など、きちんとした手順のあるものに使うことが多い。", "use": "We carried out a survey at school.|学校でアンケート調査を行った。"}, {"q": "turn down", "a": "断る", "hook": ["イメージ", "音量のつまみを down に回すように、申し出を下げる → 断る"], "story": "「音量を下げる」という元の意味でも使う。Turn down the music. は「音楽の音を小さくして」。", "use": "He turned down the invitation.|彼は招待を断った。"}, {"q": "look up to", "a": "尊敬する", "hook": ["イメージ", "相手を up(見上げる) → 尊敬する。反対は look down on(見下す)"], "story": "respect と同じ意味。反対語の look down on とペアで出題されやすい。", "use": "I look up to my older sister.|私は姉を尊敬している。"}]}'::jsonb)
on conflict (game_id, date) do nothing;

-- ⑥ プレイ状況の計測(イベント記録)
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
