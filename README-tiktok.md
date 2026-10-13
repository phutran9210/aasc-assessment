# Tích hợp TikTok – Bitrix24

Ứng dụng nhận webhook lead có chữ ký từ TikTok, tạo và cập nhật Lead, Deal trong Bitrix24, và
cung cấp API analytics, báo cáo, vận hành. Đây là ứng dụng thứ hai của repository: cổng **3001**,
PostgreSQL và Redis riêng, build ra `dist-tiktok/`. Ứng dụng AASC (cổng 3000, SQLite) tách biệt.

Hướng dẫn từng bước: [`huong-dan/tiktok-bitrix24.md`](huong-dan/tiktok-bitrix24.md).

TikTok được giả lập (bộ gửi webhook có chữ ký, Events API giả), đúng như đề cho phép. Bitrix24 là
mock REST server đi kèm (mặc định, dùng cho test) hoặc một portal thật.

## Đối chiếu đề bài

`PUT /api/v1/config/mappings` nhận nguyên tài liệu cấu hình của đề
([`samples/tiktok/assignment-config.json`](samples/tiktok/assignment-config.json)), và webhook
nhận đúng payload của đề ([`samples/tiktok/lead-generate.json`](samples/tiktok/lead-generate.json)).

| Yêu cầu của đề | Vị trí |
| --- | --- |
| Webhook, `TikTok-Signature`, ba loại sự kiện, lưu raw data | `POST /webhooks/tiktok/leads` |
| Validate, chuẩn hoá, phân loại nguồn, chống trùng | worker ingest; số điện thoại E.164; định danh theo email và phone |
| Lead trong Bitrix24, mapping, merge, timeline | worker đồng bộ lead; `/api/v1/config/mappings` |
| Rule engine, stage, xác suất, gán sales, thông báo | saga chuyển đổi; `/api/v1/config/rules`; `/api/v1/notifications` |
| Conversion rate, cost per lead, ROI, quality score | `/api/v1/analytics/*` |
| Export, conversion event về TikTok, import, báo cáo định kỳ | `/api/v1/reports/*`, worker feedback, `/api/v1/leads/imports`, scheduler |
| Swagger/OpenAPI | `/docs`; [`api-docs/tiktok-openapi.json`](api-docs/tiktok-openapi.json) |
| Docker, multi-stage build, health check | `Dockerfile.tiktok`, `docker-compose.tiktok.yml` |
| Test | 1960 test trong 226 suite; statements 96,7 %, branches 88,6 %, functions 93,8 %, lines 97,8 % (2026-10-13) |
| ESLint, Prettier, Husky | `pnpm lint`, `pnpm format:check`; hook pre-commit chạy trên file đã stage |

## Kiến trúc

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

API xác thực webhook, rồi ghi sự kiện, một operation và một dòng outbox trong cùng một transaction
và trả lời. Dispatcher đẩy các dòng outbox sang BullMQ. Worker nhận operation bằng lease và ghi lại
kết quả. Lỗi được thử lại có backoff tối đa năm lần, sau đó vào dead letter kèm thông báo.

| Tiến trình | Lệnh | Vai trò |
| --- | --- | --- |
| API | `node dist-tiktok/apps/tiktok/main.js` | Webhook, API quản trị, health, OpenAPI |
| Worker | `node dist-tiktok/apps/tiktok/worker.js` | Ingest, đồng bộ CRM, chuyển đổi, báo cáo, lịch |
| Migration | `node dist-tiktok/apps/tiktok/database/migration-runner.js` | Chạy một lần; an toàn khi chạy đồng thời |
| Mock | `node dist-tiktok/apps/tiktok/cli/mock-server.js` | Giả lập TikTok và Bitrix24, cổng 3002 |

### Cơ sở dữ liệu

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

