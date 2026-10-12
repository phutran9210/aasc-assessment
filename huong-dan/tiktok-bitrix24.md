# Hướng dẫn chạy tích hợp TikTok – Bitrix24

Các bước chạy và thử ứng dụng. Kiến trúc, cấu hình đầy đủ và xử lý sự cố nằm trong
[`README-tiktok.md`](../README-tiktok.md).

Ứng dụng chạy tách biệt với ứng dụng AASC: cổng **3001**, PostgreSQL và Redis riêng.

## 1. Chạy demo bằng Docker

Cần Docker và Docker Compose.

```bash
cp .env.example .env
docker compose -f docker-compose.tiktok.yml up -d --build --wait
docker compose -f docker-compose.tiktok.yml run --rm demo
```

`up` khởi động PostgreSQL, Redis và mock TikTok/Bitrix24, chạy migration, nạp dữ liệu demo, rồi
khởi động API và worker. `demo` gửi một webhook có chữ ký và chờ kết quả, khoảng 30 giây.

Kết quả của `demo`:

```text
health: ok
mapping: stored the field mapping of the assignment
webhook: accepted demo-…
lead: … → Bitrix lead 1
deal: … → Bitrix deal 1
deal: won for 1500000.0000 VND
analytics: 1 lead(s), 1 won, lead→won 100%
exports: csv … bytes, json 1 row(s), xlsx … bytes
```

| Mục | Địa chỉ |
| --- | --- |
| API | <http://127.0.0.1:3001> |
| OpenAPI | <http://127.0.0.1:3001/docs> |
| Health | <http://127.0.0.1:3001/health> |

Tài khoản demo, mật khẩu chung `demo-password-change-me`:

| Tài khoản | Vai trò | Dùng để |
| --- | --- | --- |
| `demo-admin` | `integration_admin` | Mọi chức năng, sửa cấu hình, xử lý xung đột |
| `demo-operator` | `integration_operator` | Lead, deal, chuyển đổi, import, thử lại operation |
| `demo-analyst` | `integration_analyst` | Xem số liệu, xuất báo cáo |

Dừng: `docker compose -f docker-compose.tiktok.yml down`; thêm `-v` để xoá dữ liệu demo.

Cổng 3001 đang bận thì đặt `TIKTOK_APP_PORT=3101` trong `.env` trước khi chạy `up`.

Trước khi chạy demo, `.env` phải ở chế độ mock: `BITRIX_INTEGRATION_MODE=mock` và
`TIKTOK_BITRIX24_WEBHOOK_URL=http://mock:3002/rest/1/mock/`. Nếu biến thứ hai trỏ portal thật, demo
sẽ ghi dữ liệu lên portal đó.

## 2. Thử bằng curl

```bash
BASE=http://127.0.0.1:3001

TOKEN=$(curl -s $BASE/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"demo-analyst","password":"demo-password-change-me"}' | sed 's/.*"accessToken":"\([^"]*\)".*/\1/')

curl -s $BASE/api/v1/leads -H "Authorization: Bearer $TOKEN"
curl -s $BASE/api/v1/deals -H "Authorization: Bearer $TOKEN"

curl -s "$BASE/api/v1/analytics/conversion-rates" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/api/v1/analytics/campaign-performance" -H "Authorization: Bearer $TOKEN"

curl -s "$BASE/api/v1/reports/export?format=csv"  -H "Authorization: Bearer $TOKEN" -o leads.csv
curl -s "$BASE/api/v1/reports/export?format=xlsx" -H "Authorization: Bearer $TOKEN" -o leads.xlsx
curl -s "$BASE/api/v1/reports/export?format=json" -H "Authorization: Bearer $TOKEN"
```

`campaign-performance` mặc định lấy 30 ngày trọn gần nhất, không tính hôm nay. Lead vừa tạo chỉ
hiện khi truyền `from` và `to` chứa hôm nay, ví dụ `?from=2026-10-12&to=2026-10-13`.

Gửi thêm một webhook có chữ ký, chạy ngoài Docker sau khi nạp `.env` vào shell:

```bash
pnpm tiktok:webhook
TIKTOK_DEMO_SAMPLE=samples/tiktok/lead-generate.json pnpm tiktok:webhook
```

Chữ ký có dạng `t=<unix>,s=<hex HMAC-SHA256 của "<t>.<raw body>">` trong header
`TikTok-Signature`, khoá là `TIKTOK_WEBHOOK_SECRET`.

## 3. Import dữ liệu

**Lead lịch sử** (CSV hoặc JSON, tối đa 10 MiB). Mặc định chỉ chạy thử (`dryRun=true`), không áp
rule và không gửi conversion feedback.

```bash
OP=$(curl -s $BASE/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"demo-operator","password":"demo-password-change-me"}' | sed 's/.*"accessToken":"\([^"]*\)".*/\1/')
curl -s $BASE/api/v1/leads/imports -H "Authorization: Bearer $OP" \
  -F file=@samples/tiktok/historical-leads.csv -F dryRun=false
```

