begin;

grant usage on schema public to authenticated;

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check (char_length(display_name) between 1 and 60),
 updated_at timestamptz not null default now()
);
create table public.watchlist (
 user_id uuid not null references auth.users(id) on delete cascade,
 anime_id text not null check (char_length(anime_id) between 1 and 80),
 status text not null check (status in ('Watching','Plan to Watch','Completed')),
 deleted_at timestamptz, updated_at timestamptz not null default now(),
 primary key (user_id, anime_id)
);
create table public.watch_progress (
 user_id uuid not null references auth.users(id) on delete cascade,
 episode_key text not null check (char_length(episode_key) between 1 and 200),
 seconds double precision not null default 0 check (seconds between 0 and 1000000000),
 duration double precision not null default 0 check (duration between 0 and 1000000000),
 watched_seconds double precision not null default 0 check (watched_seconds between 0 and 1000000000),
 completed boolean not null default false, updated_at timestamptz not null default now(),
 primary key (user_id, episode_key)
);
create table public.user_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object' and octet_length(preferences::text) <= 16384),
 updated_at timestamptz not null default now()
);
create table public.user_notes (
 user_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null, anime_id text not null check (char_length(anime_id) between 1 and 80),
 body text not null check (char_length(body) between 1 and 1000),
 created_at timestamptz not null default now(), primary key (user_id, id)
);

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select, insert, update, delete on table public.profiles to authenticated;
create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "profiles_delete_own" on public.profiles for delete to authenticated using ((select auth.uid()) = id);

alter table public.watchlist enable row level security;
revoke all on table public.watchlist from anon, authenticated;
grant select, insert, update, delete on table public.watchlist to authenticated;
create policy "watchlist_select_own" on public.watchlist for select to authenticated using ((select auth.uid()) = user_id);
create policy "watchlist_insert_own" on public.watchlist for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "watchlist_update_own" on public.watchlist for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "watchlist_delete_own" on public.watchlist for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.watch_progress enable row level security;
revoke all on table public.watch_progress from anon, authenticated;
grant select, insert, update, delete on table public.watch_progress to authenticated;
create policy "watch_progress_select_own" on public.watch_progress for select to authenticated using ((select auth.uid()) = user_id);
create policy "watch_progress_insert_own" on public.watch_progress for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "watch_progress_update_own" on public.watch_progress for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "watch_progress_delete_own" on public.watch_progress for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.user_settings enable row level security;
revoke all on table public.user_settings from anon, authenticated;
grant select, insert, update, delete on table public.user_settings to authenticated;
create policy "user_settings_select_own" on public.user_settings for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_settings_insert_own" on public.user_settings for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "user_settings_update_own" on public.user_settings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "user_settings_delete_own" on public.user_settings for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.user_notes enable row level security;
revoke all on table public.user_notes from anon, authenticated;
grant select, insert, update, delete on table public.user_notes to authenticated;
create policy "user_notes_select_own" on public.user_notes for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_notes_insert_own" on public.user_notes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "user_notes_update_own" on public.user_notes for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "user_notes_delete_own" on public.user_notes for delete to authenticated using ((select auth.uid()) = user_id);

commit;
