-- ============================================================
-- Multi-tenant / Commercial SaaS migration
-- Run this once in Supabase SQL Editor (wbdyjpjbczfunyhhmtry project)
-- ============================================================

-- 1. profiles table: role + branding per account
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'customer' check (role in ('super_admin','customer')),
  business_name text,
  logo_url text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- Each user can read their own profile (needed for branding display
-- and for the frontend to know whether to show the admin panel).
drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own" on profiles
  for select using (auth.uid() = id);

-- 2. subscriptions table: per (customer, page) billing status
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  page_id text not null,
  status text not null default 'active' check (status in ('active','expired')),
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (owner_id, page_id)
);

alter table subscriptions enable row level security;

drop policy if exists "subscriptions_select_own" on subscriptions;
create policy "subscriptions_select_own" on subscriptions
  for select using (auth.uid() = owner_id);

-- 3. Make fb_pages cascade-delete when the owner is deleted (so admin
-- "delete customer" cleans up their pages/keywords/ai_settings too).
-- Adjust constraint name if your existing FK has a different name —
-- check with: select conname from pg_constraint where conrelid = 'fb_pages'::regclass;
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_name = 'fb_pages' and constraint_name = 'fb_pages_owner_id_fkey'
  ) then
    alter table fb_pages drop constraint fb_pages_owner_id_fkey;
  end if;
  alter table fb_pages add constraint fb_pages_owner_id_fkey
    foreign key (owner_id) references auth.users(id) on delete cascade;
exception when others then
  raise notice 'Skipping FK adjustment: %', sqlerrm;
end $$;

-- 4. Backfill: mark your own existing account as super_admin.
-- Replace the email below with your actual login email, then run:
-- insert into profiles (id, email, role)
--   select id, email, 'super_admin' from auth.users where email = 'YOUR_ADMIN_EMAIL'
--   on conflict (id) do update set role = 'super_admin';

-- 5. Backfill: give every other existing auth user a 'customer' profile
-- row (so old accounts don't break the new role check), with an
-- already-active subscription for whatever pages they own.
insert into profiles (id, email, role)
  select u.id, u.email, 'customer'
  from auth.users u
  left join profiles p on p.id = u.id
  where p.id is null
  on conflict (id) do nothing;

insert into subscriptions (owner_id, page_id, status)
  select owner_id, page_id, 'active' from fb_pages
  on conflict (owner_id, page_id) do nothing;