Mỗi dòng cần `advertiser_id`, `source_record_id` (mã ổn định, không phải số thứ tự dòng),
`occurred_at` có múi giờ, và `full_name` kèm email hoặc số điện thoại. Import lại cùng nội dung
không tạo trùng; cùng mã nhưng khác nội dung thì bị báo lỗi, không ghi đè.

**Chi phí campaign theo ngày** (CSV): `advertiser_id,campaign_id,date,currency,spend`. Ngày không
có dòng nào được coi là thiếu dữ liệu, không phải bằng 0, nên CPL, ROI, ROAS của kỳ đó là `null`.

```bash
curl -s $BASE/api/v1/analytics/campaign-costs/imports -H "Authorization: Bearer $OP" \
  -F file=@samples/tiktok/campaign-costs.csv
```

Cả hai trả HTTP 202 kèm mã job. Xem tiến độ và lỗi từng dòng tại `GET /api/v1/reports/jobs/<id>`.

## 4. Cấu hình

Mọi biến được chú thích trong Phần 2 của [`.env.example`](../.env.example). Cả repository dùng một
file `.env`.

- **Định danh triển khai**: `TIKTOK_ADVERTISER_ID`, `BITRIX_PORTAL_KEY`, `TIKTOK_MODE`,
  `BITRIX_INTEGRATION_MODE` được lưu ở lần chạy đầu. Đổi một trong bốn giá trị trên cùng database
  thì API và worker từ chối khởi động. Dữ liệu mock và dữ liệu thật phải ở hai database.
- **Secret**: thay mọi giá trị `change-me-…` trước khi dùng thật. `TIKTOK_JWT_SECRET` từ 32 ký tự.
- **Mapping và rule**: sửa qua `GET/PUT /api/v1/config/mappings` và `/api/v1/config/rules` bằng
  tài khoản admin, kèm header `If-Match` là revision hiện tại (`"0"` cho lần đầu). Mẫu:
  `samples/tiktok/mapping.json`, `samples/tiktok/rules.json`. Tài liệu cấu hình của đề
  (`samples/tiktok/assignment-config.json`) được nhận nguyên văn; `deal_rules` của nó cần một rules
  policy đã lưu trước.

Tạo tài khoản (mật khẩu được hỏi khi chạy):

```bash
pnpm tiktok:user:create nguyen.van.a integration_operator
docker compose -f docker-compose.tiktok.yml run --rm create-user nguyen.van.a integration_admin
```

`COMPOSE_PROFILES` trong `.env` chọn chế độ Docker:

| Chế độ | `COMPOSE_PROFILES` |
| --- | --- |
| Demo (mặc định) | `app,mock,demo` |
| Portal Bitrix24 thật, TikTok vẫn mock | `app,mock` |
| Production | `app` |
| Hạ tầng test | `--profile test` trên dòng lệnh |

Trước khi đổi chế độ, chạy `down -v` hoặc đặt `TIKTOK_COMPOSE_PROJECT` khác.

**Production.** Đặt `COMPOSE_PROFILES=app`, `NODE_ENV=production`, `CORS_ORIGINS`,
`TIKTOK_REDIS_PASSWORD` và thay mọi secret mẫu. Ứng dụng từ chối khởi động nếu còn secret
`change-me` hoặc `CORS_ORIGINS=*`. Không có dữ liệu seed: tạo admin rồi tải mapping và rule lên.

## 5. Chạy với portal Bitrix24 thật

Portal phải thoả các điều kiện sau:

- Có quyền REST API. Xem mục 7.
- Ở chế độ CRM cổ điển (CRM > Cài đặt > Chế độ CRM). Ở chế độ đơn giản, Bitrix24 tự chuyển lead
  thành deal; ứng dụng từ chối lưu cấu hình và giữ lead lại với mã `CRM_SIMPLE_MODE_UNSUPPORTED`.
- Lead có bốn trường chuỗi `UF_CRM_CITY`, `UF_CRM_UTM_CAMPAIGN`, `UF_CRM_AD_NAME`, `UF_CRM_TTCLID`.
- Rule dùng đúng pipeline và stage của portal. Gói Free chỉ có pipeline 0, nên `pipeline_id: 1` của
  đề phải đổi thành 0.

Đặt trong `.env`: `COMPOSE_PROFILES=app,mock`, `BITRIX_INTEGRATION_MODE=real`, `BITRIX_PORTAL_KEY`,
rồi chọn một trong hai cách kết nối.

**Cách 1: incoming webhook.**

1. Trên portal: Tài nguyên cho nhà phát triển > Khác > Webhook vào, quyền `crm` và `user`. Ghi URL
   vào `TIKTOK_BITRIX24_WEBHOOK_URL`.
