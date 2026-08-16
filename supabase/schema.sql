-- Praktikaportaal — Supabase schema for accounts (favorites / saved
-- searches / recently-viewed), replacing the static site's localStorage-only
-- storage with real per-account data via Supabase Auth + Postgres.
--
-- Run this once in the Supabase dashboard: Project -> SQL Editor -> New
-- query -> paste this whole file -> Run. Safe to re-run (uses IF NOT
-- EXISTS / CREATE OR REPLACE throughout).
--
-- Accounts themselves are handled entirely by Supabase Auth (auth.users) —
-- there is no separate "users" table here, the same way the old C++
-- UserStore isn't touched by this file. Every table below just references
-- auth.users(id).
--
-- Security model: every table has Row Level Security (RLS) enabled and is
-- readable/writable ONLY by its owning user (auth.uid() = user_id). The
-- anon/authenticated Postgres roles get no table privileges beyond what RLS
-- allows — this is the only access boundary once the frontend calls
-- Supabase directly from the browser (see README's "Accounts (Supabase)"
-- section for why that matters).

-- ---------- favorites ----------

create table if not exists public.favorites (
  user_id       uuid        not null references auth.users(id) on delete cascade,
  internship_id text        not null check (char_length(internship_id) between 1 and 100),
  created_at    timestamptz not null default now(),
  primary key (user_id, internship_id)
);

alter table public.favorites enable row level security;

drop policy if exists "favorites_select_own" on public.favorites;
create policy "favorites_select_own" on public.favorites
  for select using (auth.uid() = user_id);

drop policy if exists "favorites_insert_own" on public.favorites;
create policy "favorites_insert_own" on public.favorites
  for insert with check (auth.uid() = user_id);

drop policy if exists "favorites_delete_own" on public.favorites;
create policy "favorites_delete_own" on public.favorites
  for delete using (auth.uid() = user_id);

-- ---------- saved_searches ----------

create table if not exists public.saved_searches (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  name       text        not null check (char_length(name) between 1 and 200),
  query      text        not null check (char_length(query) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists saved_searches_user_id_idx on public.saved_searches(user_id);

alter table public.saved_searches enable row level security;

drop policy if exists "saved_searches_select_own" on public.saved_searches;
create policy "saved_searches_select_own" on public.saved_searches
  for select using (auth.uid() = user_id);

drop policy if exists "saved_searches_insert_own" on public.saved_searches;
create policy "saved_searches_insert_own" on public.saved_searches
  for insert with check (auth.uid() = user_id);

drop policy if exists "saved_searches_delete_own" on public.saved_searches;
create policy "saved_searches_delete_own" on public.saved_searches
  for delete using (auth.uid() = user_id);

-- ---------- recently_viewed ----------

create table if not exists public.recently_viewed (
  user_id       uuid        not null references auth.users(id) on delete cascade,
  internship_id text        not null check (char_length(internship_id) between 1 and 100),
  viewed_at     timestamptz not null default now(),
  primary key (user_id, internship_id)
);

alter table public.recently_viewed enable row level security;

drop policy if exists "recently_viewed_select_own" on public.recently_viewed;
create policy "recently_viewed_select_own" on public.recently_viewed
  for select using (auth.uid() = user_id);

-- Re-viewing something already in the list should move it to the front, not
-- duplicate it — the frontend does this as an upsert on (user_id,
-- internship_id), so insert AND update both need a same-owner check.
drop policy if exists "recently_viewed_insert_own" on public.recently_viewed;
create policy "recently_viewed_insert_own" on public.recently_viewed
  for insert with check (auth.uid() = user_id);

drop policy if exists "recently_viewed_update_own" on public.recently_viewed;
create policy "recently_viewed_update_own" on public.recently_viewed
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Keep only the 20 most recent views per user — mirrors the cap the old C++
-- UserStore enforced in-process. Enforced here via trigger (rather than
-- trusting the client to prune) since RLS only governs row *ownership*, not
-- how many rows an owner may keep.
create or replace function public.prune_recently_viewed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.recently_viewed
  where user_id = new.user_id
    and internship_id not in (
      select internship_id from public.recently_viewed
      where user_id = new.user_id
      order by viewed_at desc
      limit 20
    );
  return null;
end;
$$;

drop trigger if exists trg_prune_recently_viewed on public.recently_viewed;
create trigger trg_prune_recently_viewed
  after insert or update on public.recently_viewed
  for each row execute function public.prune_recently_viewed();

-- ---------- explicit grants (defense in depth alongside RLS) ----------
-- Supabase's default roles (anon, authenticated) get broad default table
-- privileges; RLS is the real gate, but revoking-then-granting narrows the
-- blast radius of a future RLS policy mistake. anon gets nothing — every
-- table here requires a logged-in user.

revoke all on public.favorites, public.saved_searches, public.recently_viewed from anon;
grant select, insert, delete on public.favorites to authenticated;
grant select, insert, delete on public.saved_searches to authenticated;
grant select, insert, update on public.recently_viewed to authenticated;
