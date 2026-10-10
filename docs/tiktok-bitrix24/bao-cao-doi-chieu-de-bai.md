# Báo cáo đối chiếu đề bài TikTok Lead Generation → Bitrix24 CRM

**Ngày kiểm tra:** 2026-10-11

**Nguồn yêu cầu:** PDF đề bài 8 trang tại `docs/V2 - Bai Tich hop Tiktok voi Bitrix24 - Version 1.pdf` (tệp cục bộ, không theo dõi trong Git).

**Phạm vi:** nhánh mwosi, HEAD b838e9e tại thời điểm rà soát; kiểm tra mã nguồn, build, unit, integration và E2E trên PostgreSQL/Redis test. Không kết nối lại TikTok Business hoặc portal Bitrix24 thật trong lần này.

## Kết luận

**Phần lõi và sáu tình huống demo đã được triển khai cho chế độ mock mà đề cho phép.** Các endpoint bắt buộc đều có trong mã và OpenAPI. Lần kiểm thử tổng hợp hiện đạt **224/224 suite, 1.926/1.926 test**; cả bốn chỉ số coverage đều trên 85%. Biên bản cục bộ `docs/tiktok-bitrix24/deployment-evidence.md` ngày 2026-10-09 ghi nhận luồng webhook → Lead → Deal won → analytics → export chạy trên Docker.

**Chưa thể coi là hoàn thành 100% gói nộp hoặc tích hợp TikTok thật.** Chữ ký và Events API phía TikTok hiện là mock; guard từ chối chế độ business-api. Bitrix24 incoming webhook thật được README ghi là đã thử trên một portal, nhưng OAuth, nhiều pipeline và callback do portal tự gửi chưa được xác minh. Repository chưa có README.md đúng tên đề yêu cầu. Khi kiểm tra, chỉ có PostgreSQL/Redis test đang chạy, không có API/worker TikTok đang hoạt động để kiểm tra một deployment hiện tại.

## 1. Yêu cầu chức năng