Các bảng khác: `integration_user`, `integration_audit_event`, `integration_notification`,
`integration_campaign_daily`, `integration_assignment_cursor`, `integration_aggregate_lease`,
`integration_deal_poll_checkpoint`, `integration_bitrix_installation`. Schema do migration tạo;
`synchronize` tắt.

## Chạy nhanh bằng Docker

```bash
cp .env.example .env
docker compose -f docker-compose.tiktok.yml up -d --build --wait
docker compose -f docker-compose.tiktok.yml run --rm demo
```

`up` khởi động PostgreSQL, Redis và mock, chạy migration, seed dữ liệu demo, rồi khởi động API và
worker. `demo` gửi một webhook có chữ ký và đi hết luồng: Lead, Deal, Deal thắng, analytics, export
CSV/JSON/XLSX (khoảng 30 giây).

- API: <http://127.0.0.1:3001>; OpenAPI UI tại `/docs`, JSON tại `/docs-json`
- Health: `/health/live`, `/health/ready`, `/health`
- Tài khoản demo: `demo-admin`, `demo-operator`, `demo-analyst`; mật khẩu `demo-password-change-me`

Dừng bằng `docker compose -f docker-compose.tiktok.yml down`; thêm `-v` để xoá dữ liệu.

## Các chế độ Docker

`COMPOSE_PROFILES` trong `.env` chọn chế độ. Một database chỉ phục vụ một chế độ: trước khi đổi,
chạy `down -v` hoặc đặt `TIKTOK_COMPOSE_PROJECT` khác.

| Chế độ | `COMPOSE_PROFILES` | Đặt thêm |
| --- | --- | --- |
| Demo (mặc định) | `app,mock,demo` | `BITRIX_INTEGRATION_MODE=mock` |
| Portal Bitrix24 thật | `app,mock` | `BITRIX_INTEGRATION_MODE=real`, `BITRIX_PORTAL_KEY`, quyền truy cập portal (bên dưới) |
| Production | `app` | `NODE_ENV=production`, secret thật, `TIKTOK_REDIS_PASSWORD`, `CORS_ORIGINS` |
| Hạ tầng test | `--profile test` | không cần; PostgreSQL và Redis tạm trên cổng ngẫu nhiên |

Container chạy bằng user không phải root, filesystem gốc chỉ đọc, không có capability, có giới hạn
bộ nhớ, số tiến trình và log. PostgreSQL, Redis và mock nằm trong mạng nội bộ; chỉ API mở cổng, trên
`127.0.0.1`. Image được ghim theo digest.

Ở production, ứng dụng từ chối khởi động nếu còn secret `change-me` hoặc `CORS_ORIGINS=*`. Không có
dữ liệu seed: tạo tài khoản admin, rồi tải mapping và rule lên.

```bash
docker compose -f docker-compose.tiktok.yml run --rm create-user <username> integration_admin
```

## Chạy với portal Bitrix24 thật

Truy cập portal bằng một trong hai cách:

- **Incoming webhook**: `TIKTOK_BITRIX24_WEBHOOK_URL`, kèm một outgoing webhook cho các sự kiện Deal
  trỏ về `<API>/webhooks/bitrix24/deals`; application token của nó là
  `TIKTOK_BITRIX24_OUTGOING_TOKEN`.
- **Ứng dụng OAuth**: `BITRIX24_DOMAIN`, `BITRIX24_CLIENT_ID`, `BITRIX24_CLIENT_SECRET`; hai đường
  dẫn của ứng dụng đều là `<API>/install`, tick "Chỉ sử dụng API". Đặt `TIKTOK_PUBLIC_URL`; sau khi
  cài, ứng dụng tự đăng ký ba sự kiện Deal.

Portal cần có:

