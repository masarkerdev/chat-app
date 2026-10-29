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
