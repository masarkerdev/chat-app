-- =====================================================================
--  দুজনে চ্যাট — Supabase স্কিমা
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

  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
     set user_id    = excluded.user_id,
         p256dh     = excluded.p256dh,
         auth       = excluded.auth,
         user_agent = excluded.user_agent,
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
