# Hướng dẫn chạy tích hợp TikTok – Bitrix24

Ứng dụng này nhận webhook lead có chữ ký từ TikTok, tạo/cập nhật Lead và Deal trên Bitrix24, rồi
cung cấp số liệu phân tích, báo cáo và công cụ vận hành. Nó chạy **tách biệt** với ứng dụng AASC
cũ: cổng **3001**, cơ sở dữ liệu PostgreSQL và Redis riêng, mã build nằm trong `dist-tiktok/`.

Tài liệu tiếng Anh đầy đủ hơn: [`README-tiktok.md`](../README-tiktok.md).

## 1. Chạy demo bằng Docker (khuyến nghị)

Cần Docker và Docker Compose.

```bash
cp .env.tiktok.example .env.tiktok
docker compose --env-file .env.tiktok -f docker-compose.tiktok.yml up -d --build --wait
docker compose --env-file .env.tiktok -f docker-compose.tiktok.yml run --rm demo
```

Lệnh `up` lần lượt: khởi động PostgreSQL, Redis và máy chủ giả lập (mock) TikTok/Bitrix24 → chạy
migration → nạp dữ liệu demo → khởi động API và worker. Lệnh `demo` gửi một webhook có chữ ký và
theo dõi đến khi có kết quả; mất khoảng nửa phút vì lời gọi tới Bitrix24 bị giới hạn 1 lần/giây.

Kết quả mong đợi của lệnh `demo`:

```text
health: ok
webhook: accepted demo-…
lead: … → Bitrix lead 1
deal: … → Bitrix deal 1
deal: won for 1500000.0000 VND
analytics: 1 lead(s), 1 won, lead→won 100%
exports: csv … bytes, json 1 row(s), xlsx … bytes
```

Địa chỉ dùng thử:

| Mục | Địa chỉ |
| --- | --- |
| API | <http://127.0.0.1:3001> |
| Tài liệu OpenAPI | <http://127.0.0.1:3001/docs> |
| Kiểm tra sức khoẻ | <http://127.0.0.1:3001/health> |

Tài khoản demo (mật khẩu chung `demo-password-change-me`):

| Tài khoản | Vai trò | Dùng để |
| --- | --- | --- |
| `demo-admin` | `integration_admin` | Mọi chức năng, sửa cấu hình, xử lý xung đột |
| `demo-operator` | `integration_operator` | Xem lead/deal, chuyển đổi, import, thử lại thao tác |
| `demo-analyst` | `integration_analyst` | Xem số liệu, xuất báo cáo |

Dừng: `docker compose --env-file .env.tiktok -f docker-compose.tiktok.yml down` (thêm `-v` để xoá
luôn dữ liệu demo).

> Nếu cổng 3001 đã bị dùng, đặt `TIKTOK_APP_PORT=3101` trước lệnh `up` để đổi cổng trên máy.

## 2. Thử từng bước bằng curl

```bash
BASE=http://127.0.0.1:3001

# Đăng nhập, lấy token
TOKEN=$(curl -s $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"demo-analyst","password":"demo-password-change-me"}' | sed 's/.*"accessToken":"\([^"]*\)".*/\1/')

# Danh sách lead và deal
curl -s $BASE/api/v1/leads -H "Authorization: Bearer $TOKEN"
curl -s $BASE/api/v1/deals -H "Authorization: Bearer $TOKEN"

# Tỉ lệ chuyển đổi 30 ngày gần nhất
curl -s "$BASE/api/v1/analytics/conversion-rates" -H "Authorization: Bearer $TOKEN"

# Hiệu quả chiến dịch (chi phí, CPL, ROI, ROAS) theo ngày trọn vẹn
curl -s "$BASE/api/v1/analytics/campaign-performance" -H "Authorization: Bearer $TOKEN"

# Xuất báo cáo
curl -s "$BASE/api/v1/reports/export?format=csv"  -H "Authorization: Bearer $TOKEN" -o leads.csv
curl -s "$BASE/api/v1/reports/export?format=xlsx" -H "Authorization: Bearer $TOKEN" -o leads.xlsx
curl -s "$BASE/api/v1/reports/export?format=json" -H "Authorization: Bearer $TOKEN"
```

Gửi thêm một webhook có chữ ký (ngoài Docker, sau khi `pnpm build:tiktok` và nạp `.env.tiktok`):

```bash
pnpm tiktok:webhook
TIKTOK_DEMO_SAMPLE=samples/tiktok/lead-generate.json pnpm tiktok:webhook
```

## 3. Import dữ liệu

- **Lead lịch sử** (CSV hoặc JSON, tối đa 10 MiB) – mặc định chỉ chạy thử (`dryRun=true`), không
  áp dụng rule và không gửi phản hồi chuyển đổi:

  ```bash
  OP=$(curl -s $BASE/auth/login -H 'Content-Type: application/json' \
    -d '{"username":"demo-operator","password":"demo-password-change-me"}' | sed 's/.*"accessToken":"\([^"]*\)".*/\1/')
  curl -s $BASE/api/v1/leads/imports -H "Authorization: Bearer $OP" \
    -F file=@samples/tiktok/historical-leads.csv -F dryRun=false
  ```

  Mỗi dòng cần `advertiser_id`, `source_record_id` (mã ổn định, không dùng số thứ tự dòng),
  `occurred_at` (có múi giờ) và `full_name` kèm email hoặc số điện thoại. Import lại cùng nội dung
  là vô hại; cùng mã nhưng nội dung khác sẽ bị báo lỗi, không ghi đè.

