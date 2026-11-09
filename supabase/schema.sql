-- =====================================================================
--  Dujone চ্যাট — Supabase স্কিমা
--  Supabase ড্যাশবোর্ড → SQL Editor → New query → পুরোটা পেস্ট করে Run দিন।
--  ফাইলটি একাধিকবার চালালেও সমস্যা নেই (re-runnable)।
-- =====================================================================

-- ---------------------------------------------------------------------
-- ১. প্রোফাইল টেবিল (সদস্য তালিকা — সর্বোচ্চ ২ জন)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'ব্যবহারকারী' check (char_length(display_name) between 1 and 40),
  avatar_url   text,
  last_seen    timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- ২. মেসেজ টেবিল
-- ---------------------------------------------------------------------
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  content     text check (content is null or char_length(content) <= 4000),
  image_path  text,
  created_at  timestamptz not null default now(),
  seen_at     timestamptz,
  constraint message_not_empty check (
    coalesce(nullif(btrim(content), ''), image_path) is not null
  )
);

create index if not exists messages_created_at_idx on public.messages (created_at desc);
create index if not exists messages_unseen_idx on public.messages (sender_id) where seen_at is null;

-- DELETE ইভেন্টে পুরো রো পাঠানোর জন্য (রিয়েলটাইম)
alter table public.messages replica identity full;

-- ---------------------------------------------------------------------
-- ৩. হেল্পার ফাংশন
-- ---------------------------------------------------------------------

-- লগইন করা ব্যক্তি কি এই চ্যাটের সদস্য?
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;

-- নতুন ইউজার তৈরি হলে প্রোফাইল বানাবে; দুইজনের বেশি হলে ইউজার তৈরিই আটকে দেবে
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  lock table public.profiles in share row exclusive mode;

  if (select count(*) from public.profiles) >= 2 then
    raise exception 'এই চ্যাটে শুধু দুইজন সদস্য থাকতে পারে (only 2 members allowed)';
  end if;

  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- অপর পক্ষের সব না-দেখা মেসেজ "দেখা হয়েছে" চিহ্নিত করে
create or replace function public.mark_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.messages
     set seen_at = now()
   where seen_at is null
     and sender_id <> auth.uid()
     and public.is_member();
$$;

revoke execute on function public.mark_seen() from anon;

-- ---------------------------------------------------------------------
-- ৪. Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.messages enable row level security;

drop policy if exists "members read profiles"   on public.profiles;
drop policy if exists "update own profile"      on public.profiles;
drop policy if exists "members read messages"   on public.messages;
drop policy if exists "members send messages"   on public.messages;
drop policy if exists "delete own messages"     on public.messages;

create policy "members read profiles" on public.profiles
  for select to authenticated
  using (public.is_member());

create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "members read messages" on public.messages
  for select to authenticated
  using (public.is_member());

create policy "members send messages" on public.messages
  for insert to authenticated
  with check (public.is_member() and sender_id = auth.uid() and seen_at is null);

create policy "delete own messages" on public.messages
  for delete to authenticated
  using (sender_id = auth.uid());

-- ---------------------------------------------------------------------
-- ৫. রিয়েলটাইম (ডাটাবেস পরিবর্তন শোনা)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

-- প্রাইভেট চ্যানেল (অনলাইন স্ট্যাটাস + টাইপিং) — শুধু সদস্যরা ঢুকতে পারবে
drop policy if exists "members receive realtime" on realtime.messages;
drop policy if exists "members send realtime"    on realtime.messages;

create policy "members receive realtime" on realtime.messages
  for select to authenticated
  using (public.is_member());

create policy "members send realtime" on realtime.messages
  for insert to authenticated
  with check (public.is_member());

-- ---------------------------------------------------------------------
-- ৬. ছবির জন্য প্রাইভেট স্টোরেজ বাকেট (সর্বোচ্চ ৫ MB)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

drop policy if exists "members view chat images"  on storage.objects;
drop policy if exists "members upload chat images" on storage.objects;
drop policy if exists "owners delete chat images" on storage.objects;

create policy "members view chat images" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-images' and public.is_member());

create policy "members upload chat images" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-images'
    and public.is_member()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "owners delete chat images" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------