2. Tạo Webhook ra cho ba sự kiện Deal (`ONCRMDEALADD`, `ONCRMDEALUPDATE`, `ONCRMDEALDELETE`), handler
   là `<địa chỉ công khai của API>/webhooks/bitrix24/deals`. Ghi application token vào
   `TIKTOK_BITRIX24_OUTGOING_TOKEN`.

**Cách 2: ứng dụng OAuth.**

1. Để trống `TIKTOK_BITRIX24_WEBHOOK_URL`. Đặt `TIKTOK_PUBLIC_URL` là địa chỉ công khai của API.
2. Trên portal: tạo Ứng dụng cục bộ loại Máy chủ, hai đường dẫn đều là `<địa chỉ công khai>/install`,
   tick "Chỉ sử dụng API", quyền `crm` và `user`.
3. Ghi `BITRIX24_DOMAIN`, `BITRIX24_CLIENT_ID`, `BITRIX24_CLIENT_SECRET` vào `.env`, khởi động ứng
   dụng, rồi bấm Cài đặt lại trên portal. Ứng dụng lưu token và tự đăng ký ba sự kiện Deal.

Khởi động và tạo admin:

```bash
docker compose -f docker-compose.tiktok.yml up -d --build --wait
docker compose -f docker-compose.tiktok.yml run --rm create-user nguyen.van.a integration_admin
```

Sau đó tải rules policy rồi mapping lên (mục 4) và gửi webhook thử (mục 2).

Bitrix24 phải gọi được tới API. Trên máy cá nhân, dùng một tunnel như ngrok trỏ vào cổng của API.
Khi chạy cùng ứng dụng AASC sau một tunnel, `pnpm dev:proxy` chia đường dẫn cho hai ứng dụng; khi
đó ứng dụng này phải dùng cách 1.

## 6. Vận hành

| Tình huống | Cách xử lý |
| --- | --- |
| Operation bị kẹt hoặc lỗi | `GET /api/v1/operations?status=dead_letter` (hoặc `retry_wait`, `reconcile_required`, `quarantined`); thử lại bằng `POST /api/v1/operations/<id>/retry` |
| `reconcile_required` | Lệnh tạo có thể đã tới Bitrix24. Worker tra lại theo marker, không tạo trùng; admin chốt bằng `POST /api/v1/operations/<id>/resolve` |
| Redis ngừng | Webhook vẫn được lưu vào PostgreSQL và xử lý khi Redis chạy lại; đăng nhập và API quản trị trả 503 |
| Token Bitrix24 bị thu hồi | Cài lại ứng dụng trên portal, rồi thử lại các operation |
| Cảnh báo | `GET /api/v1/notifications` và log |

Sao lưu: PostgreSQL là nguồn dữ liệu duy nhất cần sao lưu.

```bash
docker compose -f docker-compose.tiktok.yml exec -T postgres \
  pg_dump -U tiktok -d tiktok --format=custom > tiktok.dump
```

Khôi phục vào database trống khi API và worker đã dừng, rồi khởi động worker trước.

Lưu giữ dữ liệu: raw body của webhook 30 ngày, file export 24 giờ, file import 30 ngày, audit và
operation đã xong 180 ngày. Việc chưa xong không bị xoá.

## 7. Giới hạn hiện tại

- TikTok chỉ có mock. API TikTok Business thật chưa được nối; chi phí campaign lấy từ file CSV.
- Bitrix24 thật đã chạy ngày 2026-10-12 qua incoming webhook và qua ứng dụng OAuth: webhook thành
  Lead, rule tạo Deal, Bitrix24 gửi sự kiện Deal về, Deal thắng, analytics và export.
- Chưa kiểm trên portal thật: portal nhiều pipeline, tự đăng ký sự kiện sau khi cài OAuth, ghi lại
  xác suất khi Deal đóng, giữ lead ở chế độ CRM đơn giản. Ba mục sau mới có unit test.
- **Portal dùng thử mất quyền REST.** Cả hai portal dùng thử trả HTTP 403
  `FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN` cho mọi lệnh REST, dù trang gói ghi bản dùng thử còn hạn.
  Portal thứ hai chạy được khoảng hai giờ rồi bị chặn sau khoảng 575 lệnh gọi trong ngày. Ngày
  2026-10-08 lỗi này từng tự hết sau khoảng 20 phút, nên nhiều khả năng là khoá tạm theo lượng lệnh
  gọi. Cách xử lý: chờ rồi gọi lại `server.time`; hỏi hỗ trợ Bitrix24; hoặc dùng gói Vibe+. Chi
  tiết ở mục "Tài khoản dùng thử Bitrix24 và quyền REST" của `README-tiktok.md`.
- Thông báo chỉ có trong ứng dụng và trong log.
- Tài khoản demo và mock server chỉ dùng trên máy; không mở cổng 3002 ra ngoài.
