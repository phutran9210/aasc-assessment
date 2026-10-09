# TikTok – Bitrix24 integration

A second application in this repository. It receives signed TikTok lead webhooks, creates and
updates Leads and Deals in Bitrix24, and serves analytics, reports and operations endpoints. It
shares code with the AASC assessment app but runs on its own: port **3001**, its own PostgreSQL
database and Redis, build output in `dist-tiktok/`. The AASC app (port 3000, SQLite) is unaffected.

Vietnamese walkthrough: [`huong-dan/tiktok-bitrix24.md`](huong-dan/tiktok-bitrix24.md).

## What runs

| Process | Command | Role |
| --- | --- | --- |
| API | `node dist-tiktok/apps/tiktok/main.js` | Webhooks, management API, health, OpenAPI |
| Worker | `node dist-tiktok/apps/tiktok/worker.js` | Ingest, CRM sync, conversion, reports, imports, schedules |
| Migrations | `node dist-tiktok/apps/tiktok/database/migration-runner.js` | One-shot, safe to run concurrently |
| Mock providers | `node dist-tiktok/apps/tiktok/cli/mock-server.js` | Local TikTok + Bitrix24 stand-in (port 3002) |

A webhook is acknowledged after it is committed to PostgreSQL. Everything else happens in the
worker through an operation ledger and outbox, so a Redis outage delays work but does not lose it.

## Quick start with Docker (mock providers)

```bash
cp .env.tiktok.example .env.tiktok          # local placeholders; replace secrets before sharing
docker compose --env-file .env.tiktok -f docker-compose.tiktok.yml up -d --build --wait
docker compose --env-file .env.tiktok -f docker-compose.tiktok.yml run --rm demo
```

`up` starts PostgreSQL, Redis and the mock providers, applies migrations, seeds demo data, then
starts the API and the worker. The `demo` service sends one signed webhook and follows it to a
Lead, a Deal, a won Deal, analytics and CSV/JSON/XLSX exports; it takes about half a minute
because calls to Bitrix24 are limited to one per second.

- API: <http://127.0.0.1:3001> (set `TIKTOK_APP_PORT` to publish another host port)
- OpenAPI UI: <http://127.0.0.1:3001/docs>, JSON at `/docs-json`
- Health: `/health/live` (process), `/health/ready` and `/health` (database, schema, Redis, worker)
- Demo accounts: `demo-admin`, `demo-operator`, `demo-analyst`, password `demo-password-change-me`

Stop with `docker compose --env-file .env.tiktok -f docker-compose.tiktok.yml down`; add `-v` to
delete the demo database, queue and artifacts as well.

## Running without Docker

Needs Node 24.9+, pnpm 11, a PostgreSQL 16 database and Redis 7.

```bash
pnpm install
cp .env.tiktok.example .env.tiktok           # then export it: set -a; . ./.env.tiktok; set +a
pnpm db:tiktok:migrate                       # build + apply migrations
pnpm tiktok:mock                             # terminal 1: mock TikTok/Bitrix24 on :3002
pnpm db:tiktok:seed                          # demo identity, accounts, rules, 30 days of cost
pnpm start:tiktok:prod                       # terminal 2: API on :3001
pnpm start:tiktok:worker                     # terminal 3: worker
pnpm tiktok:demo                             # end-to-end walk-through
```

| Command | Purpose |
| --- | --- |
| `pnpm build:tiktok` | Compile to `dist-tiktok/` |
| `pnpm db:tiktok:migrate` | Apply migrations |
| `pnpm db:tiktok:seed` | Idempotent demo data; refuses production and non-mock modes |
| `pnpm tiktok:user:create <username> <role[,role]>` | Create an account; the password is prompted, never an argument |
| `pnpm tiktok:webhook` | Send one signed webhook (`TIKTOK_DEMO_SAMPLE=samples/tiktok/lead-generate.json` to use a file) |
| `pnpm tiktok:demo` | Full demo flow; mock mode only |
| `pnpm tiktok:load-probe` | Webhook latency probe: `TIKTOK_PROBE_COUNT`/`TIKTOK_PROBE_CONCURRENCY`, or a fixed rate with `TIKTOK_PROBE_RATE` and `TIKTOK_PROBE_SECONDS` (raise `TIKTOK_INGRESS_IP_LIMIT` and `TIKTOK_WEBHOOK_ADVERTISER_LIMIT` on the API first) |
| `pnpm tiktok:openapi` | Write `artifacts/tiktok/openapi.json` from the running code |
| `pnpm test:tiktok:unit` / `:integration` / `:e2e` | Test suites (integration and E2E need the test containers below) |
| `pnpm test:tiktok:cov` | All three suites in one run with the coverage thresholds |

Tests use their own containers and never the demo or a real database:

```bash
docker compose -p aasc-tiktok-tests -f docker-compose.tiktok.test.yml up -d --wait
export TIKTOK_TEST_DATABASE_URL=postgres://tiktok_test:tiktok_test_only@127.0.0.1:<postgres port>/tiktok_test
export TIKTOK_TEST_REDIS_URL=redis://127.0.0.1:<redis port>
pnpm test:tiktok:integration && pnpm test:tiktok:e2e
```

The published ports are random; read them with
`docker compose -p aasc-tiktok-tests -f docker-compose.tiktok.test.yml port postgres 5432`.

## Configuration

Every setting is documented in [`.env.tiktok.example`](.env.tiktok.example). The important ones:

- **Deployment identity** – `TIKTOK_ADVERTISER_ID`, `BITRIX_PORTAL_KEY`, `TIKTOK_MODE`,
  `BITRIX_INTEGRATION_MODE`. The first start stores them; the API and worker refuse to start on a
  database that was initialised with different values. Mock and real data never share a database.