| Hạng mục trong PDF | Trạng thái | Bằng chứng và cách làm |
| --- | --- | --- |
| Webhook TikTok, chữ ký, raw data | **Đạt trong mock** | [Endpoint](../../src/modules/tiktok/controllers/tiktok-webhook.controller.ts#L8), [guard chữ ký](../../src/modules/tiktok/guards/tiktok-signature.guard.ts#L21) kiểm HMAC raw body và cửa sổ 5 phút; [inbox](../../src/modules/tiktok/services/tiktok-inbox.service.ts#L33) lưu event, operation và outbox trong một transaction. Đây là định dạng chữ ký mock. |
| Ba loại sự kiện | **Đạt trong mock** | [lead.generate, form.complete, user.interaction](../../src/modules/tiktok/constants/webhook-events.constants.ts#L1) được [ingest worker xử lý](../../src/modules/crm-integration/services/lead-ingest.service.ts#L106). |
| Validate, chuẩn hóa, quy nguồn, dedup | **Đạt** | [Parser webhook](../../src/modules/tiktok/domain/webhook-envelope.ts#L18), [chuẩn hóa email/phone/campaign/ad/form](../../src/modules/crm-integration/domain/normalize-lead.ts#L12), [khóa định danh email/phone và xử lý xung đột](../../src/modules/crm-integration/services/lead-ingest.service.ts#L164). Dữ liệu ad/form được lưu và export; API danh sách Lead mới lọc riêng theo campaign. |
| Tạo và cập nhật Lead trong Bitrix24, mapping, merge, timeline | **Đạt với mock; Bitrix24 thật có bằng chứng tài liệu** | [Lead sync](../../src/modules/crm-integration/services/lead-sync.service.ts#L103) tìm Lead từ marker/email/phone, tạo hoặc cập nhật, rồi ghi timeline; [gateway](../../src/modules/crm-integration/gateways/bitrix-crm.gateway.ts#L36); [config mapping](../../src/modules/crm-integration/controllers/configuration.controller.ts#L31). [Importer](../../src/modules/crm-integration/domain/assignment-config-import.ts#L87) nhận field_mapping trong mẫu đề. README mô tả lần thử portal thật, chưa chạy lại ở đây. |
| Rule engine, Deal, stage/probability, gán sales | **Đạt trong mock** | [ConversionService](../../src/modules/crm-integration/services/conversion.service.ts#L67) đánh giá rule, chọn stage và assignee, lưu Deal/operation; [GET/PUT rules](../../src/modules/crm-integration/controllers/configuration.controller.ts#L47). |
| Notification | **Đạt trong app/log** | [NotificationService](../../src/modules/integration-reports/services/notification.service.ts#L49) lưu thông báo và log; chưa có adapter gửi thông báo qua Bitrix24. |
| Conversion rate, CPL, ROI, quality score, dashboard API | **Đạt với dữ liệu có sẵn** | [Hai endpoint analytics](../../src/modules/integration-analytics/controllers/analytics.controller.ts#L21), [tính cohort và financials](../../src/modules/integration-analytics/services/analytics.service.ts#L38), [điểm 0–100](../../src/modules/crm-integration/domain/lead-score.ts#L72). Chi phí lấy từ seed/CSV trong mock; thiếu chi phí thì CPL/ROI là null. |
| Export CSV/Excel, import lịch sử, báo cáo định kỳ, cảnh báo | **Đạt** | [Report API](../../src/modules/integration-reports/controllers/reports.controller.ts#L45), [CSV/JSON/XLSX writers](../../src/modules/integration-reports/services/export-writers.ts#L22), [Lead/cost imports](../../src/modules/integration-reports/controllers/imports.controller.ts#L90), [daily scheduler](../../src/modules/integration-reports/services/report-scheduler.service.ts#L33), [alert](../../src/modules/integration-reports/services/alert.service.ts#L47). |
| Conversion event ngược về TikTok | **Đạt trong mock** | [Feedback ledger và worker](../../src/modules/tiktok/services/conversion-feedback.service.ts#L32) gửi qua [MockTiktokAdapter](../../src/modules/tiktok/adapters/mock-tiktok.adapter.ts#L29), chưa tới TikTok Events API thật. |

**Endpoint bắt buộc:** 10/10 path trong PDF hiện diện trong [OpenAPI JSON](../../api-docs/tiktok-openapi.json): hai webhook, Lead/Deal list, convert, mapping/rules GET và PUT, hai analytics và export. API quản trị dùng JWT/role; webhook dùng guard riêng.

## 2. Yêu cầu kỹ thuật và deliverables

| Hạng mục | Trạng thái | Bằng chứng / giới hạn |
| --- | --- | --- |
| NestJS + TypeScript, DI, guards/interceptors, lỗi/log, Swagger | **Đạt** | [package.json](../../package.json) dùng NestJS 12; [bootstrap](../../src/apps/tiktok/bootstrap.ts), [OpenAPI](../../src/apps/tiktok/openapi.ts#L34), UI /docs và JSON /docs-json. |
| PostgreSQL, TypeORM, migrations, seed, index | **Đạt** | [DataSource riêng](../../src/apps/tiktok/database/data-source.ts#L17) có 9 migration, tắt synchronize; [schema và index](../../src/apps/tiktok/database/migrations/1791417601000-integration-domain.ts#L22); [seed demo](../../src/apps/tiktok/database/seed.ts#L104) từ chối production và non-mock. |
| Redis cache/session, BullMQ, retry/dead letter, rate limit | **Đạt** | [Cache analytics](../../src/modules/integration-analytics/services/analytics-cache.service.ts#L24); [operation runner](../../src/core/queue/services/operation-runner.service.ts#L26) và [retry policy](../../src/core/queue/services/retry-policy.service.ts#L17) tối đa 5 lần; [rate guard](../../src/core/queue/guards/ingress-rate-limit.guard.ts#L35). PostgreSQL giữ operation/outbox để phục hồi. |
| Docker/Compose, multi-stage, health | **Đạt về cấu hình và demo trước đó** | [Dockerfile](../../Dockerfile.tiktok#L23), [Compose](../../docker-compose.tiktok.yml#L106), [health endpoints](../../src/apps/tiktok/health/health.controller.ts#L6). Chưa kiểm tra deployment đang chạy khi viết báo cáo. |
| Unit, integration, E2E, coverage ≥80%, ESLint/Prettier/Husky | **Đạt lần chạy hiện tại** | Kết quả mục 4; ngưỡng Jest [85% cho bốn chỉ số](../../test/tiktok/jest-coverage.config.mjs#L35). |
| Environment, OpenAPI JSON, kiến trúc/ERD, deploy/troubleshooting | **Đủ nội dung, thiếu README.md** | [env mẫu](../../.env.example), [OpenAPI JSON](../../api-docs/tiktok-openapi.json), [README-tiktok.md](../../README-tiktok.md#L1) có sơ đồ Mermaid, quyết định kỹ thuật và vận hành; [hướng dẫn tiếng Việt](../../huong-dan/tiktok-bitrix24.md). Root không có README.md như PDF nêu. |
| GitHub repository để nộp | **Chưa xác nhận đã nộp** | Có remote GitHub, nhưng chưa có bằng chứng đã gửi link nộp bài. Tại thời điểm rà soát, còn file test chưa theo dõi tại src/core/queue/__tests__/redis-connection.spec.ts. Theo AGENTS.md, docs/ mặc định là tài liệu làm việc không commit. |

## 3. Kiến trúc và cách triển khai

Luồng chính: TikTok mock sender → POST /webhooks/tiktok/leads (rate limit, chữ ký, validate) → PostgreSQL lưu webhook event + operation + outbox cùng transaction → dispatcher đưa job sang Redis/BullMQ → worker ingest chuẩn hóa và dedup → worker đồng bộ Lead sang Bitrix24 mock hoặc incoming webhook thật → rule engine tạo Deal, chọn sales/stage → feedback, notification, analytics và report.

Ứng dụng TikTok tách khỏi app AASC cũ: API cổng **3001**, worker riêng, PostgreSQL riêng, Redis cho queue/cache/limiter, build ra dist-tiktok/. [Compose](../../docker-compose.tiktok.yml#L171) khởi động PostgreSQL/Redis, migration, API và worker; profile mock thêm provider giả, profile demo thêm seed. Bitrix24 thật dùng BITRIX_INTEGRATION_MODE=real cùng incoming webhook URL. [README-tiktok.md](../../README-tiktok.md#L155) mô tả các mode và biến môi trường.

Chạy demo theo hướng dẫn hiện tại:

    cp .env.example .env
    docker compose -f docker-compose.tiktok.yml up -d --build --wait
    docker compose -f docker-compose.tiktok.yml run --rm demo

Lệnh demo đi qua webhook → Lead → Deal → won → analytics → export CSV/JSON/XLSX. Biên bản cục bộ `docs/tiktok-bitrix24/deployment-evidence.md` ngày 2026-10-09 ghi nhận thành công; đó là bằng chứng lịch sử, không phải deployment đang hoạt động lúc viết báo cáo.

## 4. Kết quả kiểm tra ngày 2026-10-11

| Kiểm tra | Kết quả |
| --- | --- |
| pnpm build:tiktok | Đạt |
| pnpm lint | Đạt |
| pnpm typecheck | Đạt |
| pnpm format:check | Đạt |
| pnpm test:tiktok:unit --runInBand | **192/192 suite, 1.667/1.667 test đạt.** Config unit hiện quét toàn bộ src, gồm cả app AASC cũ. |
| pnpm test:tiktok:cov với PostgreSQL/Redis test | **224/224 suite, 1.926/1.926 test đạt**, gồm unit, integration và E2E. Harness tạo schema PostgreSQL và prefix Redis riêng rồi dọn sau chạy. |
| Coverage tổng hợp | **Statements 96,71% (6.189/6.399); branches 88,57% (3.971/4.483); functions 93,67% (963/1.028); lines 97,73% (5.512/5.640).** Đều trên ngưỡng 85% của Jest và 80% của đề. Tệp cục bộ `coverage-tiktok/combined/coverage-summary.json` được tạo lúc 02:14 ngày 2026-10-11 (Asia/Ho_Chi_Minh). |
| Đối chiếu OpenAPI | 10/10 path bắt buộc hiện diện trong JSON export. |

Phạm vi coverage xác định tại [coverage-scope.mjs](../../test/tiktok/coverage-scope.mjs): loại trừ composition module, entrypoint, migration và mock server. Tỷ lệ trên không đại diện mọi dòng trong repository. Không chạy lại demo Docker hoặc portal thật trong lần rà soát này.

## 5. Việc còn lại

1. **Gói nộp:** tạo README.md ở root hoặc xác nhận bên nhận bài chấp nhận README-tiktok.md; review file test chưa theo dõi và xác nhận link GitHub trước khi nộp.
2. **TikTok Business production:** thay giao thức chữ ký mock trong [guard](../../src/modules/tiktok/guards/tiktok-signature.guard.ts#L21), nối API lấy Lead/chi phí và Events API; xác minh với tài khoản, quyền và payload thật. Đề cho phép mock nên việc này không chặn demo tuyển dụng.
3. **Bitrix24 thật:** kiểm tra OAuth install/refresh, portal nhiều pipeline và callback do portal tự gửi. README chỉ ghi nhận incoming webhook trên một portal Free và callback mô phỏng theo định dạng Bitrix24.
4. **Cập nhật tài liệu:** [README-tiktok.md](../../README-tiktok.md#L38) còn ghi 1.399 test và branch coverage 77%, không khớp lần chạy mới. Các biên bản ngày 2026-10-09 trong thư mục này là ảnh chụp lịch sử.

**Trạng thái tổng thể:** có thể trình diễn và đánh giá bài theo phương án mock được PDF cho phép; chưa đủ bằng chứng để gọi là tích hợp TikTok production hoặc xác nhận gói GitHub đã nộp xong.
