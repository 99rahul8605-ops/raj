/*
  Setanbot canonical schema for a fresh Supabase project.

  The bot uses the service-role client from a trusted server process. RLS is
  enabled on every table; no public client is expected to access these tables.
*/

create extension if not exists pgcrypto;

create table if not exists users (
  telegram_id bigint primary key,
  username text,
  first_name text,
  is_blocked boolean not null default false,
  joined_at timestamptz not null default now(),
  last_activity timestamptz not null default now()
);

create table if not exists admins (
  telegram_id bigint primary key,
  username text,
  is_super boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists admin_permissions (
  admin_id bigint not null references admins(telegram_id) on delete cascade,
  permission text not null,
  granted_by bigint references admins(telegram_id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (admin_id, permission)
);

create table if not exists folders (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  description text,
  parent_id uuid references folders(id) on delete cascade,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists content (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references folders(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text,
  access_mode text not null default 'protected' check (access_mode in ('public', 'protected')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists content_items (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references content(id) on delete cascade,
  storage_channel_id bigint not null,
  telegram_message_id bigint not null,
  file_type text,
  file_id text,
  file_unique_id text,
  caption text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (storage_channel_id, telegram_message_id),
  unique (content_id, sort_order)
);

create table if not exists force_join_channels (
  id uuid primary key default gen_random_uuid(),
  channel_id bigint,
  channel_username text,
  channel_link text,
  button_name text not null default 'Join Channel',
  requires_approval boolean not null default false,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  check (channel_id is not null or channel_username is not null or channel_link is not null)
);

create table if not exists join_requests (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references users(telegram_id) on delete cascade,
  chat_id bigint not null,
  channel_record_id uuid references force_join_channels(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'left')),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, chat_id)
);

create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id bigint not null references users(telegram_id) on delete cascade,
  referred_id bigint not null unique references users(telegram_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'valid', 'invalid')),
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  validated_date date,
  check (referrer_id <> referred_id)
);

create table if not exists referral_daily_progress (
  user_id bigint not null references users(telegram_id) on delete cascade,
  progress_date date not null,
  completed_count integer not null default 0 check (completed_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, progress_date)
);

create table if not exists unlocked_content (
  user_id bigint not null references users(telegram_id) on delete cascade,
  content_id uuid not null references content(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  access_date date,
  primary key (user_id, content_id)
);

create table if not exists settings (
  key text primary key,
  value text,
  updated_by bigint references admins(telegram_id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists broadcasts (
  id uuid primary key default gen_random_uuid(),
  admin_id bigint references admins(telegram_id) on delete set null,
  message_type text not null default 'text',
  content text,
  total integer not null default 0,
  success integer not null default 0,
  failed integer not null default 0,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists admin_activity_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id bigint references admins(telegram_id) on delete set null,
  action text not null,
  target text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_folders_parent on folders(parent_id);
create index if not exists idx_content_folder on content(folder_id);
create index if not exists idx_content_items_content_order on content_items(content_id, sort_order);
create index if not exists idx_join_requests_user_channel on join_requests(user_id, channel_record_id);
create index if not exists idx_referrals_referrer_date on referrals(referrer_id, validated_date);
create index if not exists idx_referrals_status on referrals(status);
create index if not exists idx_logs_admin_created on admin_activity_logs(admin_id, created_at desc);

alter table users enable row level security;
alter table admins enable row level security;
alter table admin_permissions enable row level security;
alter table folders enable row level security;
alter table content enable row level security;
alter table content_items enable row level security;
alter table force_join_channels enable row level security;
alter table join_requests enable row level security;
alter table referrals enable row level security;
alter table referral_daily_progress enable row level security;
alter table unlocked_content enable row level security;
alter table settings enable row level security;
alter table broadcasts enable row level security;
alter table admin_activity_logs enable row level security;

insert into settings (key, value) values
  ('welcome_text', 'Welcome to our content channel!'),
  ('demo_image', ''),
  ('instructions_text', 'Join all required channels, verify your membership, then open the library.'),
  ('join_button_text', 'Join Channels'),
  ('check_button_text', 'Check Join'),
  ('videos_button_text', 'See Videos'),
  ('back_button_text', 'Back'),
  ('panel_button_text', 'Admin Panel'),
  ('folders_button_text', 'Folders'),
  ('storage_channel_id', ''),
  ('bot_language', 'en'),
  ('content_auto_delete_minutes', '0'),
  ('referral_requirement_enabled', 'false'),
  ('referral_daily_requirement', '0'),
  ('referral_timezone', 'Asia/Calcutta')
on conflict (key) do nothing;