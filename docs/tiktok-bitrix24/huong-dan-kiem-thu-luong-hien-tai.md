# Hướng dẫn kiểm thử luồng TikTok → Bitrix24 hiện tại

**Cập nhật:** 2026-10-11. Chạy các lệnh tại thư mục gốc /home/phuth/Desktop/aasc.

Ứng dụng hiện nhận webhook TikTok có chữ ký mock, lưu event vào PostgreSQL, đưa việc xử lý qua BullMQ/Redis, tạo hoặc cập nhật Lead trên Bitrix24 mock, tự tạo Deal theo rule, nhận callback Deal won, rồi cung cấp analytics và export. [Script demo](../../src/apps/tiktok/cli/demo-flow.ts) kiểm tra trọn luồng này qua HTTP. TikTok Business thật chưa được bật; [demo CLI](../../src/apps/tiktok/cli/demo-environment.ts) chỉ chạy khi cả TikTok và Bitrix24 ở mock mode.

## 1. Chạy thử toàn bộ luồng bằng Docker

Cần Docker Compose; để chạy các lệnh pnpm riêng cần Node 24.9+ và pnpm 11. File [env mẫu](../../.env.example) đã đặt COMPOSE_PROFILES=app,mock,demo, TIKTOK_MODE=mock và BITRIX_INTEGRATION_MODE=mock. Nếu đã có .env, kiểm tra ba giá trị này trước khi chạy; không ghi đè file cấu hình đang dùng cho portal thật.

```bash
test -f .env || cp .env.example .env
export COMPOSE_PROFILES=app,mock,demo
export TIKTOK_COMPOSE_PROJECT=aasc-tiktok-guide
export TIKTOK_APP_PORT=3101
docker compose -f docker-compose.tiktok.yml up -d --build --wait
docker compose -f docker-compose.tiktok.yml ps
docker compose -f docker-compose.tiktok.yml run --rm demo
```

Tên Compose project và cổng 3101 ở trên tách buổi thử này khỏi stack mặc định. Bên trong container API vẫn nghe cổng 3001. Lệnh up chạy PostgreSQL, Redis, mock providers, migration, seed, API và worker theo [Compose](../../docker-compose.tiktok.yml). Lệnh demo thường mất khoảng nửa phút do giới hạn gọi Bitrix24 một lần mỗi giây.

Kết quả mong đợi có các dòng sau; ID, số byte và tổng số bản ghi có thể khác giữa các lần chạy:

```text
health: ok
webhook: accepted demo-...
lead: ... → Bitrix lead ...
deal: ... → Bitrix deal ...
deal: won for 1500000.0000 VND
analytics: ... lead(s), ... won, lead→won ...%
exports: csv ... bytes, json ... row(s), xlsx ... bytes
```

