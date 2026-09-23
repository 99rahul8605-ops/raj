# Setanbot Telegram Content Bot

Setanbot is a long-running Telegram content distribution bot with Supabase-backed folders, force-join checks, bulk content delivery, referrals, and a permissioned admin panel.

## Run & Operate

- `pnpm --filter @workspace/telegram-bot run start` — run the Telegram bot and health endpoint
- `pnpm --filter @workspace/telegram-bot run typecheck` — syntax-check the bot package
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required bot env: `BOT_TOKEN`, `SUPER_ADMIN_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Bot: Node.js 22+, CommonJS, Grammy long polling
- Database: Supabase PostgreSQL through `@supabase/supabase-js`
- Deployment: Render web service with `/healthz`

## Where things live

- `telegram-bot/index.js` — Telegram middleware, callback routing, startup
- `telegram-bot/src/db/` — Supabase repositories
- `telegram-bot/src/handlers/` — user/admin interaction flows
- `telegram-bot/src/services/` — force join, storage, referrals, broadcast, health
- `telegram-bot/supabase/migrations/20260920000000_initial_schema.sql` — fresh Supabase schema
- `render.yaml` — Render build, start, and health-check settings

## Architecture decisions

- Telegram media stays in a private storage channel; Supabase stores message references and ordered `content_items`.
- Permanent state, including referral validity and daily counts, is stored in Supabase; only in-progress admin conversations use RAM.
- Referral validity is granted only after a referred user completes the bot's join-verification flow.
- Admin authorization is checked at callback dispatch and again for active text/media flows, not only by hiding buttons.

## Product

Users enter through `/start`, complete required channel membership, browse nested folders, and receive protected content. Admins configure the library, storage channel, force-join rules, referrals, users, broadcasts, and settings from Telegram.

## Gotchas

- Apply the canonical Supabase migration before starting the bot.
- Run only one active process per bot token because the bot uses long polling.
- The Render service binds `PORT` for health checks, but Telegram delivery is the long-running worker.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
