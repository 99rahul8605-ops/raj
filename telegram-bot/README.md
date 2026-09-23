# Setanbot — Telegram Content Bot

Setanbot distributes protected Telegram media through a folder-based library. It keeps files in a private Telegram storage channel, stores only message references in Supabase, and provides a permissioned admin panel for content, force-join, referrals, users, broadcasts, and settings.

## What is included

- Force-join verification for multiple public/private channels.
- Request-to-join tracking matched by channel and user.
- One content entry containing an ordered list of 15–20+ videos/files.
- Add more files later without creating duplicate content entries.
- Persistent referral records and timezone-aware daily progress.
- Optional referral gate for protected content with visible `completed / required` progress.
- One super admin plus server-side permission checks for sub-admins.
- Telegram storage-channel forwarding/copying; no media bytes are downloaded to the server.
- Broadcasts, auto-delete, welcome page settings, statistics, user blocking, and audit logs.
- HTTP `/healthz` endpoint for Render/Replit process health checks.

## Requirements

- Node.js 22 or newer.
- A Telegram bot token from BotFather.
- A new Supabase project.
- A Telegram user ID for the first super admin.
- A private Telegram storage channel where the bot can post messages.

## Local/Replit setup

From the repository root:

```bash
pnpm install
cp telegram-bot/.env.example telegram-bot/.env
```

Fill `telegram-bot/.env` with the values below. Never commit this file.

```env
BOT_TOKEN=
SUPER_ADMIN_ID=
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
STORAGE_CHANNEL_ID=
BOT_USERNAME=
REFERRAL_REQUIREMENT_ENABLED=false
REFERRAL_DAILY_REQUIREMENT=0
REFERRAL_TIMEZONE=Asia/Calcutta
BROADCAST_INTERVAL_MS=35
PORT=5000
```

Apply the fresh Supabase schema before starting the bot:

```bash
supabase db push
```

If the Supabase CLI is not installed, open Supabase SQL Editor and run the complete file:

```text
telegram-bot/supabase/migrations/20260920000000_initial_schema.sql
```

Then run:

```bash
pnpm --filter @workspace/telegram-bot run typecheck
pnpm --filter @workspace/telegram-bot run start
```

The bot starts its Telegram long-polling process and serves `GET /healthz` on `PORT`.

## Supabase schema

| Table | Use |
|---|---|
| `users` | Telegram users, activity, and blocked state |
| `admins` | Super admin and sub-admin records |
| `admin_permissions` | Server-enforced sub-admin permissions |
| `folders` | Unlimited nested content folders |
| `content` | A logical content entry, title, description, access mode |
| `content_items` | Ordered Telegram storage-channel messages inside a content entry |
| `force_join_channels` | Required membership/request channels |
| `join_requests` | User/channel-specific request tracking |
| `referrals` | Unique referral relationships and validation state |
| `referral_daily_progress` | Restart-safe daily counts for each referrer |
| `unlocked_content` | Durable record of granted content access |
| `settings` | Bot configuration and admin-editable values |
| `broadcasts` | Broadcast campaign totals and status |
| `admin_activity_logs` | Administrative audit history |

RLS is enabled on every table. The bot uses the Supabase service-role key only on the server; it never exposes that key to Telegram users or the browser.

## Referral rules

An admin enables the gate from **Admin Panel → Bot Settings → Daily Referrals** using:

```text
ON 2
```

or disables it with:

```text
OFF
```

Only unique, non-self referrals count. A referred user becomes valid only after they complete the configured force-join verification (or open the library when no force-join channels are configured). The count is calculated from persisted referral rows using `REFERRAL_TIMEZONE`, so restarts do not reset progress.

Content defaults to `protected`. The `content.access_mode` column also supports `public` for content that should bypass the referral gate.

## Storage channel

1. Create a private Telegram channel.
2. Add the bot as an administrator with permission to post.
3. Set its numeric chat ID in `STORAGE_CHANNEL_ID` or from **Admin Panel → Storage Settings**.
4. Upload media through **Manage Content → Upload Here**.
5. Send as many files as needed, then press **Done**. They become one content entry in the original order.

The database stores `storage_channel_id` and `telegram_message_id` for each file. The server does not persist local media files.

## Render deployment

This repository includes `render.yaml` for a Render web service. The small health server makes the long-running Telegram worker compatible with Render health checks.

1. Create the Supabase project and apply the migration above.
2. Push this repository to GitHub.
3. In Render, choose **New → Blueprint** and select the repository.
4. Review the service named `setanbot`.
5. Add the secret values for `BOT_TOKEN`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.
6. Add `SUPER_ADMIN_ID` and optional `STORAGE_CHANNEL_ID`/`BOT_USERNAME`.
7. Deploy. Render runs the declared build and start commands.
8. Confirm the service health check is green at `/healthz`, then send `/start` to the bot.

Equivalent manual settings:

```text
Build: pnpm install --frozen-lockfile && pnpm --filter @workspace/telegram-bot run typecheck
Start: pnpm --filter @workspace/telegram-bot run start
Health check path: /healthz
```

## GitHub checklist

- Commit `telegram-bot/.env.example`, not `.env`.
- Commit the migration SQL.
- Keep `BOT_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY` only in Replit/Render secrets.
- Do not commit `node_modules`, generated local state, or private Telegram IDs beyond the documented environment variable examples.

## Project map

```text
telegram-bot/
├── index.js
├── src/config/       environment and permission constants
├── src/db/           Supabase repositories
├── src/handlers/     user and admin Telegram flows
├── src/services/     Telegram storage, force-join, referrals, health
├── src/keyboards/    user/admin inline keyboards
├── src/utils/        logging, sessions, bootstrap
└── supabase/         canonical fresh-project migration
```

## Known operational limitations

- Telegram long polling requires one active bot process. Run only one Render/Replit production instance for a bot token.
- In-progress admin upload conversations are intentionally ephemeral; completed content and all file references are persistent.
- Auto-delete timers are process-local. They protect newly sent messages while the process is alive; the original storage-channel messages are never deleted.
- Telegram cannot reveal pending requests in every channel state, so request-based verification relies on the bot receiving and persisting the matching `chat_join_request` update plus normal membership checks.