- **Secrets** – `TIKTOK_JWT_SECRET` (32+ characters), `TIKTOK_WEBHOOK_SECRET`,
  `BITRIX_MOCK_EVENT_SECRET` (mock) or `BITRIX24_OUTGOING_TOKEN` (real).
- **Workers** – set `INTEGRATION_WORKER_ENABLED=true` on the API so readiness waits for a worker
  heartbeat, and `INTEGRATION_SCHEDULER_ENABLED=true` on the workers that run schedules.
- **Proxies** – list reverse proxy addresses in `TIKTOK_TRUSTED_PROXIES`; otherwise
  `X-Forwarded-For` is ignored and rate limits apply to the connecting address.

Field mapping and rules are versioned configuration, not environment:
`GET/PUT /configuration/mapping` and `/configuration/rules` (admin, `If-Match` with the current
revision). Canonical examples: [`samples/tiktok/mapping.json`](samples/tiktok/mapping.json),
[`samples/tiktok/rules.json`](samples/tiktok/rules.json).

## API overview

| Area | Endpoints |
| --- | --- |
| Webhooks | `POST /webhooks/tiktok/leads`, `POST /webhooks/bitrix24/deals` |
| Auth | `POST /auth/login`, `POST /auth/logout` |
| Leads and deals | `GET /api/v1/leads`, `GET /api/v1/deals`, `POST /api/v1/leads/:id/convert-to-deal` |
| Analytics | `GET /api/v1/analytics/conversion-rates`, `GET /api/v1/analytics/campaign-performance` |
| Reports | `GET /api/v1/reports/export`, `POST /api/v1/reports/exports`, `GET /api/v1/reports/jobs/:id[/download]` |
| Imports | `POST /api/v1/leads/imports`, `POST /api/v1/analytics/campaign-costs/imports` |
| Operations | `GET /api/v1/operations[/:id]`, `POST /api/v1/operations/:id/retry`, `POST /api/v1/operations/:id/resolve` |
| Notifications | `GET /api/v1/notifications` |
| Health | `GET /health/live`, `GET /health/ready`, `GET /health` |

Roles: `integration_admin` (everything, configuration, resolve), `integration_operator` (leads,
deals, conversion, imports, retry, scheduled reports), `integration_analyst` (read, analytics,
exports). Limits: 600 requests/minute per address on public endpoints, 120 webhooks/minute per
advertiser, 120 reads and 30 changes per minute per user; a 429 carries `Retry-After`.

Sample import files: [`samples/tiktok/historical-leads.csv`](samples/tiktok/historical-leads.csv),
[`samples/tiktok/campaign-costs.csv`](samples/tiktok/campaign-costs.csv). Lead imports default to
a dry run with rules and conversion feedback off.

## Operations runbook

**Something is stuck.** `GET /api/v1/operations?status=dead_letter` (also `retry_wait`,
`reconcile_required`, `quarantined`). `POST /api/v1/operations/:id/retry` re-queues an operation
that failed for a transient reason. `reconcile_required` means a create call may or may not have
reached Bitrix24: the worker looks the record up by its marker instead of creating it again, and
an admin can settle it with `POST /api/v1/operations/:id/resolve`. Operators also receive in-app
notifications (`GET /api/v1/notifications`) and structured log lines for dead letters, a backlog
older than five minutes, upstream authentication failures and a failure rate above 5 %.

**Redis is down.** Webhooks are still acknowledged after the database commit and processed when
Redis returns. Sign-in and the management API answer 503. `/health/ready` reports `redis: down`.

**Bitrix24 token revoked or expired.** Operations move to `retry_wait` and an `upstream_auth`
alert is raised. Reinstall or re-authorise the application (`GET /install/authorize` as admin),
then retry the affected operations.

**Backup and restore.** PostgreSQL is the only source of truth; Redis and the artifact directory
can be rebuilt.

```bash
docker compose --env-file .env.tiktok -f docker-compose.tiktok.yml exec -T postgres \
  pg_dump -U tiktok -d tiktok --format=custom > tiktok-$(date +%F).dump
# restore into an empty database, with API and worker stopped:
docker compose --env-file .env.tiktok -f docker-compose.tiktok.yml exec -T postgres \
  pg_restore -U tiktok -d tiktok --clean --if-exists < tiktok-2026-10-09.dump
```

After a restore, start the worker first: it re-publishes every operation that was pending.

**Retention** (daily, on scheduler workers): raw webhook bodies and payloads are removed after 30
days while the event key and hash stay for deduplication; export files expire after 24 hours and
finished import uploads after 30 days; audit records, sent notifications and completed operations
are deleted after 180 days. Pending, quarantined, dead-letter and reconcile-required work is never
purged.

**Upgrades.** Run the migration command (or the `migrate` service) before starting new API and
worker versions; it takes a database lock, so starting it from several hosts is safe.

## Limits of this delivery

- Only **mock** TikTok mode is active. The real TikTok Business API (lead retrieval, reporting,
  conversion events) is not enabled: it needs an authorised account and a verified contract. Until
  then campaign cost comes from CSV import and conversion feedback is only sent to the mock.
- Bitrix24 **real** mode uses the same gateway as the mock (`crm.item.*`, `crm.status.list`,
  `crm.duplicate.findbycomm`) but has not been run against a live portal here; validate field
  names, the `updatedTime` filter and stage semantics on your portal before going live.
- The Bitrix24 notification channel is a port without an adapter; notifications are in-app and in
  the operational log.
- The demo accounts and the mock server are for local use. The seed refuses to run with
  `NODE_ENV=production` or outside mock mode; never expose port 3002.