- **Quyền REST API.** Xem [mục bên dưới](#tài-khoản-dùng-thử-bitrix24-và-quyền-rest).
- **Chế độ CRM cổ điển.** Ở chế độ đơn giản, Bitrix24 tự chuyển mỗi lead mới thành deal, không theo
  pipeline, stage hay xác suất của rule. Khi đó cấu hình bị từ chối với 400, và lead bị giữ lại với
  mã `CRM_SIMPLE_MODE_UNSUPPORTED`.
- **Scope `crm` và `user`.** Thiếu `user` thì chỉ user của webhook mới làm người phụ trách được.
- **Các trường đích của mapping.** Mapping của đề cần bốn trường chuỗi của Lead: `UF_CRM_CITY`,
  `UF_CRM_UTM_CAMPAIGN`, `UF_CRM_AD_NAME`, `UF_CRM_TTCLID`.
- **Pipeline và stage của chính portal.** `pipeline_id: 1` của đề cần pipeline thứ hai; gói Free
  chỉ có pipeline 0.

Hành vi cần biết:

- Bản ghi do ứng dụng tạo mang `originatorId = aasc-tiktok`. Lead của tích hợp khác không bao giờ
  bị nhận lại, kể cả khi trùng phone hoặc email.
- Deal thắng hoặc thua được ghi xác suất 100 hoặc 0 lên portal.
- Một lịch quét định kỳ tìm thay đổi của Deal khi không có sự kiện nào tới.
- Automation của portal vẫn chạy trên các bản ghi này.

### Đã kiểm trên portal thật (2026-10-12)

| Luồng | Kết quả |
| --- | --- |
| Cài OAuth, lưu token, làm mới token | Đạt |
| Kiểm tra mapping và rule với portal | Đạt |
| Webhook → Lead có bốn trường tuỳ chỉnh; gửi lại cùng người thì gộp vào Lead cũ | Đạt |
| Rule → Deal với pipeline 0, stage `NEW`, xác suất 30 trên portal | Đạt (CRM cổ điển) |
| Chuyển đổi thủ công | Đạt |
| Sự kiện Deal do Bitrix24 gửi (đăng ký OAuth và outgoing webhook) → Deal thắng trong ứng dụng | Đạt |
| Callback Deal giả mạo | Bị từ chối với 401 |
| Analytics; export CSV, JSON, XLSX | Đạt |
| Ứng dụng chạy trong Docker với portal thật | Đạt |

Chưa kiểm trên portal thật: portal nhiều pipeline, và ba thay đổi làm sau các lần chạy trên (tự
đăng ký sự kiện sau khi cài OAuth, ghi lại xác suất khi Deal đóng, giữ lead ở chế độ CRM đơn
giản). Ba thay đổi này mới có unit test. Lý do nằm ở mục kế tiếp.

## Tài khoản dùng thử Bitrix24 và quyền REST

Tình trạng ngày 2026-10-12. Việc này chặn các lần kiểm tra tiếp trên portal thật, không ảnh hưởng
demo bằng mock.

**Tài liệu Bitrix24 nêu gì.** REST API có trong các gói Vibe+ và trong bản dùng thử 15 ngày của
gói Professional Vibe+. Các gói Essentials, gồm cả Free, không có REST. Mỗi portal chỉ kích hoạt
dùng thử được một lần. Danh sách giới hạn của bản dùng thử không nhắc tới REST, webhook hay ứng
dụng cục bộ, và không có hạn mức request nào được công bố.

**Điều đã xảy ra.**

| Portal | Quan sát |
| --- | --- |
| Thứ nhất (tạo đầu tháng 10) | Mọi method REST trả HTTP 403 `FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN`. |
| Thứ hai (tạo ngày 2026-10-12) | REST chạy khoảng hai giờ, sau đó mọi method, kể cả `server.time`, trả cùng lỗi 403. |

Trên portal thứ hai, tại thời điểm bị chặn:

- Trang gói ghi bản dùng thử Vibe+ còn hiệu lực tới 2026-10-27.
- Incoming webhook, hai outgoing webhook và ứng dụng cục bộ vẫn còn trong danh sách tích hợp.
- Thống kê của portal ghi khoảng 575 request REST trong ngày.
- Kích hoạt lại dùng thử thì nhận "Vibe+ feature trial has already been used".
- Mã lỗi này không có trong danh sách mã lỗi Bitrix24 công bố.

**Nguyên nhân.** Chưa xác định. Dấu hiệu rõ nhất là một khoá tạm do lượng lệnh gọi: ngày
2026-10-08, portal thứ nhất trả đúng mã lỗi này cho mọi method sau khoảng 900 lệnh gọi trong vài
giây, rồi tự hoạt động lại sau khoảng 20 phút (ghi trong `Readme.txt`, mục 15). Lần này khoá kéo
dài hơn một giờ và chưa mở lại tại thời điểm viết. Khả năng khác, chưa có bằng chứng: hạn chế với
tài khoản tạo nhiều portal dùng thử.

**Ảnh hưởng.** Các lần chạy thật trước khi bị chặn nằm trong bảng ở trên. Sau thời điểm đó không
chạy được gì trên portal thật.

**Hướng xử lý.**

- Chờ và gọi lại `server.time`; nếu là khoá tạm thì REST tự mở lại.
- Hỏi hỗ trợ Bitrix24 vì sao REST bị từ chối khi bản dùng thử còn hiệu lực.
- Xin NFR key với tư cách technology partner; tài liệu Bitrix24 nêu đây là cách có portal test có
  REST.
- Mua một gói Vibe+.

## Phát triển trên máy

API chạy từ mã nguồn, tự nạp lại khi lưu file; PostgreSQL, Redis và worker vẫn ở Docker. Cần
Node 24.9+, pnpm 11 và Linux, vì máy host truy cập kho dữ liệu qua IP của container.

```bash
pnpm install
docker compose -f docker-compose.tiktok.yml up -d --build --wait
docker compose -f docker-compose.tiktok.yml stop api       # giải phóng cổng 3001

docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \
  "$(docker compose -f docker-compose.tiktok.yml ps -q postgres)"
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \
  "$(docker compose -f docker-compose.tiktok.yml ps -q redis)"
```

Điền hai địa chỉ vào `.env` (Compose tự ghi đè hai biến này nên container không bị ảnh hưởng):

```bash
TIKTOK_DATABASE_URL=postgres://<user>:<password>@<IP postgres>:5432/<database>
TIKTOK_REDIS_URL=redis://<IP redis>:6379
```

```bash
pnpm start:tiktok:dev      # tự nạp .env; API tại http://127.0.0.1:3001
```

- Biến đặt trong shell được ưu tiên hơn `.env`, ví dụ `TIKTOK_APP_PORT=3011`.
- Địa chỉ đổi khi container kho dữ liệu được tạo lại.
- Worker chạy bằng image; build lại sau thay đổi mà worker dùng:
  `docker compose -f docker-compose.tiktok.yml up -d --build --no-deps worker`.
- `pnpm dev:proxy` nghe cổng 8080, chuyển `/webhooks/*` và `/api/v1/*` sang ứng dụng này, còn lại
  sang ứng dụng AASC, nên một tunnel phục vụ được cả hai. Khi đó `/install` thuộc ứng dụng AASC,
  nên ứng dụng này phải dùng incoming webhook.

## Chạy không dùng Docker

Cần Node 24.9+, pnpm 11, PostgreSQL 16 và Redis 7.

```bash
pnpm install
cp .env.example .env && set -a && . ./.env && set +a
export TIKTOK_BITRIX24_WEBHOOK_URL=http://127.0.0.1:3002/rest/1/mock/ TIKTOK_MOCK_BASE_URL=http://127.0.0.1:3002/tiktok
pnpm db:tiktok:migrate
pnpm tiktok:mock             # terminal 1
pnpm db:tiktok:seed
pnpm start:tiktok:prod       # terminal 2
pnpm start:tiktok:worker     # terminal 3
pnpm tiktok:demo
```

| Lệnh | Mục đích |
| --- | --- |
| `pnpm build:tiktok` | Biên dịch ra `dist-tiktok/` |
| `pnpm db:tiktok:migrate` / `db:tiktok:seed` | Migration; dữ liệu demo (chỉ chế độ mock) |
| `pnpm tiktok:user:create <username> <role[,role]>` | Tạo tài khoản; mật khẩu được hỏi khi chạy |
| `pnpm tiktok:webhook` | Gửi một webhook có chữ ký |
| `pnpm tiktok:demo` | Toàn bộ luồng demo, chỉ chế độ mock |
| `pnpm tiktok:load-probe` | Đo độ trễ webhook |
| `pnpm tiktok:openapi` | Xuất tài liệu OpenAPI |
| `pnpm test:tiktok:unit` / `:integration` / `:e2e` / `:cov` | Các bộ test; `:cov` chạy cả ba kèm ngưỡng coverage |

Test integration và E2E dùng container riêng:

```bash
docker compose -p aasc-tiktok-tests -f docker-compose.tiktok.yml --profile test up -d --wait
docker compose -p aasc-tiktok-tests -f docker-compose.tiktok.yml port test-postgres 5432
docker compose -p aasc-tiktok-tests -f docker-compose.tiktok.yml port test-redis 6379
export TIKTOK_TEST_DATABASE_URL=postgres://tiktok_test:tiktok_test_only@127.0.0.1:<cổng postgres>/tiktok_test
export TIKTOK_TEST_REDIS_URL=redis://127.0.0.1:<cổng redis>
pnpm test:tiktok:cov
```

## Cấu hình

Mọi biến được mô tả trong Part 2 của [`.env.example`](.env.example).

- **Định danh triển khai**: `TIKTOK_ADVERTISER_ID`, `BITRIX_PORTAL_KEY`, `TIKTOK_MODE`,
  `BITRIX_INTEGRATION_MODE`. Lần khởi động đầu lưu các giá trị này; ứng dụng từ chối một database
  đã khởi tạo với giá trị khác.
- **Secret**: `TIKTOK_JWT_SECRET` (từ 32 ký tự), `TIKTOK_WEBHOOK_SECRET`,
  `BITRIX_MOCK_EVENT_SECRET` hoặc `TIKTOK_BITRIX24_OUTGOING_TOKEN`.
- **Worker**: `INTEGRATION_WORKER_ENABLED=true` trên API để readiness chờ heartbeat của worker;
  `INTEGRATION_SCHEDULER_ENABLED=true` trên các worker chạy lịch.
- **Proxy**: `TIKTOK_TRUSTED_PROXIES`; nếu không đặt, `X-Forwarded-For` bị bỏ qua.

Mapping và rule là cấu hình có phiên bản: `GET/PUT /api/v1/config/mappings` và
`/api/v1/config/rules`, chỉ admin, kèm `If-Match` là revision hiện tại (`"0"` cho lần đầu). Body
của `PUT` là `{ "value": <tài liệu> }` theo định dạng gốc
([`mapping.json`](samples/tiktok/mapping.json), [`rules.json`](samples/tiktok/rules.json)) hoặc tài
liệu của đề. `deal_rules` của đề bổ sung vào một rules policy có sẵn, nên phải lưu policy trước.

Quality score (0–100): email 15, phone 15, hoàn tất form 20, tối đa bốn tương tác trong 30 ngày,
mỗi tương tác 5, và 15 cho mỗi câu trả lời về ngân sách và thời gian nằm trong rules policy.

## Tổng quan API

| Nhóm | Endpoint |
| --- | --- |
| Webhook | `POST /webhooks/tiktok/leads`, `POST /webhooks/bitrix24/deals` |
| Xác thực | `POST /api/v1/auth/login`, `POST /api/v1/auth/logout` |
| Lead và Deal | `GET /api/v1/leads`, `GET /api/v1/deals`, `POST /api/v1/leads/:id/convert-to-deal` |
| Analytics | `GET /api/v1/analytics/conversion-rates`, `GET /api/v1/analytics/campaign-performance` |
| Báo cáo | `GET /api/v1/reports/export`, `POST /api/v1/reports/exports`, `GET /api/v1/reports/jobs/:id[/download]` |
| Import | `POST /api/v1/leads/imports`, `POST /api/v1/analytics/campaign-costs/imports` |
| Operation | `GET /api/v1/operations[/:id]`, `POST /api/v1/operations/:id/retry`, `POST /api/v1/operations/:id/resolve` |
| Thông báo | `GET /api/v1/notifications` |
| Health | `GET /health/live`, `GET /health/ready`, `GET /health` |

Vai trò: `integration_admin` (mọi thứ), `integration_operator` (lead, deal, chuyển đổi, import,
retry), `integration_analyst` (đọc, analytics, export). Giới hạn mỗi phút: 600 request cho mỗi địa
chỉ trên endpoint công khai, 120 webhook cho mỗi advertiser, 120 lần đọc và 30 lần ghi cho mỗi
user.

Campaign performance mặc định lấy 30 ngày trọn gần nhất và không tính hôm nay; truyền `from` và
`to` để lấy cả hôm nay.

## Vận hành

- **Việc bị kẹt**: `GET /api/v1/operations?status=dead_letter` (hoặc `retry_wait`,
  `reconcile_required`, `quarantined`). `retry` đưa operation vào hàng đợi lại.
  `reconcile_required` nghĩa là lệnh tạo có thể đã tới Bitrix24; worker tra bản ghi theo marker, và
  admin chốt bằng `resolve`.
- **Redis ngừng**: webhook vẫn được lưu và trả lời, rồi xử lý khi Redis chạy lại. Đăng nhập và API
  quản trị trả 503.
- **Token Bitrix24 bị thu hồi**: operation chuyển sang `retry_wait`. Cài lại ứng dụng hoặc gọi
  `GET /install/authorize` bằng tài khoản admin, rồi retry.
- **Sao lưu**: PostgreSQL là nguồn dữ liệu gốc duy nhất.

  ```bash
  docker compose -f docker-compose.tiktok.yml exec -T postgres \
    pg_dump -U tiktok -d tiktok --format=custom > tiktok.dump
  docker compose -f docker-compose.tiktok.yml exec -T postgres \
    pg_restore -U tiktok -d tiktok --clean --if-exists < tiktok.dump   # dừng API và worker trước
  ```

  Sau khi khôi phục, khởi động worker trước.
- **Lưu giữ**: raw body của webhook 30 ngày, file export 24 giờ, file import 30 ngày, audit và
  operation đã xong 180 ngày. Việc chưa xong không bao giờ bị xoá.
- **Nâng cấp**: chạy migration trước khi khởi động API và worker bản mới.

## Xử lý sự cố

| Hiện tượng | Nguyên nhân và cách xử lý |
| --- | --- |
| Webhook trả 401 | Sai `TIKTOK_WEBHOOK_SECRET`, chữ ký cũ hơn năm phút, hoặc body bị đổi. Định dạng: `t=<unix>,s=<hex HMAC-SHA256 của "<t>.<raw body>">`. |
| Webhook trả 400 | Thiếu `event_id`, `event`, `advertiser_id` hoặc `timestamp`, hoặc `lead.generate` thiếu campaign ID, form ID hay `lead_data`. |
| Webhook trả 403 | `advertiser_id` khác `TIKTOK_ADVERTISER_ID`. |
| Webhook được nhận nhưng không có lead | Worker không chạy, hoặc sự kiện bị giữ lại: `GET /api/v1/operations?status=quarantined`. |
| Lead đứng ở `pending` | Lệnh gọi Bitrix24 được giãn một request mỗi giây; xem `/health` và `?status=retry_wait`. |
| Mọi lệnh gọi Bitrix24 lỗi 403 `FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN` | Portal không có quyền REST. Xem [Tài khoản dùng thử Bitrix24](#tài-khoản-dùng-thử-bitrix24-và-quyền-rest). |
| `PUT /api/v1/config/*` trả 428 hoặc 409 | Thiếu `If-Match` hoặc revision cũ: đọc lại tài nguyên và gửi `ETag` của nó. |
| `PUT /api/v1/config/*` trả 400 `simple CRM mode`, hoặc lead lỗi `CRM_SIMPLE_MODE_UNSUPPORTED` | Chuyển portal sang CRM cổ điển (CRM > Cài đặt > Chế độ CRM), rồi retry operation. |
| `PUT /api/v1/config/mappings` trả 400 | Trường đích không tồn tại trên portal, hoặc đường dẫn nguồn không được hỗ trợ. |
| Không nhận được sự kiện Deal sau khi cài OAuth | `TIKTOK_PUBLIC_URL` trống hoặc Bitrix24 không gọi tới được. Đặt lại rồi cài lại ứng dụng. |
| Deal không có xác suất hoặc sai stage của rule | Bitrix24 tự tạo Deal đó ở chế độ CRM đơn giản. |
| Khởi động lỗi, mọi biến `received undefined` | Chưa nạp `.env`. Chỉ `pnpm start:tiktok:dev` tự nạp; lệnh khác cần `set -a; . ./.env; set +a`. |
| Khởi động lỗi `ENOTFOUND postgres` hoặc `redis` | Máy host không phân giải được tên service của Compose. Xem [Phát triển trên máy](#phát-triển-trên-máy). |
| API hoặc worker thoát khi khởi động | Thông báo nêu tên biến; hoặc database đã dùng với advertiser, portal hay chế độ khác. |
| `/health/ready` trả 503 | Body nêu tên kiểm tra bị lỗi. `schema` nghĩa là chưa chạy migration. |
| Export trả 422 `EXPORT_REQUIRES_ASYNC` | Hơn 10.000 lead: dùng `POST /api/v1/reports/exports`. |

Mọi lỗi có cùng dạng: `{ statusCode, error, message, path, timestamp }`, thêm `code` khi nguyên
nhân có mã ổn định.

## Quyết định kỹ thuật

- **Trả lời sau khi commit.** Sự kiện, operation và dòng outbox được ghi trong một transaction, nên
  crash hay Redis ngừng chỉ làm lead chậm, không làm mất hay trùng.
- **PostgreSQL là nguồn dữ liệu gốc; BullMQ chỉ vận chuyển.** Job chỉ mang ID của operation. Một
  sweeper đẩy lại job bị mất và khôi phục operation có worker đã chết.
- **Idempotent ở mọi ranh giới.** Sự kiện theo key và hash nội dung, lead theo email và phone đã
  chuẩn hoá, bản ghi từ xa theo marker. Lệnh tạo bị timeout được tra lại, không gửi lại.
- **Một ngân sách retry.** Năm lần với backoff luỹ thừa và jitter, sau đó vào dead letter.
- **Chuyển đổi là một saga.** Bitrix24 không có lệnh "convert lead" duy nhất, nên từng bước được
  lưu và chạy tiếp từ chỗ dừng.
- **Cấu hình có phiên bản.** Operation giữ revision của mapping và rule từ lúc bắt đầu.
- **Rule là dữ liệu.** Một DSL JSON trên danh sách trường cho phép; chuỗi điều kiện của đề được
  phân tích bằng ngữ pháp cố định, không bao giờ được thực thi.
- **Tiền và thời gian.** Số thập phân, khoảng nửa mở, múi giờ của advertiser. Thiếu chi phí một
  ngày thì cost per lead và ROI là `null`.
- **Rate limit** trong Redis cho phía gọi, và một bộ giãn nhịp dùng chung giữa các tiến trình cho
  lệnh gọi Bitrix24.
- **Database riêng.** PostgreSQL với migration, tách khỏi SQLite của ứng dụng AASC.

## Cải tiến cho môi trường production

- Chạy ba thay đổi chưa kiểm và một portal nhiều pipeline trên portal thật khi có quyền REST.
- Thêm adapter TikTok thật: chữ ký webhook theo định nghĩa của TikTok, lấy lead, báo cáo chi phí
  campaign, Events API.
- Kết thúc TLS ở reverse proxy, giữ secret trong secret manager, quét image trong CI.
- Dùng PostgreSQL và Redis dạng managed có point-in-time recovery; runbook hiện chỉ có `pg_dump`.
- Xuất metric và trace; cảnh báo theo dead letter và operation chờ lâu nhất.
- Thử mở rộng worker theo chiều ngang ngoài vài tiến trình trên một máy.
- Thêm kênh thông báo qua chat Bitrix24 hoặc email.

## Giới hạn của bản nộp

- TikTok chỉ có mock. Chi phí campaign lấy từ import CSV; conversion feedback gửi tới mock.
- Việc kiểm tra trên Bitrix24 thật dừng lại khi các portal dùng thử mất quyền REST; xem
  [Tài khoản dùng thử Bitrix24](#tài-khoản-dùng-thử-bitrix24-và-quyền-rest) để biết phần đã và
  chưa kiểm.
- Các lần chạy OAuth dùng `NODE_ENV=development`. Ở production, kiểm tra lúc khởi động chấp nhận
  OAuth khi có đủ `BITRIX24_CLIENT_ID`, `BITRIX24_CLIENT_SECRET` và `BITRIX24_DOMAIN`.
- Chế độ CRM được kiểm khi lưu cấu hình và trước khi tạo lead. Chế độ cổ điển được nhớ năm phút.
- Thông báo chỉ có trong ứng dụng và trong log.
- Tài khoản demo và mock server chỉ dùng trên máy; không bao giờ mở cổng 3002 ra ngoài.

### Phần nhận webhook

Đây là bài kiểm tra phỏng vấn chạy với mock, không nhằm triển khai production. Các điểm dưới đây
được ghi lại từ lần rà soát mã ngày 2026-10-13 và chưa sửa:

- `POST /webhooks/tiktok/leads` chỉ xác thực được chữ ký HMAC của mock (`tiktok-signature:
  t=…,s=…`). Với `TIKTOK_MODE=business-api` endpoint trả 503 cho mọi request.
- Khi không lưu được webhook TikTok, API trả 503 nhưng log không giữ lỗi gốc. Một lỗi cố định trong
  mã cũng thành 503, nên bên gửi sẽ gửi lại mãi.
- `NODE_ENV=production` vẫn chấp nhận `TIKTOK_MODE=mock` và `BITRIX_INTEGRATION_MODE=mock`; chỉ
  secret mẫu bị từ chối.
- Mỗi loại webhook có một secret, không có khoảng chuyển tiếp khi đổi secret.
- `TIKTOK_TRUSTED_PROXIES` so khớp từng IP, không nhận CIDR. Nếu IP của reverse proxy không được
  khai đúng, mọi client dùng chung một hạn mức 600 request/phút.
- Sự kiện Deal của Bitrix24 đến từ ít địa chỉ IP, nên một đợt cập nhật hàng loạt có thể vượt hạn
  mức theo IP và nhận 429. Khóa chống trùng của sự kiện tính theo giây, nên hai lần cập nhật cùng
  một Deal trong một giây được coi là một. Cả hai trường hợp do lịch poll Deal bù lại, có trễ.
- Body được parse (tối đa 256 KB) trước khi tới rate limit.
- Khi Redis mất kết nối lâu, các client Redis đã đóng không được gỡ khỏi danh sách, bộ nhớ tăng
  chậm cho tới khi khởi động lại.
