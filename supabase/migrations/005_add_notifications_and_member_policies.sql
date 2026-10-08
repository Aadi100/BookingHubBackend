-- Create or replace notifications table
drop table if exists public.notifications cascade;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null default 'in_app' check (channel in ('email', 'sms', 'push', 'in_app')),
  type text not null,
  message text,
  is_read boolean not null default false,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable RLS on notifications table
alter table public.notifications enable row level security;

-- Policy: Users can view their own notifications
create policy "Users can view their own notifications"
  on public.notifications for select
  to authenticated
  using (auth.uid() = user_id);

-- Policy: Users can update their own notifications
drop policy if exists "Users can update their own notifications" on public.notifications;
create policy "Users can update their own notifications"
  on public.notifications for update
  to authenticated
  using (auth.uid() = user_id);

-- Policy: Users can delete their own notifications
drop policy if exists "Users can delete their own notifications" on public.notifications;
create policy "Users can delete their own notifications"
  on public.notifications for delete
  to authenticated
  using (auth.uid() = user_id);

-- Create indexes
create index if not exists idx_notifications_user_id on public.notifications(user_id);
create index if not exists idx_notifications_created_at on public.notifications(created_at desc);
create index if not exists idx_notifications_is_read on public.notifications(is_read);

-- Add RLS policies for members table if they don't exist
drop policy if exists "Members can view their own profile" on public.members;
create policy "Members can view their own profile"
  on public.members for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "Members can update their own profile" on public.members;
create policy "Members can update their own profile"
  on public.members for update
  to authenticated
  using (auth.uid() = id);
