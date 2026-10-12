# AASC Assessment

Repository này chứa hai ứng dụng NestJS (TypeScript) độc lập, dùng chung mã nguồn trong `src/`
nhưng chạy riêng: mỗi ứng dụng có cổng, cơ sở dữ liệu, Dockerfile và file Compose của mình.

| Ứng dụng                          | Đề bài                                                                                    | Cổng | Lưu trữ                    | Tài liệu chi tiết                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------- | ---- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **TikTok – Bitrix24 integration** | Tích hợp TikTok Lead Generation với Bitrix24 CRM                                          | 3001 | PostgreSQL, Redis (BullMQ) | [`README-tiktok.md`](README-tiktok.md), [`huong-dan/tiktok-bitrix24.md`](huong-dan/tiktok-bitrix24.md)                       |
| **AASC assessment app**           | Tư duy lập trình, API cơ bản (OAuth Bitrix24, Contact), Jotform, Google Sheets → Bitrix24 | 3000 | SQLite                     | [`Readme.txt`](Readme.txt), [`huong-dan/huong-dan-tich-hop-google-sheets.md`](huong-dan/huong-dan-tich-hop-google-sheets.md) |

File này là trang vào của repository. Hướng dẫn đầy đủ (kiến trúc, cấu hình, vận hành, xử lý sự
cố) nằm trong các tài liệu ở cột cuối.

## Yêu cầu môi trường

- **Chỉ dùng Docker:** Docker có Docker Compose. Không cần cài Node.js.
- **Chạy từ mã nguồn:** Node.js 24.9 trở lên và pnpm 11. Ứng dụng TikTok cần thêm PostgreSQL 16
  và Redis 7; ứng dụng AASC không cần cơ sở dữ liệu ngoài.

Cả hai ứng dụng đọc cấu hình từ một file `.env` duy nhất: sao chép từ
[`.env.example`](.env.example) (Part 1 cho ứng dụng AASC, Part 2 cho ứng dụng TikTok). Không
commit `.env`.

## TikTok – Bitrix24 integration

Nhận webhook lead có chữ ký từ TikTok, tạo và cập nhật Lead/Deal trong Bitrix24, cung cấp API
analytics, báo cáo và vận hành. TikTok chạy ở chế độ mock (đề bài cho phép); Bitrix24 chạy với
mock server đi kèm hoặc với một portal thật.

### Chạy demo bằng Docker

```bash
cp .env.example .env
docker compose -f docker-compose.tiktok.yml up -d --build --wait
docker compose -f docker-compose.tiktok.yml run --rm demo
```

Lệnh `up` khởi động PostgreSQL, Redis và mock provider, chạy migration, seed dữ liệu demo, rồi
khởi động API và worker. Lệnh `demo` gửi một webhook có chữ ký và đi hết luồng: Lead → Deal →
Deal won → analytics → export CSV/JSON/XLSX (khoảng nửa phút).

- API: <http://127.0.0.1:3001>
- Swagger UI: <http://127.0.0.1:3001/docs>, JSON tại `/docs-json`
- Health: `/health/live`, `/health/ready`, `/health`
- Tài khoản demo: `demo-admin`, `demo-operator`, `demo-analyst`, mật khẩu
  `demo-password-change-me`

Dừng bằng `docker compose -f docker-compose.tiktok.yml down`; thêm `-v` để xoá cả dữ liệu demo.

### Chạy từ mã nguồn

