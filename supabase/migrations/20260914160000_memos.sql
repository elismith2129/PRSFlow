-- ─────────────────────────────────────────────────────────────────────────────
-- MEMOS (Eli, 2026-09-14 evening; mock docs/design-refs/memos-options.html).
--
-- "A company memo — type into it and send to admin, runners or both. They each
-- get notified as a pop-up and they have to read and sign they acknowledge.
-- Want the accountability, but mostly want people to actually read and learn."
--
-- The SOP gate (acknowledge_sop, 2026-07-02) generalized to a feed: a memo is
-- addressed to an AUDIENCE by role, shows as a full-screen pop-up on the
-- person's landing surface, is signed with their initials, and every showing
-- leaves a receipt. Owners and managers see who signed, who put it off, and
-- who has not opened the app.
--
-- RULINGS (Eli): soft then hard — one "later", blocks after 48h; senders are
-- owners + managers (Fernando); audience is strict (runners never see admin
-- memos, runner memos never reach admin; 'everyone' reaches both); in the app
-- only (no push/SMS — hence last_seen_at, the honest limit of a pop-up); a
-- designed page renders INLINE, not as an attachment.
--
-- kind 'note' = typed rich text (RichNote HTML, sanitized on render).
-- kind 'page' = a designed memo (full HTML, e.g. the WO one-sheet), rendered
--               in a sandboxed iframe with no scripts.
--
-- A sent memo is never edited (six signatures on a changed text mean nothing);
-- it is archived. A correction is a new memo.
--
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.memos (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  kind          text not null default 'note' check (kind in ('note', 'page')),
  body_html     text not null,
  audience      text not null check (audience in ('admin', 'runners', 'everyone')),
  requires_ack  boolean not null default true,
  sent_by       uuid references public.user_profiles(id),
  sent_by_name  text,
  sent_at       timestamptz not null default now(),
  archived_at   timestamptz
);

create table if not exists public.memo_receipts (
  id               uuid primary key default gen_random_uuid(),
  memo_id          uuid not null references public.memos(id) on delete cascade,
  user_id          uuid not null references public.user_profiles(id) on delete cascade,
  first_seen_at    timestamptz not null default now(),
  -- The one "I'll read it later". Set once; the gate goes HARD 48h after it.
  deferred_at      timestamptz,
  acknowledged_at  timestamptz,
  initials         text,
  unique (memo_id, user_id)
);
create index if not exists memo_receipts_memo_idx on public.memo_receipts(memo_id);
create index if not exists memo_receipts_user_idx on public.memo_receipts(user_id);

-- "Hasn't opened the app since …" — the scoreboard's third state. Touched by
-- touch_last_seen() on every app load (both surfaces).
alter table public.user_profiles add column if not exists last_seen_at timestamptz;

-- ── Which audiences reach the caller ─────────────────────────────────────────
create or replace function public.memo_audiences_for_me()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when get_my_role() = 'runner' then array['runners', 'everyone']
    when get_my_role() is null then array[]::text[]
    else array['admin', 'everyone']
  end
$$;
revoke all on function public.memo_audiences_for_me() from public, anon;
grant execute on function public.memo_audiences_for_me() to authenticated;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.memos enable row level security;
drop policy if exists memos_sel on public.memos;
create policy memos_sel on public.memos for select to authenticated
  using (
    audience = any (memo_audiences_for_me())
    or get_my_role() in ('owner', 'manager')
  );
drop policy if exists memos_ins on public.memos;
create policy memos_ins on public.memos for insert to authenticated
  with check (get_my_role() in ('owner', 'manager'));
-- UPDATE is archive only — the app never rewrites title/body/audience, and
-- the trigger below enforces it in the database too.
drop policy if exists memos_upd on public.memos;
create policy memos_upd on public.memos for update to authenticated
  using (get_my_role() in ('owner', 'manager'))
  with check (get_my_role() in ('owner', 'manager'));

create or replace function public.memos_freeze_sent()
returns trigger language plpgsql as $$
begin
  if new.title <> old.title or new.body_html <> old.body_html
     or new.audience <> old.audience or new.kind <> old.kind
     or new.requires_ack <> old.requires_ack then
    raise exception 'A sent memo cannot be edited — archive it and send a correction.';
  end if;
  return new;
end $$;
drop trigger if exists memos_freeze_sent on public.memos;
create trigger memos_freeze_sent before update on public.memos
  for each row execute function public.memos_freeze_sent();

alter table public.memo_receipts enable row level security;
drop policy if exists memo_receipts_sel on public.memo_receipts;
create policy memo_receipts_sel on public.memo_receipts for select to authenticated
  using (
    user_id = (select id from public.user_profiles where auth_user_id = auth.uid())
    or get_my_role() in ('owner', 'manager')
  );
-- Writes go through the RPCs below (the caller's own row only).

-- ── RPCs: the person's own acts, on their own row ─────────────────────────────
create or replace function public.memo_seen(p_memo_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.memo_receipts (memo_id, user_id)
  select p_memo_id, id from public.user_profiles where auth_user_id = auth.uid()
  on conflict (memo_id, user_id) do nothing
$$;

create or replace function public.memo_defer(p_memo_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.memo_receipts (memo_id, user_id, deferred_at)
  select p_memo_id, id, now() from public.user_profiles where auth_user_id = auth.uid()
  on conflict (memo_id, user_id) do update
    set deferred_at = coalesce(public.memo_receipts.deferred_at, now())
$$;

create or replace function public.memo_ack(p_memo_id uuid, p_initials text)
returns void language sql security definer set search_path = public as $$
  insert into public.memo_receipts (memo_id, user_id, acknowledged_at, initials)
  select p_memo_id, id, now(), nullif(trim(p_initials), '') from public.user_profiles where auth_user_id = auth.uid()
  on conflict (memo_id, user_id) do update
    set acknowledged_at = coalesce(public.memo_receipts.acknowledged_at, now()),
        initials = coalesce(public.memo_receipts.initials, nullif(trim(excluded.initials), ''))
$$;

create or replace function public.touch_last_seen()
returns void language sql security definer set search_path = public as $$
  update public.user_profiles set last_seen_at = now() where auth_user_id = auth.uid()
$$;

revoke all on function public.memo_seen(uuid) from public, anon;
revoke all on function public.memo_defer(uuid) from public, anon;
revoke all on function public.memo_ack(uuid, text) from public, anon;
revoke all on function public.touch_last_seen() from public, anon;
grant execute on function public.memo_seen(uuid) to authenticated;
grant execute on function public.memo_defer(uuid) to authenticated;
grant execute on function public.memo_ack(uuid, text) to authenticated;
grant execute on function public.touch_last_seen() to authenticated;

-- ── Realtime: a new memo pops without a refresh; the scoreboard moves live ──
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'memos') then
    alter publication supabase_realtime add table public.memos;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'memo_receipts') then
    alter publication supabase_realtime add table public.memo_receipts;
  end if;
end $$;
alter table public.memos replica identity full;
alter table public.memo_receipts replica identity full;
