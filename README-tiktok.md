# TikTok – Bitrix24 integration

A second application in this repository. It receives signed TikTok lead webhooks, creates and
updates Leads and Deals in Bitrix24, and serves analytics, reports and operations endpoints. It
shares code with the AASC assessment app but runs on its own: port **3001**, its own PostgreSQL
database and Redis, build output in `dist-tiktok/`. The AASC app (port 3000, SQLite) is unaffected.

Vietnamese walkthrough: [`huong-dan/tiktok-bitrix24.md`](huong-dan/tiktok-bitrix24.md).

**Providers.** No TikTok Business account is used: TikTok is represented by a signed webhook
sender and a mock Events API, as the assignment allows. Bitrix24 runs in two ways through the same
gateway: against the bundled mock REST server (the default, and what the tests use), or against a
real portal (see "Running against a real Bitrix24 portal").

## The assignment, as shipped

The sample documents printed in the assignment are accepted as they are:

- [`samples/tiktok/lead-generate.json`](samples/tiktok/lead-generate.json) is its webhook payload
  (Unix `timestamp`, nested `campaign` and `form`, `custom_questions` identified by their text).
- [`samples/tiktok/assignment-config.json`](samples/tiktok/assignment-config.json) is its
  "Bitrix24 Lead Mapping Configuration". `PUT /api/v1/config/mappings` takes it unchanged:
  `field_mapping` becomes the field mapping, and `deal_rules` replace the rule list of the rules
  policy (`campaign.campaign_name CONTAINS 'sale'` becomes a `contains` rule; `pipeline_id: 1,
  stage_id: NEW` becomes Bitrix24's stage code `C1:NEW`).

| Assignment | Where |
| --- | --- |
| Webhook endpoint, `TikTok-Signature`, three event types, raw data kept | `POST /webhooks/tiktok/leads`; raw body and payload stored per event |
| Validation, phone and email normalisation, source classification, deduplication | ingest worker; E.164 phones, identities by email and phone |
| Leads in Bitrix24, flexible mapping, merge, timeline | lead sync worker; `/api/v1/config/mappings` |
| Rule engine, pipeline stage and probability, assignment, notifications | conversion saga; `/api/v1/config/rules`; `/api/v1/notifications` |
| Conversion rates, cost per lead and ROI, quality score, dashboard API | `/api/v1/analytics/*`; score in the lead DTO |
| CSV/Excel export, conversion events back to TikTok, historical import, scheduled reports and alerts | `/api/v1/reports/*`, feedback worker, `/api/v1/leads/imports`, scheduler |
| NestJS, PostgreSQL + TypeORM migrations and seed, Redis, BullMQ, retries, dead letters, rate limits | see "Technical decisions" |
| Swagger/OpenAPI | `/docs`, and the exported [`api-docs/tiktok-openapi.json`](api-docs/tiktok-openapi.json) |
| Docker, multi-stage build, health checks | `Dockerfile.tiktok`, `docker-compose.tiktok.yml` (one file; profiles select demo, real Bitrix24 or production) |
| Tests | 1399 tests across unit, integration and E2E; statements 90 %, lines 93 %, functions 91 %, branches 77 % |
| ESLint, Prettier, Husky | `pnpm lint`, `pnpm format:check`; a pre-commit hook runs both on staged files |

## Architecture

```mermaid
flowchart LR
  TT[TikTok webhook<br/>mock sender] -->|signed POST| API
  B24E[Bitrix24 deal event<br/>mock] -->|POST| API
  Client[Operator / dashboard] -->|JWT| API
  subgraph App
    API[API process<br/>guards, rate limits, validation]
    W[Worker process<br/>BullMQ consumers, schedules]
  end
  API -->|event + operation + outbox<br/>one transaction| PG[(PostgreSQL)]
  PG -->|outbox dispatcher| R[(Redis<br/>BullMQ, sessions, cache, limits)]
  R --> W
  W --> PG
  W -->|crm.item.*, timeline<br/>1 request/second| B24[Bitrix24 REST<br/>mock server]
  W -->|conversion events| TTE[TikTok Events API<br/>mock server]
  W --> FS[(Artifact volume<br/>exports, uploads)]
  API --> FS
```

A webhook is verified, stored with its raw body and acknowledged in one database transaction that
also writes the operation and its outbox row. A dispatcher publishes outbox rows to BullMQ; workers
claim an operation with a lease, do the work and record the outcome. Failures are retried with
backoff up to five attempts and then go to a dead-letter queue with a notification.

### Database

```mermaid
erDiagram
  integration_webhook_event ||--o{ integration_submission : "produces"
  integration_lead ||--o{ integration_submission : "has"
  integration_lead ||--o{ integration_lead_identity : "is known by"
  integration_lead ||--o| integration_deal : "converts to"
  integration_lead ||--o{ integration_timeline : "logs"
  integration_lead ||--o{ integration_feedback_ledger : "reports"
  integration_deal ||--o{ integration_deal_history : "changes"
  integration_operation ||--o{ integration_outbox : "is dispatched by"
  integration_report_job ||--o{ integration_report_row_error : "rejects"
  integration_configuration_head ||--|| integration_configuration : "points to active revision"

  integration_webhook_event {
    uuid id PK
    string provider
    string event_key "unique per scope"
    string event_type
    bytea raw_body "audit, removed after 30 days"
    jsonb payload
    string status
  }
  integration_lead {
    uuid id PK
    string external_id "unique"
    string advertiser_id
    string name
    string email
    string phone "E.164"
    int score
    string sync_status
    string bitrix_lead_id
    int version
  }
  integration_submission {
    uuid id PK
    uuid lead_id FK
    uuid event_id FK
    string campaign_id
    string ad_id
    string form_id
    jsonb custom_answers
    jsonb consent
  }
  integration_lead_identity {
    uuid id PK
    uuid lead_id FK
    string identity_type "email or phone"
    string normalized_value "unique per advertiser"
  }
  integration_deal {
    uuid id PK
    uuid lead_id FK "unique"
    string bitrix_deal_id
    string pipeline_id
    string stage_id
    int probability
    string assigned_to
    decimal amount
    string conversion_status
  }
  integration_operation {
    uuid id PK
    string operation_key "unique, idempotency"
    string kind
    string status
    int attempt
    timestamptz lease_until
  }
  integration_outbox {
    uuid id PK
    uuid operation_id FK
    string queue
    int dispatch_generation
    timestamptz published_at
  }
  integration_configuration {
    uuid id PK
    string key "mapping or rules"
    int revision
    jsonb value
  }
```

Other tables: `integration_user`, `integration_audit_event`, `integration_notification`,
`integration_campaign_daily` (cost per campaign and day), `integration_assignment_cursor`
(round-robin), `integration_aggregate_lease`, `integration_deal_poll_checkpoint`,
`integration_bitrix_installation`. The schema is created by migrations only; `synchronize` is off.

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
cp .env.example .env          # one file for the whole repository; Part 2 is this app
docker compose -f docker-compose.tiktok.yml up -d --build --wait
docker compose -f docker-compose.tiktok.yml run --rm demo
```

`up` starts PostgreSQL, Redis and the mock providers, applies migrations, seeds demo data, then
starts the API and the worker. The `demo` service sends one signed webhook and follows it to a
Lead, a Deal, a won Deal, analytics and CSV/JSON/XLSX exports; it takes about half a minute
because calls to Bitrix24 are limited to one per second.

- API: <http://127.0.0.1:3001> (set `TIKTOK_APP_PORT` to publish another host port)
- OpenAPI UI: <http://127.0.0.1:3001/docs>, JSON at `/docs-json`
- Health: `/health/live` (process), `/health/ready` and `/health` (database, schema, Redis, worker)
- Demo accounts: `demo-admin`, `demo-operator`, `demo-analyst`, password `demo-password-change-me`

Stop with `docker compose -f docker-compose.tiktok.yml down`; add `-v` to
delete the demo database, queue and artifacts as well.

## Docker files

Two Dockerfiles and two Compose files, one pair per application:

| File | Purpose |
| --- | --- |
| `Dockerfile.tiktok`, `docker-compose.tiktok.yml` | This application, in every mode |
| `Dockerfile`, `docker-compose.yml` | The AASC assessment app (port 3000, SQLite) |

`docker-compose.tiktok.yml` covers every way of running the app. Settings come from `.env`, the
one configuration file of the repository (Part 2 of [`.env.example`](.env.example)); Compose
reads it by default. `COMPOSE_PROFILES` in it chooses the mode:

| Mode | `COMPOSE_PROFILES` | Also set | Starts |
| --- | --- | --- | --- |
| Demo (the default) | `app,mock,demo` | `BITRIX_INTEGRATION_MODE=mock` | PostgreSQL, Redis, migrations, API, worker, mock providers, demo seed |
| Real Bitrix24 portal | `app,mock` | `BITRIX_INTEGRATION_MODE=real`, `TIKTOK_BITRIX24_WEBHOOK_URL`, `TIKTOK_BITRIX24_OUTGOING_TOKEN` | the same without the seed; the mock only stands in for TikTok |
| Production | `app` | `NODE_ENV=production`, real secrets, `TIKTOK_REDIS_PASSWORD` | PostgreSQL, Redis, migrations, API, worker |
| Test infrastructure | `--profile test` on the command line | nothing | throwaway PostgreSQL and Redis on random loopback ports |

One `.env` describes one mode at a time, and one database serves one mode: before switching,
remove the stack with `down -v` or set another `TIKTOK_COMPOSE_PROJECT`.

`create-user` and `demo` are run on demand with `docker compose ... run --rm <service>`.

Every mode runs the same way:

- **Images are pinned** by tag and digest (Node, PostgreSQL, Redis), and the runtime image has no
  package manager. Set `TIKTOK_IMAGE` to run an image built elsewhere.
- **Containers are confined**: non-root user 1000, read-only root filesystem, no Linux
  capabilities, `no-new-privileges`, an init process, and limits on memory, processes and log size
  (`TIKTOK_API_MEMORY`, `TIKTOK_WORKER_MEMORY`, `TIKTOK_POSTGRES_MEMORY` override the defaults of
  512 MB, 768 MB and 1 GB).
- **Networks are split**: PostgreSQL, Redis, migrations and the mock sit on an internal network
  with no route outside; only the API and the worker also join the network that reaches Bitrix24,
  and only the API publishes a port, on `127.0.0.1`.
- **Redis** persists with an append-only file and runs with `noeviction`, so at its memory cap it
  refuses writes instead of dropping queued jobs.

## Production layout with Docker

With `COMPOSE_PROFILES=app` and `NODE_ENV=production` in `.env` the same Compose file runs without
the mock server and the demo seed. PostgreSQL and Redis publish no port, Redis has a password, and
the API listens on `127.0.0.1` only, for a TLS-terminating reverse proxy.

```bash
# in .env: COMPOSE_PROFILES=app, NODE_ENV=production, CORS_ORIGINS=<allowed origins>,
# TIKTOK_REDIS_PASSWORD, and every change-me value of Part 2 replaced
docker compose -f docker-compose.tiktok.yml up -d --build --wait
docker compose -f docker-compose.tiktok.yml \
  run --rm create-user <username> integration_admin   # the password is prompted
```

In production the app refuses to start with a `change-me` placeholder secret or with
`CORS_ORIGINS=*`, and real Bitrix24 mode needs `TIKTOK_BITRIX24_WEBHOOK_URL`. The first admin
then uploads the mapping and rules through `PUT /api/v1/config/mappings` and
`PUT /api/v1/config/rules`; nothing is seeded.

## Running against a real Bitrix24 portal

With `COMPOSE_PROFILES=app,mock` and `BITRIX_INTEGRATION_MODE=real` the stack keeps TikTok mocked
and sends every CRM call to a real portal.
It was verified on a Bitrix24 cloud portal through an incoming webhook: lead create with phone,
email and custom fields, update of the same lead on a repeated contact, deal create linked to the
lead, lead completion, timeline comments, the deal callback and a won deal.

```bash
# in .env: COMPOSE_PROFILES=app,mock, BITRIX_INTEGRATION_MODE=real, BITRIX_PORTAL_KEY,
# TIKTOK_BITRIX24_WEBHOOK_URL (may be the BITRIX24_WEBHOOK_URL of Part 1) and
# TIKTOK_BITRIX24_OUTGOING_TOKEN
docker compose -f docker-compose.tiktok.yml up -d --build --wait
docker compose -f docker-compose.tiktok.yml \
  run --rm create-user <username> integration_admin
```

What the portal needs, and how the app uses it:

- **Webhook scope `crm`.** With the `user` scope as well, any active user can be an assignee;
  without it only the webhook's own user can be validated.
- **Markers, not custom fields.** Records the app creates carry `originatorId = aasc-tiktok` and the
  local ID in `originId`. A lead that carries another integration's origin (for example the Google
  Sheets sync of this repository) is never adopted, even when its phone or email matches.
- **Mapping targets must exist.** The assignment's mapping writes `UF_CRM_CITY`,
  `UF_CRM_UTM_CAMPAIGN`, `UF_CRM_AD_NAME` and `UF_CRM_TTCLID`; create them as lead string fields
  first, or `PUT /api/v1/config/mappings` answers 400.
- **Pipelines and stages come from the portal.** Rules name a real pipeline ID and stage code;
  the assignment's `pipeline_id: 1` only works where a second pipeline exists (a Free plan has the
  default pipeline 0 only). A lead is completed with the stage `CONVERTED`.
- **Deal events** reach the app through an outgoing webhook to `/webhooks/bitrix24/deals`, checked
  by its application token; a scheduled poll catches changes when the app is not reachable.
- **Automation on the portal still runs.** Workflows that start on new leads or deals will start
  on these records too.

## Running without Docker

Needs Node 24.9+, pnpm 11, a PostgreSQL 16 database and Redis 7.

```bash
pnpm install
cp .env.example .env                         # then export it: set -a; . ./.env; set +a
# the file names the mock by its Compose service name; without Docker point at the host instead:
export TIKTOK_BITRIX24_WEBHOOK_URL=http://127.0.0.1:3002/rest/1/mock/ TIKTOK_MOCK_BASE_URL=http://127.0.0.1:3002/tiktok
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
| `pnpm tiktok:openapi` | Write the OpenAPI document from the running code; `TIKTOK_OPENAPI_OUTPUT=api-docs/tiktok-openapi.json` refreshes the committed copy |
| `pnpm test:tiktok:unit` / `:integration` / `:e2e` | Test suites (integration and E2E need the test containers below) |
| `pnpm test:tiktok:cov` | All three suites in one run with the coverage thresholds |

Tests use their own containers and never the demo or a real database:

```bash
docker compose -p aasc-tiktok-tests -f docker-compose.tiktok.yml --profile test up -d --wait
export TIKTOK_TEST_DATABASE_URL=postgres://tiktok_test:tiktok_test_only@127.0.0.1:<postgres port>/tiktok_test
export TIKTOK_TEST_REDIS_URL=redis://127.0.0.1:<redis port>
pnpm test:tiktok:integration && pnpm test:tiktok:e2e
```

The published ports are random; read them with
`docker compose -p aasc-tiktok-tests -f docker-compose.tiktok.yml port test-postgres 5432`.

## Configuration

Every setting is documented in Part 2 of [`.env.example`](.env.example); `.env` holds the same
variables in the same order. The TikTok app has its own `TIKTOK_BITRIX24_WEBHOOK_URL` and
`TIKTOK_BITRIX24_OUTGOING_TOKEN`, separate from the `BITRIX24_*` pair of the AASC app, so a demo
against the mock cannot reach the real portal by accident. The important ones:

- **Deployment identity** – `TIKTOK_ADVERTISER_ID`, `BITRIX_PORTAL_KEY`, `TIKTOK_MODE`,
  `BITRIX_INTEGRATION_MODE`. The first start stores them; the API and worker refuse to start on a
  database that was initialised with different values. Mock and real data never share a database.
- **Secrets** – `TIKTOK_JWT_SECRET` (32+ characters), `TIKTOK_WEBHOOK_SECRET`,
  `BITRIX_MOCK_EVENT_SECRET` (mock) or `TIKTOK_BITRIX24_OUTGOING_TOKEN` (real).
- **Workers** – set `INTEGRATION_WORKER_ENABLED=true` on the API so readiness waits for a worker
  heartbeat, and `INTEGRATION_SCHEDULER_ENABLED=true` on the workers that run schedules.
- **Proxies** – list reverse proxy addresses in `TIKTOK_TRUSTED_PROXIES`; otherwise
  `X-Forwarded-For` is ignored and rate limits apply to the connecting address.

Field mapping and rules are versioned configuration, not environment:
`GET/PUT /api/v1/config/mappings` and `/api/v1/config/rules` (admin, `If-Match` with the current
revision; `"0"` creates the first one). Until a mapping is stored, `GET` shows the built-in one
(name, email, phone) as revision 0. A `PUT` body is either `{ "value": <document> }` in the native
format ([`samples/tiktok/mapping.json`](samples/tiktok/mapping.json),
[`samples/tiktok/rules.json`](samples/tiktok/rules.json)) or the assignment's document itself
([`samples/tiktok/assignment-config.json`](samples/tiktok/assignment-config.json)). Deal rules in
the assignment's format extend an existing rules policy, so store the policy first.

Lead quality score (0–100): email 15, phone 15, completed form 20, up to four interactions in 30
days at 5 each, and 15 each when the answers to the budget and timeline questions are among
`quality_scoring.budget_values` and `timeline_values`.

## API overview

| Area | Endpoints |
| --- | --- |
| Webhooks | `POST /webhooks/tiktok/leads`, `POST /webhooks/bitrix24/deals` |
| Auth | `POST /api/v1/auth/login`, `POST /api/v1/auth/logout` |
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
docker compose -f docker-compose.tiktok.yml exec -T postgres \
  pg_dump -U tiktok -d tiktok --format=custom > tiktok-$(date +%F).dump
# restore into an empty database, with API and worker stopped:
docker compose -f docker-compose.tiktok.yml exec -T postgres \
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

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Webhook answers 401 | Wrong `TIKTOK_WEBHOOK_SECRET`, a `TikTok-Signature` older than five minutes, or a body changed after signing. The signature is `t=<unix>,s=<hex HMAC-SHA256 of "<t>.<raw body>">`; `pnpm tiktok:webhook` sends a valid one. |
| Webhook answers 400 `Invalid TikTok webhook envelope` | `event_id`, `event`, `advertiser_id` or `timestamp` is missing, or a `lead.generate` has no campaign ID, form ID or `lead_data`. |
| Webhook answers 403 | `advertiser_id` is not `TIKTOK_ADVERTISER_ID`. |
| Webhook is accepted but no lead appears | The worker is not running, or the event was quarantined (no name, or neither a valid email nor phone). Check `GET /api/v1/operations?status=quarantined`. |
| Lead stays `pending` | Calls to Bitrix24 are paced at one per second; check `/health` for `oldestPendingSeconds` and `GET /api/v1/operations?status=retry_wait`. |
| `PUT /api/v1/config/*` answers 428 or 409 | `If-Match` is missing, or is not the current revision: read the resource and send its `ETag`. |
| `PUT /api/v1/config/mappings` answers 400 | A target field does not exist on the portal, or a `field_mapping` source is not one of the webhook paths listed in `assignment-config-import.ts`. |
| API or worker exits at start | The message names the variable. In production: a `change-me` secret, `CORS_ORIGINS=*`, or real Bitrix24 mode without `TIKTOK_BITRIX24_WEBHOOK_URL`; on any start: a database first used with another advertiser, portal or mode. |
| `/health/ready` answers 503 | The body names the failed check (`database`, `schema`, `redis`, `worker`). `schema` means migrations have not been applied. |
| Export answers 422 `EXPORT_REQUIRES_ASYNC` | More than 10,000 leads: use `POST /api/v1/reports/exports` and download the job. |

Every error has the same shape: `{ statusCode, error, message, path, timestamp }`, plus `code` when
the failure has a stable reason.

## Technical decisions

- **Acknowledge after commit, work later.** The webhook handler only verifies, stores and returns.
  The event, its operation and an outbox row are written in one transaction, so a crash or a Redis
  outage can delay a lead but cannot lose or duplicate it.
- **PostgreSQL is the source of truth, BullMQ is transport.** A job carries only an operation ID.
  The operation row holds status, attempt and lease; a sweeper re-dispatches work whose job was
  lost and recovers operations whose worker died.
- **Idempotency at every boundary.** Events are deduplicated by event key and content hash, leads
  by normalized email and phone, remote records by a marker written to Bitrix24. A create that
  timed out is looked up by its marker and never repeated without an operator's confirmation.
- **One retry budget.** Five attempts with exponential backoff and jitter for thrown and reported
  failures alike, then a dead letter and a notification. Waiting for a busy lead does not count.
- **Conversion as a saga.** Bitrix24 has no single "convert lead" call, so the steps (claim,
  create deal, complete lead, feedback) are stored one by one and resumed where they stopped.
- **Versioned configuration.** Mapping and rules are documents with revisions and `If-Match`; an
  operation keeps the revisions it started with, so a retry behaves like the first attempt.
- **Rules are data.** A small JSON DSL over an allow-list of fields; the assignment's condition
  string is parsed by a fixed grammar and never evaluated.
- **Money and time.** Decimal arithmetic, half-open intervals, the advertiser's time zone; a
  missing cost day makes cost per lead and ROI `null` rather than wrong.
- **Rate limits** in Redis for callers, and a cross-process pacer for calls to Bitrix24.
- **TypeORM with migrations** rather than `synchronize`, and a separate PostgreSQL database from
  the AASC app's SQLite, so neither app can affect the other.

## Improvements for a production deployment

- Verify the OAuth application path of the Bitrix24 adapter on a live portal (install, token
  refresh, event verification); only the incoming-webhook path has been, which is why production
  requires `TIKTOK_BITRIX24_WEBHOOK_URL` for real mode.
- Add the real TikTok adapters once a Business account is available: webhook subscription and
  signature as TikTok defines them, lead retrieval, reporting for campaign cost, and the Events
  API for conversion feedback.
- Terminate TLS at a reverse proxy, keep secrets in a secret manager instead of an env file, scan
  the image in CI, and let a bot keep the pinned image digests current. Tune the memory limits to
  the real load; CPU limits are not set.
- Run PostgreSQL and Redis as managed services with backups and point-in-time recovery; today the
  runbook covers `pg_dump` only.
- Export metrics (queue depth, operation age, failure rate) and traces instead of relying on
  `/health` and logs; alert on dead letters and on the oldest pending operation.
- Scale workers horizontally: operations are leased and schedules take an advisory lock, but this
  has only been exercised with a few local processes.
- Raise branch coverage from 77 % to 80 %; the gap is mostly error paths in the operator
  resolution service and the Bitrix24 gateway.
- A Bitrix24 chat or e-mail channel for notifications; they are in-app and in the log today.

## Limits of this delivery

- Only **mock** TikTok mode is active. The real TikTok Business API (lead retrieval, reporting,
  conversion events) is not enabled: it needs an authorised account and a verified contract. Until
  then campaign cost comes from CSV import and conversion feedback is only sent to the mock.
- Bitrix24 **real** mode is verified through an incoming webhook on one cloud portal (Free plan,
  one pipeline). Not verified: the OAuth application path, a portal with several pipelines, and
  delivery of deal events by Bitrix24 itself (the callback was exercised with a request in
  Bitrix24's format, since the test machine is not reachable from the internet).
- The Bitrix24 notification channel is a port without an adapter; notifications are in-app and in
  the operational log.
- The demo accounts and the mock server are for local use. The seed refuses to run with
  `NODE_ENV=production` or outside mock mode; never expose port 3002.