Demo thực sự gửi webhook có chữ ký, đợi Lead ở trạng thái synced, đợi rule tạo Deal, cập nhật Deal thành C1:WON trên mock Bitrix24, gửi callback về API, rồi đọc analytics và tải CSV/JSON/XLSX. [Mã luồng](../../src/apps/tiktok/cli/demo-flow.ts#L92) và biên bản cục bộ `docs/tiktok-bitrix24/deployment-evidence.md` mô tả các bước. Chạy lại demo sẽ tạo thêm một Lead với email riêng, nên không nên đòi tổng Lead luôn bằng 1.

Kiểm tra sức khỏe sau khi chạy:

```bash
curl -fsS http://127.0.0.1:3101/health/live
curl -fsS http://127.0.0.1:3101/health/ready
```

live trả status ok; ready trả status ok khi database, schema, Redis và nhịp worker đều sẵn sàng. OpenAPI UI ở http://127.0.0.1:3101/docs.

## 2. Xem dữ liệu qua API

Tài khoản demo là demo-admin, demo-operator và demo-analyst; mật khẩu mặc định chỉ dành cho local là demo-password-change-me. Dùng admin để xem cả operation và notification. Các lệnh sau dùng Python 3 để đọc JSON trả về từ login:

```bash
export TIKTOK_GUIDE_BASE_URL=http://127.0.0.1:3101
TIKTOK_GUIDE_TOKEN=$(curl -fsS -X POST "$TIKTOK_GUIDE_BASE_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"demo-admin","password":"demo-password-change-me"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["accessToken"])')

curl -fsS "$TIKTOK_GUIDE_BASE_URL/api/v1/leads?limit=100&campaign_id=campaign-spring-2024" \
  -H "Authorization: Bearer $TIKTOK_GUIDE_TOKEN" | python3 -m json.tool
curl -fsS "$TIKTOK_GUIDE_BASE_URL/api/v1/deals?limit=100" \
  -H "Authorization: Bearer $TIKTOK_GUIDE_TOKEN" | python3 -m json.tool
curl -fsS "$TIKTOK_GUIDE_BASE_URL/api/v1/analytics/conversion-rates?campaign_id=campaign-spring-2024" \
  -H "Authorization: Bearer $TIKTOK_GUIDE_TOKEN" | python3 -m json.tool
curl -fsS "$TIKTOK_GUIDE_BASE_URL/api/v1/notifications" \
  -H "Authorization: Bearer $TIKTOK_GUIDE_TOKEN" | python3 -m json.tool
curl -fsS "$TIKTOK_GUIDE_BASE_URL/api/v1/operations?status=dead_letter" \
  -H "Authorization: Bearer $TIKTOK_GUIDE_TOKEN" | python3 -m json.tool
```

Trong danh sách Lead, tìm bản ghi demo có syncStatus=synced và bitrixLeadId. Deal tương ứng có leadId bằng ID Lead, conversionStatus=completed, stageSemantics=won và bitrixDealId. Danh sách dead_letter thường rỗng trong một lần demo thành công.

Hiệu quả chiến dịch tính theo **ngày trọn vẹn** của Asia/Ho_Chi_Minh. Muốn thấy Lead vừa tạo hôm nay, truyền khoảng [hôm nay, ngày mai):

```bash
TIKTOK_GUIDE_TODAY=$(TZ=Asia/Ho_Chi_Minh date +%F)
TIKTOK_GUIDE_TOMORROW=$(TZ=Asia/Ho_Chi_Minh date -d tomorrow +%F)
curl -fsS "$TIKTOK_GUIDE_BASE_URL/api/v1/analytics/campaign-performance?campaign_id=campaign-spring-2024&from=$TIKTOK_GUIDE_TODAY&to=$TIKTOK_GUIDE_TOMORROW" \
  -H "Authorization: Bearer $TIKTOK_GUIDE_TOKEN" | python3 -m json.tool
```

Seed tạo chi phí cho **30 ngày đã kết thúc**, không tạo chi phí cho hôm nay. Vì thế CPL/ROI của khoảng hôm nay có thể là null; đó là dấu hiệu thiếu dữ liệu chi phí, không phải lỗi phép tính. [CSV chi phí mẫu](../../samples/tiktok/campaign-costs.csv) lại có ngày tháng 07/2026, nên cũng không bổ sung chi phí cho Lead demo của hôm nay.

Tải và kiểm tra ba định dạng export:

```bash
TIKTOK_GUIDE_REPORT_DIR=$(mktemp -d)
curl -fSL "$TIKTOK_GUIDE_BASE_URL/api/v1/reports/export?format=csv" \
  -H "Authorization: Bearer $TIKTOK_GUIDE_TOKEN" -o "$TIKTOK_GUIDE_REPORT_DIR/leads.csv"
curl -fSL "$TIKTOK_GUIDE_BASE_URL/api/v1/reports/export?format=json" \
  -H "Authorization: Bearer $TIKTOK_GUIDE_TOKEN" -o "$TIKTOK_GUIDE_REPORT_DIR/leads.json"
curl -fSL "$TIKTOK_GUIDE_BASE_URL/api/v1/reports/export?format=xlsx" \
  -H "Authorization: Bearer $TIKTOK_GUIDE_TOKEN" -o "$TIKTOK_GUIDE_REPORT_DIR/leads.xlsx"
ls -lh "$TIKTOK_GUIDE_REPORT_DIR"
python3 -m json.tool "$TIKTOK_GUIDE_REPORT_DIR/leads.json"
```

## 3. Gửi thêm webhook và kiểm tra lỗi xác thực

Để tạo một Lead mới bằng chữ ký hợp lệ ngay trong mạng Compose, chạy CLI gửi webhook trong container demo. CLI tự tạo event ID, email và số điện thoại riêng:

```bash
docker compose -f docker-compose.tiktok.yml run --rm \
  --entrypoint node demo dist-tiktok/apps/tiktok/cli/send-webhook.js
```

Kỳ vọng HTTP 200 và receipt có received=true. Sau đó xem lại Lead/Deal ở mục 2; worker xử lý bất đồng bộ nên dữ liệu có thể xuất hiện sau vài giây.

Lệnh đầy đủ để gửi payload trong đề:

```bash
docker compose -f docker-compose.tiktok.yml run --rm \
  -e TIKTOK_DEMO_SAMPLE=samples/tiktok/lead-generate.json \
  --entrypoint node demo dist-tiktok/apps/tiktok/cli/send-webhook.js
```

CLI thay advertiser_id, event_id và timestamp của file mẫu cho đúng deployment hiện tại. Email/phone trong file mẫu giữ nguyên, nên gửi lại mẫu có thể nhập vào Lead cũ theo cơ chế dedup. Để thử trường hợp chữ ký sai, gọi trực tiếp endpoint:

```bash
curl -i -X POST "$TIKTOK_GUIDE_BASE_URL/webhooks/tiktok/leads" \
  -H 'Content-Type: application/json' \
  -H 'TikTok-Signature: invalid' \
  --data-binary @samples/tiktok/lead-generate.json
```

Kỳ vọng HTTP 401. Gọi GET /api/v1/leads không có bearer token cũng phải bị từ chối. Các kiểm thử dedup, form.complete, user.interaction, retry và khôi phục worker đã có trong [bộ E2E/integration](../../test/tiktok); các [file event mẫu](../../samples/tiktok) dùng provider_lead_id cố định và cần ghép đúng với Lead nguồn nếu thử thủ công.

## 4. Chạy bộ test tự động trên hạ tầng riêng

Unit test không cần PostgreSQL/Redis:

```bash
pnpm build:tiktok
pnpm lint
pnpm typecheck
pnpm format:check
pnpm test:tiktok:unit --runInBand
```

Config unit hiện quét toàn bộ src, bao gồm cả app AASC cũ. Để chạy integration/E2E hoặc coverage tổng hợp, tạo một Compose project test riêng. Hai cổng được Docker cấp ngẫu nhiên; harness chỉ nhận database tên tiktok_test trên loopback, tự tạo schema PostgreSQL và prefix Redis riêng cho mỗi lần chạy.

```bash
export COMPOSE_PROFILES=test
export TIKTOK_GUIDE_TEST_PROJECT=aasc-tiktok-guide-tests
docker compose -p "$TIKTOK_GUIDE_TEST_PROJECT" -f docker-compose.tiktok.yml \
  up -d --wait test-postgres test-redis

TIKTOK_GUIDE_PG_PORT=$(docker compose -p "$TIKTOK_GUIDE_TEST_PROJECT" \
  -f docker-compose.tiktok.yml port test-postgres 5432 | awk -F: '{print $NF}')
TIKTOK_GUIDE_REDIS_PORT=$(docker compose -p "$TIKTOK_GUIDE_TEST_PROJECT" \
  -f docker-compose.tiktok.yml port test-redis 6379 | awk -F: '{print $NF}')
export TIKTOK_TEST_DATABASE_URL="postgres://tiktok_test:tiktok_test_only@127.0.0.1:$TIKTOK_GUIDE_PG_PORT/tiktok_test"
export TIKTOK_TEST_REDIS_URL="redis://127.0.0.1:$TIKTOK_GUIDE_REDIS_PORT"

pnpm test:tiktok:cov
```

Lệnh cuối chạy unit + integration + E2E cùng một báo cáo coverage và yêu cầu **≥85%** cho statements, branches, functions và lines theo [Jest config](../../test/tiktok/jest-coverage.config.mjs). Muốn khoanh vùng lỗi có thể chạy riêng pnpm test:tiktok:integration --runInBand hoặc pnpm test:tiktok:e2e --runInBand với hai biến TIKTOK_TEST_* vẫn được export. Kết quả đối chiếu gần nhất ngày 2026-10-11 là 224 suite/1.926 test đạt; số này có thể đổi khi mã thay đổi.

Chỉ dừng Compose project test do bạn vừa tạo:

```bash
docker compose -p "$TIKTOK_GUIDE_TEST_PROJECT" -f docker-compose.tiktok.yml down
```

Nếu muốn dừng **stack demo riêng ở mục 1**, trong shell có TIKTOK_COMPOSE_PROJECT=aasc-tiktok-guide:

```bash
export COMPOSE_PROFILES=app,mock,demo
docker compose -f docker-compose.tiktok.yml down
```

Không thêm -v nếu muốn giữ dữ liệu demo cho lần xem tiếp.

## 5. Khi kết quả không như mong đợi

| Triệu chứng | Nơi kiểm tra |
| --- | --- |
| ready trả 503 | Xem trường database, schema, redis, worker trong response; xem docker compose logs --tail=100 api worker. |
| Webhook trả 401 | Chữ ký phải khớp raw body và timestamp trong 5 phút; dùng CLI ở mục 3 để tạo chữ ký hợp lệ. |
| Webhook trả 200 nhưng chưa thấy Lead | Worker xử lý bất đồng bộ. Xem logs của worker và GET /api/v1/operations?status=quarantined hoặc retry_wait. |
| Lead có nhưng chưa có Deal | Đợi Lead synced; rule demo chỉ khớp campaign name chứa sale. Xem operation và rule hiện tại qua GET /api/v1/config/rules bằng token admin. |
| Export trả 422 | Đồng bộ tối đa 10.000 Lead; dùng POST /api/v1/reports/exports cho dữ liệu lớn rồi GET /api/v1/reports/jobs/:id/download. |
| 429 | Theo Retry-After trong response; đừng tăng tốc độ gọi khi đang xác minh luồng. |

Tài liệu này mô tả **chế độ mock hiện tại**. Với Bitrix24 thật, dùng database/Compose project riêng, cấu hình field và pipeline của portal; lệnh demo chỉ cho mock nên không dùng để xác minh portal thật. Xem [README-tiktok.md](../../README-tiktok.md) cho các bước cấu hình real mode.