-- ৭. আগে থেকে তৈরি ইউজার থাকলে তাদের প্রোফাইল বানিয়ে দেয় (সর্বোচ্চ ২ জন)
-- ---------------------------------------------------------------------
insert into public.profiles (id, display_name)
select u.id, split_part(u.email, '@', 1)
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id)
 order by u.created_at
 limit greatest(0, 2 - (select count(*) from public.profiles));

-- =====================================================================
-- ৮. Web Push নোটিফিকেশন (অ্যাপ বন্ধ থাকলেও নোটিফিকেশন)
--    প্রতিটি ডিভাইসের সাবস্ক্রিপশন এখানে থাকে। টেবিলে সরাসরি কেউ
--    পড়তে/লিখতে পারে না — শুধু নিচের ফাংশনগুলো দিয়ে।
-- =====================================================================
create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;

-- কোন লগইন-সেশনের ডিভাইস (ডিভাইস লগআউট করলে তার নোটিফিকেশনও বন্ধ হয়)
alter table public.push_subscriptions add column if not exists session_id uuid;

-- এই মুহূর্তের লগইন-সেশনের id (JWT-এর session_id)
create or replace function public.current_session_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'session_id', '')::uuid;
$$;

-- একই মেসেজের জন্য দুবার নোটিফিকেশন যাওয়া ঠেকায়
create table if not exists public.push_log (
  message_id uuid primary key references public.messages(id) on delete cascade,
  sent_at    timestamptz not null default now()
);
alter table public.push_log enable row level security;

-- এই ডিভাইসের সাবস্ক্রিপশন সেভ (একই ডিভাইসে অন্যজন লগইন করলে মালিক বদলে যায়)
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member() then
    raise exception 'not a member';
  end if;
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000
     or char_length(p_p256dh) > 200 or char_length(p_auth) > 100 then
    raise exception 'invalid subscription';
  end if;

  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, user_agent, session_id)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_user_agent, 300), public.current_session_id())
  on conflict (endpoint) do update
     set user_id    = excluded.user_id,
         p256dh     = excluded.p256dh,
         auth       = excluded.auth,
         user_agent = excluded.user_agent,
         session_id = excluded.session_id,
         updated_at = now();
end;
$$;