- **Chi phí chiến dịch theo ngày** (CSV): `advertiser_id,campaign_id,date,currency,spend`.
  Số tiền tối đa 4 chữ số thập phân; ngày không có dòng nào được coi là **thiếu dữ liệu**, không
  phải bằng 0, nên CPL/ROI/ROAS của kỳ đó sẽ là `null`.

  ```bash
  curl -s $BASE/api/v1/analytics/campaign-costs/imports -H "Authorization: Bearer $OP" \
    -F file=@samples/tiktok/campaign-costs.csv
  ```

Cả hai trả về mã job (HTTP 202). Xem tiến độ và lỗi từng dòng tại
`GET /api/v1/reports/jobs/<id>`.

## 4. Cấu hình

Toàn bộ biến môi trường có chú thích trong [`.env.tiktok.example`](../.env.tiktok.example). Lưu ý:

- **Danh tính triển khai**: `TIKTOK_ADVERTISER_ID`, `BITRIX_PORTAL_KEY`, `TIKTOK_MODE`,
  `BITRIX_INTEGRATION_MODE` được ghi lại ở lần chạy đầu. Nếu đổi một trong bốn giá trị này trên
  cùng cơ sở dữ liệu, API và worker sẽ **từ chối khởi động**. Dữ liệu mock và dữ liệu thật phải
  nằm ở hai cơ sở dữ liệu khác nhau.
- **Bí mật**: thay toàn bộ giá trị `change-me-…` trước khi dùng chung. `TIKTOK_JWT_SECRET` tối
  thiểu 32 ký tự.
- **Mapping trường và rule** là cấu hình có phiên bản, sửa qua API (quyền admin):
  `GET/PUT /configuration/mapping`, `GET/PUT /configuration/rules`, kèm header `If-Match` là
  phiên bản hiện tại. Mẫu: `samples/tiktok/mapping.json`, `samples/tiktok/rules.json`.

Tạo tài khoản thật (mật khẩu được hỏi trên màn hình, không truyền qua tham số):

```bash
pnpm tiktok:user:create nguyen.van.a integration_operator
```

## 5. Vận hành

| Tình huống | Cách xử lý |
| --- | --- |
| Thao tác bị kẹt hoặc lỗi | `GET /api/v1/operations?status=dead_letter` (hoặc `retry_wait`, `reconcile_required`, `quarantined`); thử lại bằng `POST /api/v1/operations/<id>/retry` |
| `reconcile_required` | Lời gọi tạo bản ghi có thể đã tới Bitrix24. Worker tự dò lại theo mã đánh dấu, không tạo trùng; admin chốt bằng `POST /api/v1/operations/<id>/resolve` |
| Redis ngừng | Webhook vẫn được nhận và lưu vào PostgreSQL, xử lý tiếp khi Redis hoạt động lại; đăng nhập và API quản trị trả 503 |
| Token Bitrix24 hết hạn/bị thu hồi | Có cảnh báo `upstream_auth`; cài đặt/ủy quyền lại ứng dụng rồi thử lại các thao tác |
| Cảnh báo | Xem `GET /api/v1/notifications` và log vận hành (dead letter, tồn đọng quá 5 phút, lỗi xác thực, tỉ lệ lỗi > 5 %) |

**Sao lưu**: PostgreSQL là nguồn dữ liệu duy nhất cần sao lưu.

```bash
docker compose --env-file .env.tiktok -f docker-compose.tiktok.yml exec -T postgres \
  pg_dump -U tiktok -d tiktok --format=custom > tiktok-$(date +%F).dump
```

Khôi phục vào cơ sở dữ liệu trống khi API và worker đã dừng, sau đó khởi động worker trước.

**Lưu giữ dữ liệu** (tự chạy hằng ngày): nội dung thô của webhook xoá sau 30 ngày (vẫn giữ mã và
hash để chống trùng); file xuất hết hạn sau 24 giờ; file import đã xử lý xoá sau 30 ngày; nhật ký
kiểm toán, thông báo đã gửi và thao tác đã hoàn tất xoá sau 180 ngày. Việc đang chờ, đang lỗi hoặc
đang cần đối soát **không bao giờ** bị xoá.

## 6. Giới hạn hiện tại

- Chỉ chế độ **mock** của TikTok được bật. API TikTok Business thật (lấy lead, báo cáo chi phí,
  gửi sự kiện chuyển đổi) chưa kích hoạt vì cần tài khoản được ủy quyền và hợp đồng API đã xác
  minh. Trong lúc đó chi phí chiến dịch lấy từ file CSV.
- Chế độ Bitrix24 **thật** dùng chung gateway với mock nhưng chưa được chạy trên portal thật tại
  đây; cần kiểm tra tên trường, bộ lọc `updatedTime` và ngữ nghĩa stage trên portal của bạn.
- Kênh thông báo qua Bitrix24 chưa có adapter; thông báo hiện có trong ứng dụng và trong log.
- Tài khoản demo và máy chủ mock chỉ dùng cục bộ. Lệnh seed từ chối chạy khi
  `NODE_ENV=production` hoặc khi không ở chế độ mock; không mở cổng 3002 ra ngoài.