- Watch mode trên máy, PostgreSQL/Redis/worker vẫn ở Docker: mục
  [Local development](README-tiktok.md#local-development-watch-mode-on-the-host).
- Không dùng Docker: mục [Running without Docker](README-tiktok.md#running-without-docker).
- Với portal Bitrix24 thật: mục
  [Running against a real Bitrix24 portal](README-tiktok.md#running-against-a-real-bitrix24-portal).

### Endpoint theo đề bài

| Nhóm      | Endpoint                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| Webhook   | `POST /webhooks/tiktok/leads`, `POST /webhooks/bitrix24/deals`                                                       |
| Quản lý   | `GET /api/v1/leads`, `GET /api/v1/deals`, `POST /api/v1/leads/:id/convert-to-deal`                                   |
| Cấu hình  | `GET`/`PUT /api/v1/config/mappings`, `GET`/`PUT /api/v1/config/rules`                                                |
| Analytics | `GET /api/v1/analytics/conversion-rates`, `GET /api/v1/analytics/campaign-performance`, `GET /api/v1/reports/export` |

Toàn bộ route nằm trong [`api-docs/tiktok-openapi.json`](api-docs/tiktok-openapi.json). Payload
webhook và cấu hình mapping/rule in trong đề bài có sẵn ở [`samples/tiktok/`](samples/tiktok/).

### Kiểm thử

Test dùng container riêng, không đụng tới dữ liệu demo hay cơ sở dữ liệu thật:

```bash
docker compose -p aasc-tiktok-tests -f docker-compose.tiktok.yml --profile test up -d --wait
docker compose -p aasc-tiktok-tests -f docker-compose.tiktok.yml port test-postgres 5432
docker compose -p aasc-tiktok-tests -f docker-compose.tiktok.yml port test-redis 6379
export TIKTOK_TEST_DATABASE_URL=postgres://tiktok_test:tiktok_test_only@127.0.0.1:<cổng postgres>/tiktok_test
export TIKTOK_TEST_REDIS_URL=redis://127.0.0.1:<cổng redis>
pnpm test:tiktok:cov        # unit + integration + E2E, kèm ngưỡng coverage 85 %
```

Chạy riêng từng bộ: `pnpm test:tiktok:unit`, `pnpm test:tiktok:integration`,
`pnpm test:tiktok:e2e`.

Kết quả lần chạy ngày 2026-10-12:

| Chỉ số     | Kết quả         |
| ---------- | --------------- |
| Test suite | 225 / 225 đạt   |
| Test       | 1935 / 1935 đạt |
| Statements | 96,72 %         |
| Branches   | 88,60 %         |
| Functions  | 93,69 %         |
| Lines      | 97,73 %         |

Phạm vi tính coverage được khai báo trong
[`test/tiktok/coverage-scope.mjs`](test/tiktok/coverage-scope.mjs).

### Giới hạn

- Chỉ có chế độ mock cho TikTok: TikTok Business API thật (lấy lead, chi phí, Events API) chưa
  được nối vì cần tài khoản được cấp quyền.
- Bitrix24 thật đã được kiểm qua incoming webhook và qua ứng dụng OAuth (cài đặt, làm mới token,
  sự kiện Deal do portal tự gửi; lần chạy ngày 2026-10-12). Chưa kiểm được portal nhiều pipeline
  vì gói của portal thử chỉ cho một pipeline.

Chi tiết ở mục [Limits of this delivery](README-tiktok.md#limits-of-this-delivery).

## AASC assessment app

Gồm API quản lý Task, bài Fibonacci, server game (Line 98, Cờ Caro qua WebSocket), OAuth và API
Contact với Bitrix24, tích hợp Jotform, và đồng bộ lead từ Google Sheets sang Bitrix24.

```bash
pnpm install
cp .env.example .env
pnpm start:dev              # http://localhost:3000, Swagger tại /docs
```

Hoặc bằng Docker: `make docker-up`. Hướng dẫn cài đặt, cấu hình ngrok/Bitrix24/Jotform và kết quả
test nằm trong [`Readme.txt`](Readme.txt).

## Kiểm tra mã nguồn

```bash
pnpm lint            # ESLint
pnpm typecheck       # TypeScript
pnpm format:check    # Prettier
pnpm check           # lint + typecheck + unit + E2E của ứng dụng AASC + bài Fibonacci
```

Husky chạy ESLint và Prettier trên các file đã stage trước mỗi commit.

## Cấu trúc thư mục

| Đường dẫn                                 | Nội dung                                                         |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `src/apps/tiktok/`                        | Điểm vào của ứng dụng TikTok: API, worker, migration, seed, CLI  |
| `src/modules/`                            | Module nghiệp vụ của cả hai ứng dụng                             |
| `src/core/`, `src/common/`, `src/config/` | Hạ tầng (database, queue, health), tiện ích dùng chung, cấu hình |
| `test/`, `test/tiktok/`                   | E2E của ứng dụng AASC; integration và E2E của ứng dụng TikTok    |
| `samples/`, `api-docs/`                   | Dữ liệu mẫu và tài liệu OpenAPI đã export                        |
| `huong-dan/`                              | Hướng dẫn tiếng Việt                                             |
| `public/`, `scripts/`                     | Client trình duyệt của game; bài Fibonacci và script demo        |
