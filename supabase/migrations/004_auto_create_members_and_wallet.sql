-- Auto-create members row on signup
create or replace function public.handle_new_member()
returns trigger as $$
begin
  insert into public.members (id, name, email, status, preferred_language)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    'active',
    'en'
  )
  on conflict (id) do nothing;

  -- Auto-create wallet with zero balance
  insert into public.wallets (member_id, balance, currency)
  values (new.id, 0, 'PKR')
  on conflict (member_id) do nothing;

  return new;
end;
$$ language plpgsql security definer;

-- Drop existing trigger if it exists
drop trigger if exists on_auth_user_created on auth.users;

-- Create trigger
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_member();

-- Create audit_logs table
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  user_id uuid references auth.users(id) on delete set null,
  changes jsonb,
  description text,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table public.audit_logs enable row level security;

-- Drop existing policies
drop policy if exists "audit_logs_read" on public.audit_logs;
drop policy if exists "audit_logs_insert" on public.audit_logs;

-- Policy: Authenticated users can view audit logs
create policy "audit_logs_read"
  on public.audit_logs for select
  to authenticated
  using (true);

-- Policy: Only staff can insert audit logs
create policy "audit_logs_insert"
  on public.audit_logs for insert
  to authenticated
  with check (
    exists (
      select 1 from auth.users where auth.uid() = user_id
    )
  );

-- Create index for performance
create index if not exists idx_audit_logs_created_at on public.audit_logs(created_at desc);
create index if not exists idx_audit_logs_entity on public.audit_logs(entity_type, entity_id);

-- Backfill members and wallets for existing test accounts
insert into public.members (id, name, email, status, preferred_language)
select
  id,
  coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1)),
  email,
  'active',
  'en'
from auth.users
on conflict (id) do nothing;

insert into public.wallets (member_id, balance, currency)
select id, 0, 'PKR'
from auth.users
on conflict (member_id) do nothing;
