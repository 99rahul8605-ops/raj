# Setanbot verification checklist

## Completed locally

- [x] JavaScript syntax check for `index.js` and every `src/**/*.js` file.
- [x] Full workspace TypeScript check.
- [x] `git diff --check`.
- [x] Dependency lockfile generated for the bot workspace package.
- [x] Fresh Supabase schema includes users, admins, permissions, folders, content, ordered content items, force-join channels, join requests, referrals, daily progress, unlocks, settings, broadcasts, and logs.
- [x] Admin callbacks enforce permissions server-side.
- [x] Active admin text/media flows re-check permissions before mutating data.

## Requires a configured Telegram/Supabase environment

- [ ] Bot starts and reports its username.
- [ ] `/healthz` returns HTTP 200.
- [ ] Super admin bootstrap creates exactly one super-admin record.
- [ ] `/start` persists a user and displays the welcome flow.
- [ ] Force-join membership and request-to-join verification work against real channels.
- [ ] A referral deep link creates one unique pending referral and cannot self-refer or duplicate.
- [ ] Referral validation happens only after the referred user completes join verification.
- [ ] Daily progress uses the configured timezone and survives restart.
- [ ] Protected content blocks until the required progress is complete.
- [ ] Public content bypasses referral gating.
- [ ] Bulk upload stores files in one content record in original order.
- [ ] Additional files can be appended later without changing existing order.
- [ ] All content items are delivered in order.
- [ ] Broadcast, user blocking, storage testing, admin permissions, and audit logging work against the fresh schema.
- [ ] Render health check passes after deployment.

Run the live checklist after setting the secrets and applying
`supabase/migrations/20260920000000_initial_schema.sql`.