-- লগআউট / নোটিফিকেশন বন্ধ করলে
create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- মেসেজ পাঠানোর পর সার্ভার (/api/notify) এটি ডাকে।
-- শুধু প্রেরক, শুধু একবার, শুধু ১০ মিনিটের মধ্যের মেসেজের জন্য অপর পক্ষের ডিভাইস তালিকা দেয়।
create or replace function public.claim_push(p_message_id uuid)
returns table (
  sub_endpoint text,
  sub_p256dh   text,
  sub_auth     text,
  sender_name  text,
  body_text    text,
  has_image    boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.push_log (message_id)
  select m.id
    from public.messages m
   where m.id = p_message_id
     and m.sender_id = auth.uid()
     and m.created_at > now() - interval '10 minutes'
  on conflict do nothing;

  if not found then
    return;
  end if;

  return query
    select s.endpoint, s.p256dh, s.auth, p.display_name, m.content, (m.image_path is not null)
      from public.messages m
      join public.profiles p on p.id = m.sender_id
      join public.push_subscriptions s on s.user_id <> m.sender_id
     where m.id = p_message_id;
end;
$$;

-- মেয়াদোত্তীর্ণ (410 Gone) সাবস্ক্রিপশন মুছে ফেলা
create or replace function public.remove_push_subscriptions(p_endpoints text[])
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_subscriptions
   where endpoint = any (p_endpoints) and public.is_member();
$$;

revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke execute on function public.delete_push_subscription(text)               from public, anon;
revoke execute on function public.claim_push(uuid)                             from public, anon;
revoke execute on function public.remove_push_subscriptions(text[])            from public, anon;
grant  execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant  execute on function public.delete_push_subscription(text)               to authenticated;
grant  execute on function public.claim_push(uuid)                             to authenticated;
grant  execute on function public.remove_push_subscriptions(text[])            to authenticated;

-- পুরোনো push_log পরিষ্কার রাখতে (ঐচ্ছিক): মেসেজ মুছলে এটি নিজেই মুছে যায়

-- =====================================================================
-- ৯. রিপ্লাই ও ইমোজি রিঅ্যাকশন
-- =====================================================================

-- কোন মেসেজের উত্তরে লেখা (মূল মেসেজ মুছে গেলে লিংকটা খালি হয়ে যায়)
alter table public.messages
  add column if not exists reply_to uuid references public.messages(id) on delete set null;
create index if not exists messages_reply_to_idx on public.messages (reply_to);

-- প্রতিটি মেসেজে প্রত্যেকে একটি করে রিঅ্যাকশন দিতে পারে (বদলালে আগেরটা সরে যায়)
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.message_reactions replica identity full;
alter table public.message_reactions enable row level security;

drop policy if exists "members read reactions"  on public.message_reactions;
drop policy if exists "add own reaction"        on public.message_reactions;
drop policy if exists "change own reaction"     on public.message_reactions;
drop policy if exists "remove own reaction"     on public.message_reactions;

create policy "members read reactions" on public.message_reactions
  for select to authenticated
  using (public.is_member());

create policy "add own reaction" on public.message_reactions
  for insert to authenticated
  with check (public.is_member() and user_id = auth.uid());

create policy "change own reaction" on public.message_reactions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "remove own reaction" on public.message_reactions
  for delete to authenticated
  using (user_id = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;

-- =====================================================================
-- ১০. মেসেজ এডিট, রিঅ্যাকশনের নোটিফিকেশন, প্রজেক্ট সজাগ রাখা
-- =====================================================================

-- ---- মেসেজ এডিট ----
alter table public.messages add column if not exists edited_at timestamptz;

-- লেখা বদলালে নিজে থেকেই "সম্পাদিত" সময় বসে
create or replace function public.touch_edited()
returns trigger
language plpgsql
as $$
begin
  if new.content is distinct from old.content then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists messages_touch_edited on public.messages;
create trigger messages_touch_edited
  before update on public.messages
  for each row execute function public.touch_edited();

-- শুধু লেখা (content) বদলানো যাবে — প্রেরক, সময়, ছবি, seen কিছুই নয়
revoke update on public.messages from anon, authenticated;
grant update (content) on public.messages to authenticated;

drop policy if exists "edit own text messages" on public.messages;
create policy "edit own text messages" on public.messages
  for update to authenticated
  using (sender_id = auth.uid() and image_path is null)
  with check (sender_id = auth.uid() and image_path is null);

-- ---- রিঅ্যাকশনের নোটিফিকেশন ----
-- একই মেসেজে একই ইমোজির জন্য একবারই নোটিফিকেশন যায় (বারবার চাপলেও না)
create table if not exists public.reaction_push_log (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null,
  sent_at    timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
alter table public.reaction_push_log enable row level security;

-- অপর জনের মেসেজে রিঅ্যাকশন দিলে /api/notify এটি ডাকে
create or replace function public.claim_reaction_push(p_message_id uuid)
returns table (
  sub_endpoint text,
  sub_p256dh   text,
  sub_auth     text,
  sender_name  text,
  emoji        text,
  body_text    text,
  has_image    boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_emoji text;
begin
  select r.emoji into v_emoji
    from public.message_reactions r
    join public.messages m on m.id = r.message_id
   where r.message_id = p_message_id
     and r.user_id = auth.uid()
     and m.sender_id <> auth.uid();

  if v_emoji is null then
    return;
  end if;

  insert into public.reaction_push_log (message_id, user_id, emoji)
  values (p_message_id, auth.uid(), v_emoji)
  on conflict do nothing;

  if not found then
    return;
  end if;

  return query
    select s.endpoint, s.p256dh, s.auth, p.display_name, v_emoji, m.content, (m.image_path is not null)
      from public.messages m
      join public.profiles p on p.id = auth.uid()
      join public.push_subscriptions s on s.user_id = m.sender_id
     where m.id = p_message_id;
end;
$$;

revoke execute on function public.claim_reaction_push(uuid) from public, anon;
grant  execute on function public.claim_reaction_push(uuid) to authenticated;

-- ---- প্রজেক্ট সজাগ রাখা ----
-- Vercel প্রতিদিন /api/keepalive থেকে এটি ডাকে, যাতে ফ্রি প্রজেক্ট ৭ দিনে ঘুমিয়ে না পড়ে।
-- কোনো তথ্য দেয় না, শুধু সময়।
create or replace function public.ping()
returns timestamptz
language sql
stable
as $$
  select now();
$$;

grant execute on function public.ping() to anon, authenticated;

-- =====================================================================
-- ১১. লগইন করা ডিভাইস — তালিকা দেখা ও অন্য ডিভাইস লগআউট
--     Supabase-এর auth.sessions-এ প্রতিটি লগইন একটি সেশন। সেশন মুছলে
--     সেই ডিভাইস আর টোকেন নবায়ন করতে পারে না, অর্থাৎ লগআউট হয়ে যায়।
-- =====================================================================

-- নিজের সব সক্রিয় লগইন (এই ডিভাইস সবার উপরে)
create or replace function public.list_my_sessions()
returns table (
  session_id  uuid,
  created_at  timestamptz,
  last_active timestamptz,
  user_agent  text,
  ip          text,
  is_current  boolean,
  has_push    boolean
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select s.id,
         s.created_at,
         coalesce(s.updated_at, s.created_at),
         s.user_agent,
         host(s.ip),
         s.id = public.current_session_id(),
         exists (select 1 from public.push_subscriptions p where p.session_id = s.id)
    from auth.sessions s
   where s.user_id = auth.uid()
     and (s.not_after is null or s.not_after > now())
   order by (s.id = public.current_session_id()) desc,
            coalesce(s.updated_at, s.created_at) desc;
$$;

-- একটি নির্দিষ্ট ডিভাইস লগআউট (নিজের এই ডিভাইস নয়)
create or replace function public.revoke_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if p_session_id is null or p_session_id = public.current_session_id() then
    raise exception 'এই ডিভাইস এখান থেকে লগআউট করা যায় না';
  end if;
  delete from public.push_subscriptions where session_id = p_session_id and user_id = auth.uid();
  delete from auth.sessions where id = p_session_id and user_id = auth.uid();
  return found;
end;
$$;

-- এই ডিভাইস ছাড়া বাকি সব লগআউট; মুছে যাওয়া সেশনগুলোর id ফেরত দেয়
create or replace function public.revoke_other_sessions(p_keep_endpoint text default null)
returns setof uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_cur uuid := public.current_session_id();
begin
  if v_cur is null then
    raise exception 'session id পাওয়া যায়নি, আবার লগইন করুন';
  end if;
  delete from public.push_subscriptions
   where user_id = auth.uid()
     and session_id is distinct from v_cur
     and endpoint is distinct from p_keep_endpoint;
  return query
    delete from auth.sessions
     where user_id = auth.uid() and id <> v_cur
    returning id;
end;
$$;

revoke execute on function public.list_my_sessions()           from public, anon;
revoke execute on function public.revoke_session(uuid)         from public, anon;
revoke execute on function public.revoke_other_sessions(text)  from public, anon;
grant  execute on function public.list_my_sessions()           to authenticated;
grant  execute on function public.revoke_session(uuid)         to authenticated;
grant  execute on function public.revoke_other_sessions(text)  to authenticated;

-- =====================================================================
-- ১২. পিন করা মেসেজ ও "মনে পড়ছে"
-- =====================================================================

-- ---- পিন করা মেসেজ (দুজনেরই দেখা যায়, যে কেউ পিন/আনপিন করতে পারে) ----
create table if not exists public.pinned_messages (
  message_id uuid primary key references public.messages(id) on delete cascade,
  pinned_by  uuid not null references public.profiles(id) on delete cascade,
  pinned_at  timestamptz not null default now()
);
alter table public.pinned_messages replica identity full;
alter table public.pinned_messages enable row level security;

drop policy if exists "members read pins"   on public.pinned_messages;
drop policy if exists "members add pins"    on public.pinned_messages;
drop policy if exists "members remove pins" on public.pinned_messages;

create policy "members read pins" on public.pinned_messages
  for select to authenticated using (public.is_member());
create policy "members add pins" on public.pinned_messages
  for insert to authenticated with check (public.is_member() and pinned_by = auth.uid());
create policy "members remove pins" on public.pinned_messages
  for delete to authenticated using (public.is_member());

-- ---- "মনে পড়ছে" ----
create table if not exists public.nudges (
  id         uuid primary key default gen_random_uuid(),
  sender_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  pushed_at  timestamptz
);
create index if not exists nudges_sender_time_idx on public.nudges (sender_id, created_at desc);
alter table public.nudges enable row level security;

-- বারবার চাপা ঠেকাতে: একজন ১৫ সেকেন্ডে একবার
create or replace function public.can_nudge()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.nudges
     where sender_id = auth.uid() and created_at > now() - interval '15 seconds'
  );
$$;

drop policy if exists "members read nudges" on public.nudges;
drop policy if exists "members send nudges" on public.nudges;

create policy "members read nudges" on public.nudges
  for select to authenticated using (public.is_member());
create policy "members send nudges" on public.nudges
  for insert to authenticated
  with check (public.is_member() and sender_id = auth.uid() and public.can_nudge());

-- "মনে পড়ছে" পাঠানোর পর /api/notify এটি ডাকে — অপর জনের ডিভাইস তালিকা দেয় (একবারই)
create or replace function public.claim_nudge_push(p_nudge_id uuid)
returns table (
  sub_endpoint text,
  sub_p256dh   text,
  sub_auth     text,
  sender_name  text,
  body_text    text,
  has_image    boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.nudges
     set pushed_at = now()
   where id = p_nudge_id
     and sender_id = auth.uid()
     and pushed_at is null
     and created_at > now() - interval '2 minutes';

  if not found then
    return;
  end if;

  -- পুরোনো "মনে পড়ছে" জমে না থাকুক (৬০ দিনের বেশি পুরোনো মুছে যায়)
  delete from public.nudges where created_at < now() - interval '60 days';

  return query
    -- body_text-এ যাকে পাঠানো হচ্ছে তার নাম ("I love you <নাম>")
    select s.endpoint, s.p256dh, s.auth, p.display_name, r.display_name, false
      from public.profiles p
      join public.push_subscriptions s on s.user_id <> auth.uid()
      join public.profiles r on r.id = s.user_id
     where p.id = auth.uid();
end;
$$;

revoke execute on function public.claim_nudge_push(uuid) from public, anon;
grant  execute on function public.claim_nudge_push(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pinned_messages'
  ) then
    alter publication supabase_realtime add table public.pinned_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'nudges'
  ) then
    alter publication supabase_realtime add table public.nudges;
  end if;
end $$;

-- =====================================================================
-- ১৩. মেসেজ মোছা (আমার কাছ থেকে / সবার কাছ থেকে), পুরো চ্যাট মোছা,
--     নির্দিষ্ট সময় পর নিজে থেকে মুছে যাওয়া মেসেজ
-- =====================================================================

-- ---- "আমার কাছ থেকে মুছুন": শুধু নিজের কাছে লুকানো ----
create table if not exists public.hidden_messages (
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  hidden_at  timestamptz not null default now(),
  primary key (user_id, message_id)
);
alter table public.hidden_messages enable row level security;

drop policy if exists "own hidden read"  on public.hidden_messages;
drop policy if exists "own hidden add"   on public.hidden_messages;
create policy "own hidden read" on public.hidden_messages
  for select to authenticated using (user_id = auth.uid());
create policy "own hidden add" on public.hidden_messages
  for insert to authenticated with check (user_id = auth.uid() and public.is_member());

-- ---- "পুরো চ্যাট আমার কাছ থেকে মুছুন": এই সময়ের আগের সব লুকানো ----
alter table public.profiles add column if not exists cleared_before timestamptz;

create or replace function public.my_cleared_before()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select cleared_before from public.profiles where id = auth.uid()), '-infinity'::timestamptz);
$$;

-- ---- নির্দিষ্ট সময় পর মুছে যাওয়া ----
alter table public.messages add column if not exists expires_at timestamptz;
create index if not exists messages_expires_idx on public.messages (expires_at) where expires_at is not null;

-- পুরো চ্যাটের একটাই সেটিং (দুজনের জন্য একই)
create table if not exists public.chat_settings (
  id                 int primary key default 1 check (id = 1),
  disappear_seconds  int not null default 0 check (disappear_seconds between 0 and 31536000),
  updated_by         uuid references public.profiles(id) on delete set null,
  updated_at         timestamptz not null default now()
);
insert into public.chat_settings (id) values (1) on conflict do nothing;
alter table public.chat_settings enable row level security;

drop policy if exists "members read settings"   on public.chat_settings;
drop policy if exists "members update settings" on public.chat_settings;
create policy "members read settings" on public.chat_settings
  for select to authenticated using (public.is_member());
create policy "members update settings" on public.chat_settings
  for update to authenticated
  using (public.is_member())
  with check (public.is_member() and updated_by = auth.uid());

-- নতুন মেসেজে সেটিং অনুযায়ী মেয়াদ বসে (ক্লায়েন্ট নিজে ঠিক করতে পারে না)
create or replace function public.set_message_expiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secs int;
begin
  select disappear_seconds into v_secs from public.chat_settings where id = 1;
  if coalesce(v_secs, 0) > 0 then
    new.expires_at := now() + make_interval(secs => v_secs);
  else
    new.expires_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_set_expiry on public.messages;
create trigger messages_set_expiry
  before insert on public.messages
  for each row execute function public.set_message_expiry();

-- ---- কোন মেসেজ কে দেখতে পাবে ----
-- সদস্য + মেয়াদ শেষ হয়নি + নিজে "চ্যাট মুছুন" করার পরের + নিজে লুকায়নি
drop policy if exists "members read messages" on public.messages;
create policy "members read messages" on public.messages
  for select to authenticated
  using (
    public.is_member()
    and (expires_at is null or expires_at > now())
    and created_at > public.my_cleared_before()
    and not exists (
      select 1 from public.hidden_messages h
       where h.message_id = messages.id and h.user_id = auth.uid()
    )
  );

-- লুকানো/মুছে যাওয়া মেসেজের পিনও দেখাবে না
drop policy if exists "members read pins" on public.pinned_messages;
create policy "members read pins" on public.pinned_messages
  for select to authenticated
  using (public.is_member() and exists (select 1 from public.messages m where m.id = message_id));

-- পুরো চ্যাট বা মেয়াদোত্তীর্ণ মেসেজের ছবি সদস্যরা মুছতে পারবে
drop policy if exists "members delete chat images" on storage.objects;
create policy "members delete chat images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-images' and public.is_member());

-- ---- দুজনের কাছ থেকেই পুরো চ্যাট মোছা ----
-- সব মেসেজ (আর তাদের রিঅ্যাকশন, পিন, রিপ্লাই-লিংক) মুছে ছবির ঠিকানা ফেরত দেয়
create or replace function public.clear_chat_all()
returns setof text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member() then
    raise exception 'not a member';
  end if;
  -- Supabase-এ শর্ত (WHERE) ছাড়া DELETE চলে না (safeupdate), তাই সবসময়-সত্য শর্ত দেওয়া হলো
  return query
    delete from public.messages where id is not null returning image_path;
end;
$$;

-- ---- মেয়াদ শেষ হওয়া মেসেজ সত্যিই মুছে ফেলা ----
-- অ্যাপ খুললে চলে; মুছে যাওয়া ছবির ঠিকানা ফেরত দেয় যাতে ছবিও মোছা যায়
create or replace function public.purge_expired()
returns setof text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member() then
    return;
  end if;
  return query
    delete from public.messages
     where expires_at is not null and expires_at <= now()
    returning image_path;
end;
$$;

revoke execute on function public.clear_chat_all()   from public, anon;
revoke execute on function public.purge_expired()    from public, anon;
grant  execute on function public.clear_chat_all()   to authenticated;
grant  execute on function public.purge_expired()    to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_settings'
  ) then
    alter publication supabase_realtime add table public.chat_settings;
  end if;
end $$;

-- =====================================================================
-- ১৪. খেলা: রক-পেপার-সিজর্স (পাথর-কাগজ-কাঁচি)
--     দুজনের বাছাই শেষ না হওয়া পর্যন্ত কেউ অপর জনেরটা দেখতে পারে না —
--     ডাটাবেস নিজেই লুকিয়ে রাখে। সব লেখা হয় শুধু নিচের ফাংশন দিয়ে।
-- =====================================================================
create table if not exists public.rps_rounds (
  id           uuid primary key default gen_random_uuid(),
  started_by   uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  picked_count int not null default 0,
  done_at      timestamptz,
  pushed_at    timestamptz
);
create index if not exists rps_rounds_time_idx on public.rps_rounds (created_at desc);
alter table public.rps_rounds enable row level security;

create table if not exists public.rps_picks (
  round_id  uuid not null references public.rps_rounds(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  choice    text not null check (choice in ('rock', 'paper', 'scissors')),
  picked_at timestamptz not null default now(),
  primary key (round_id, user_id)
);
alter table public.rps_picks enable row level security;

drop policy if exists "members read rounds" on public.rps_rounds;
create policy "members read rounds" on public.rps_rounds
  for select to authenticated using (public.is_member());

-- নিজের বাছাই সবসময় দেখা যায়; অপর জনেরটা শুধু খেলা শেষ হলে
drop policy if exists "read own or finished picks" on public.rps_picks;
create policy "read own or finished picks" on public.rps_picks
  for select to authenticated
  using (
    public.is_member()
    and (
      user_id = auth.uid()
      or exists (select 1 from public.rps_rounds r where r.id = round_id and r.done_at is not null)
    )
  );

-- খেলা শুরু: চলমান (২৪ ঘণ্টার মধ্যের, শেষ না হওয়া) খেলা থাকলে সেটাই, না হলে নতুন
create or replace function public.rps_start()
returns table (round_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_member() then
    raise exception 'not a member';
  end if;
  -- পুরোনো, অসমাপ্ত খেলা বাতিল
  delete from public.rps_rounds where done_at is null and created_at < now() - interval '24 hours';

  select r.id into v_id from public.rps_rounds r
   where r.done_at is null
   order by r.created_at desc limit 1;
  if v_id is not null then
    return query select v_id, false;
    return;
  end if;

  insert into public.rps_rounds (started_by) values (auth.uid()) returning id into v_id;
  -- অনেক পুরোনো খেলা জমে না থাকুক (সর্বশেষ ৫০০টি রাখি)
  delete from public.rps_rounds
   where id in (select id from public.rps_rounds order by created_at desc offset 500);
  return query select v_id, true;
end;
$$;

-- বাছাই দেওয়া (একবারই; বদলানো যায় না)
create or replace function public.rps_pick(p_round_id uuid, p_choice text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.rps_rounds;
  v_count int;
begin
  if not public.is_member() then
    raise exception 'not a member';
  end if;
  -- একসাথে দুজন বাছলেও গোলমাল যেন না হয়
  select * into v_round from public.rps_rounds where id = p_round_id for update;
  if v_round.id is null or v_round.done_at is not null then
    raise exception 'এই খেলা আর চলছে না';
  end if;

  insert into public.rps_picks (round_id, user_id, choice)
  values (p_round_id, auth.uid(), p_choice)
  on conflict do nothing;

  select count(*) into v_count from public.rps_picks where round_id = p_round_id;
  update public.rps_rounds
     set picked_count = v_count,
         done_at = case when v_count >= 2 then now() else null end
   where id = p_round_id;
end;
$$;

-- মোট হিসাব: আমার জয়, অপর জনের জয়, ড্র
create or replace function public.rps_score()
returns table (my_wins int, their_wins int, draws int)
language sql
stable
security definer
set search_path = public
as $$
  with games as (
    select (select choice from public.rps_picks p where p.round_id = r.id and p.user_id = auth.uid())  as mine,
           (select choice from public.rps_picks p where p.round_id = r.id and p.user_id <> auth.uid()) as theirs
      from public.rps_rounds r
     where r.done_at is not null and public.is_member()
  )
  select
    count(*) filter (where (mine, theirs) in (('rock','scissors'), ('paper','rock'), ('scissors','paper'))),
    count(*) filter (where (theirs, mine) in (('rock','scissors'), ('paper','rock'), ('scissors','paper'))),
    count(*) filter (where mine = theirs)
  from games
  where mine is not null and theirs is not null;
$$;

-- খেলতে ডাকলে অপর জনের ফোনে নোটিফিকেশন (একবারই)
create or replace function public.claim_rps_push(p_round_id uuid)
returns table (
  sub_endpoint text,
  sub_p256dh   text,
  sub_auth     text,
  sender_name  text,
  body_text    text,
  has_image    boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.rps_rounds
     set pushed_at = now()
   where id = p_round_id and started_by = auth.uid() and pushed_at is null and done_at is null;
  if not found then
    return;
  end if;
  return query
    select s.endpoint, s.p256dh, s.auth, p.display_name, null::text, false
      from public.profiles p
      join public.push_subscriptions s on s.user_id <> auth.uid()
     where p.id = auth.uid();
end;
$$;

revoke execute on function public.rps_start()                from public, anon;
revoke execute on function public.rps_pick(uuid, text)       from public, anon;
revoke execute on function public.rps_score()                from public, anon;
revoke execute on function public.claim_rps_push(uuid)       from public, anon;
grant  execute on function public.rps_start()                to authenticated;
grant  execute on function public.rps_pick(uuid, text)       to authenticated;
grant  execute on function public.rps_score()                to authenticated;
grant  execute on function public.claim_rps_push(uuid)       to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rps_rounds'
  ) then
    alter publication supabase_realtime add table public.rps_rounds;
  end if;
end $$;

-- =====================================================================
-- 15. "সর্বশেষ সক্রিয়" — সার্ভারের ঘড়ি দিয়ে
--     ফোনের ঘড়ি আগে-পিছে থাকলে last_seen ভুল হতো; এখন সবসময় সার্ভারের now()।
-- =====================================================================
create or replace function public.touch_last_seen()
returns timestamptz
language sql
security definer
set search_path = public
as $$
  update public.profiles set last_seen = now()
   where id = auth.uid()
  returning last_seen;
$$;

-- পুরোনো অ্যাপ সরাসরি last_seen লিখলেও সার্ভারের সময়ই বসবে
create or replace function public.force_server_last_seen()
returns trigger
language plpgsql
as $$
begin
  if new.last_seen is distinct from old.last_seen then
    new.last_seen := now();
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_server_last_seen on public.profiles;
create trigger profiles_server_last_seen
  before update on public.profiles
  for each row execute function public.force_server_last_seen();

revoke all on function public.touch_last_seen() from public, anon;
grant execute on function public.touch_last_seen() to authenticated;

-- =====================================================================
-- 16. ফাইল ও ভয়েস মেসেজ
--     ছবি, ফাইল, ভয়েস — সবই একই প্রাইভেট বাকেটে (chat-images), পথ থাকে image_path-এ।
--     তাই মোছা, নিজে মুছে যাওয়া, পুরো চ্যাট মোছা — সব আগের মতোই ফাইলগুলোও মুছে দেয়।
-- =====================================================================
alter table public.messages add column if not exists media_kind  text;
alter table public.messages add column if not exists file_name   text;
alter table public.messages add column if not exists file_size   bigint;
alter table public.messages add column if not exists mime_type   text;
alter table public.messages add column if not exists duration_ms integer;

alter table public.messages drop constraint if exists messages_media_check;
alter table public.messages add constraint messages_media_check check (
  (media_kind is null or media_kind in ('image', 'file', 'voice'))
  and (media_kind is null or image_path is not null)
  and (media_kind is distinct from 'file' or file_name is not null)
  and (file_name is null or char_length(file_name) between 1 and 200)
  and (file_size is null or file_size between 0 and 26214400)
  and (mime_type is null or char_length(mime_type) <= 120)
  and (duration_ms is null or duration_ms between 0 and 600000)
);

-- আগের ছবিগুলো চিহ্নিত করি
update public.messages set media_kind = 'image'
 where image_path is not null and media_kind is null;

-- বাকেট: সর্বোচ্চ ২৫ MB; ছবি, ভয়েস, আর ফাইল (ফাইল সবসময় "download" হিসেবে রাখা হয়,
-- তাই কেউ ক্ষতিকর HTML/স্ক্রিপ্ট পাঠালেও ব্রাউজারে খুলে চলবে না)
update storage.buckets
   set file_size_limit = 26214400,
       allowed_mime_types = array[
         'image/jpeg', 'image/png', 'image/webp', 'image/gif',
         'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac',
         'application/octet-stream'
       ]
 where id = 'chat-images';
