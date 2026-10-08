# Hướng dẫn tích hợp Google Sheets với Bitrix24 (đồng bộ Lead)

Tài liệu này hướng dẫn cài đặt và vận hành tính năng đồng bộ Lead giữa một Google Sheet và Bitrix24 CRM của ứng dụng AASC Assessment. Đọc từ trên xuống là đủ để chạy được lần đồng bộ đầu tiên.

> Trạng thái kiểm chứng: ngày 08/10/2026 toàn bộ luồng đã chạy trên một Google Sheet thật và một portal Bitrix24 thật (chiều đi, chiều về, real-time, Google OAuth, incoming và outgoing webhook). Kết quả ở mục 12. Riêng việc thử lại khi gặp rate limit và timeout mới có test tự động.

## 1. Tính năng làm gì

Team sales nhập khách hàng tiềm năng vào một Google Sheet. Ứng dụng đọc Sheet theo lịch hoặc khi được yêu cầu, tạo hoặc cập nhật Lead trong Bitrix24, rồi ghi kết quả vào chính hàng đó. Khi bật đồng bộ hai chiều, giai đoạn và người phụ trách đổi trong Bitrix24 cũng được ghi ngược về Sheet sau vài giây.

```text
Google Sheet --đọc--> lead-sync (NestJS) --batch: tìm trùng, add/update--> Bitrix24
     ^                     |    ^
     +--ghi kết quả--------+    +--sự kiện "lead thay đổi" (hai chiều)-------+
                           |
                           +--> SQLite: nhật ký lần chạy, khóa "mỗi lúc một lần chạy"
```

- Sheet giữ trạng thái của từng hàng (Lead ID, Sync Hash). SQLite chỉ giữ nhật ký lần chạy.
- Mỗi lần chạy xử lý từng lô 25 hàng: tìm trùng, ghi Bitrix24, ghi lại Sheet.
- Chạy lại bao nhiêu lần cũng không tạo lead trùng.

## 2. Điều kiện cần

| Thứ cần có                               | Ghi chú                                                               |
| ---------------------------------------- | --------------------------------------------------------------------- |
| Node ≥ 24.9, pnpm 11.2.2                 | Hoặc Docker, xem mục 7.5                                              |
| Tài khoản Google Cloud                   | Để tạo service account hoặc OAuth client                              |
| Một Google Sheet                         | Bạn phải có quyền Share hoặc quyền sửa                                |
| Portal Bitrix24 ở chế độ **CRM cổ điển** | Xem mục 4.1; portal mới mặc định ở chế độ CRM đơn giản                |
| File `.env`                              | `cp .env.example .env` nếu chưa có                                    |
| Địa chỉ công khai (ví dụ ngrok)          | Chỉ cần cho cài ứng dụng qua OAuth và cho đồng bộ hai chiều real-time |

## 3. Chuẩn bị phía Google

Có hai cách xác thực, chọn một.

### 3.1. Service account (mặc định)

1. Vào <https://console.cloud.google.com>, tạo một project và bật **Google Sheets API**.
2. Vào **IAM & Admin → Service Accounts → Create service account**. Không cần gán role nào.
3. Mở service account vừa tạo, chọn **Keys → Add key → Create new key → JSON**. Lưu file thành `secrets/google-sa.json`. Nội dung thư mục `secrets/` không được commit.
4. Tạo Google Sheet: **File → Import → Upload** file `samples/leads-template.csv`.
5. Đổi tên **tab** (ở thanh dưới cùng của Sheet) thành `Leads`. File CSV import tạo tab mang tên mặc định như `Untitled`; đổi tên file không đổi tên tab.
6. Bấm **Share**, dán email của service account (trường `client_email` trong file JSON) và chọn quyền **Editor**. Ứng dụng cần quyền Editor vì nó thêm cột và ghi kết quả.
7. Chép chuỗi nằm giữa `/d/` và `/edit` trong URL của Sheet. Đó là `GOOGLE_SHEET_ID`.

Chỉ share đúng Sheet này cho service account, không cấp quyền ở mức Drive.

### 3.2. OAuth 2.0 của một tài khoản Google

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**, loại **Web application**.
2. Để trống **Authorized JavaScript origins**. Ở **Authorized redirect URIs** thêm `http://localhost:3000/google/oauth/callback` (hoặc `https://<địa chỉ công khai>/google/oauth/callback`).
3. Khi ứng dụng OAuth còn ở chế độ thử nghiệm, thêm email sẽ đăng nhập vào **Test users** của OAuth consent screen. Thiếu bước này Google báo `403 access_denied`.
4. Trong `.env` đặt `GOOGLE_AUTH_MODE=oauth`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` và `GOOGLE_OAUTH_REDIRECT_URI`. Redirect URI phải khớp từng ký tự với URI đã đăng ký, kể cả dấu `/` ở cuối.
5. Chạy ứng dụng, đăng nhập, gọi `GET /google/oauth/authorize` kèm JWT. Mở `url` trả về bằng trình duyệt và đồng ý. Đường dẫn có hiệu lực 10 phút và dùng được một lần.
6. Google chuyển về `/google/oauth/callback`; refresh token được lưu vào `GOOGLE_OAUTH_TOKEN_FILE` (mặc định `secrets/google-oauth-token.json`, quyền 600).

Tài khoản đã đồng ý phải có quyền sửa Sheet; không cần Share cho service account.

## 4. Chuẩn bị phía Bitrix24

### 4.1. Bật CRM cổ điển

Ở chế độ CRM đơn giản, Bitrix24 vẫn nhận lead mới nhưng tự chuyển ngay thành Deal và Contact, làm mất giai đoạn lấy từ Sheet. Ứng dụng kiểm tra chế độ này trước mỗi lần chạy và dừng lại nếu portal không dùng Lead.

Vào **CRM → Cài đặt → Chế độ CRM**, chọn **CRM cổ điển**. Dấu hiệu đã đổi xong: menu CRM có mục **Leads**.

### 4.2. Cách ứng dụng gọi Bitrix24

Có hai cách, chọn một.

**Incoming webhook.** Vào **Ứng dụng → Tài nguyên cho nhà phát triển → Khác → Webhook vào**. Ở mục quyền truy cập chọn `crm`, bấm **Create**, rồi chép URL trong ô "Webhook để gọi REST API" vào `BITRIX24_WEBHOOK_URL`. URL có dạng `https://<portal>/rest/<user id>/<mã webhook>/` và bản thân nó là secret.

Khi `BITRIX24_WEBHOOK_URL` có giá trị, mọi lời gọi Bitrix24 của ứng dụng dùng webhook, kể cả API Contact (`/contacts`).

**OAuth (cài ứng dụng).** Để trống `BITRIX24_WEBHOOK_URL` và cài ứng dụng qua `/install` như hướng dẫn ở mục 13 của `Readme.txt`. Cả "Your handler path" và "Initial installation path" là `https://<địa chỉ công khai>/install`, quyền `crm`.

Muốn chuyển ứng dụng sang một portal khác: đổi `BITRIX24_DOMAIN`, `BITRIX24_CLIENT_ID`, `BITRIX24_CLIENT_SECRET` trong `.env` rồi cài lại. Lượt cài từ portal trùng `BITRIX24_DOMAIN` được phép thay bản ghi cài đặt cũ; portal khác bị từ chối với mã 409.

## 5. Cấu hình `.env`

Cấu hình tối thiểu (service account và incoming webhook):

```dotenv
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=secrets/google-sa.json
GOOGLE_SHEET_ID=<id của Sheet>
GOOGLE_SHEET_NAME=Leads
BITRIX24_WEBHOOK_URL=https://<portal>.bitrix24.com/rest/<user id>/<mã>/
```

Toàn bộ biến liên quan:

| Biến                                                   | Mặc định                          | Ý nghĩa                                                         |
| ------------------------------------------------------ | --------------------------------- | --------------------------------------------------------------- |
| `GOOGLE_AUTH_MODE`                                     | `service_account`                 | `service_account` hoặc `oauth`                                  |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`                      | trống                             | Đường dẫn file khóa JSON                                        |
| `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64`                    | trống                             | Nội dung file khóa mã hóa base64; được ưu tiên hơn file         |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | trống                             | OAuth client, khi dùng chế độ `oauth`                           |
| `GOOGLE_OAUTH_REDIRECT_URI`                            | trống                             | Phải khớp URI đã đăng ký với Google                             |
| `GOOGLE_OAUTH_TOKEN_FILE`                              | `secrets/google-oauth-token.json` | Nơi lưu refresh token sau khi cấp quyền                         |
| `GOOGLE_SHEET_ID`                                      | trống                             | Chuỗi giữa `/d/` và `/edit`                                     |
| `GOOGLE_SHEET_NAME`                                    | `Leads`                           | Tên tab                                                         |
| `BITRIX24_WEBHOOK_URL`                                 | trống                             | Có giá trị thì dùng incoming webhook thay OAuth                 |
| `BITRIX24_OUTGOING_TOKEN`                              | trống                             | Token của outgoing webhook tạo tay, xem mục 8.2                 |
| `APP_PUBLIC_URL`                                       | trống                             | Địa chỉ công khai của ứng dụng; cần cho real-time               |
| `LEAD_SYNC_DIRECTION`                                  | `sheet-to-bitrix`                 | `two-way` bật thêm chiều Bitrix24 về Sheet                      |
| `LEAD_SYNC_MAPPING_PATH`                               | `config/mapping.json`             | File mapping                                                    |
| `LEAD_SYNC_CRON`                                       | trống                             | Biểu thức cron, ví dụ `*/15 * * * *`; trống là tắt lịch         |
| `LEAD_SYNC_TIMEZONE`                                   | `Asia/Ho_Chi_Minh`                | Múi giờ của lịch và của cột thời gian                           |
| `LEAD_SYNC_DEFAULT_COUNTRY`                            | `VN`                              | Quốc gia mặc định khi chuẩn hóa số điện thoại: `VN`, `US`, `SG` |
| `LEAD_SYNC_MAX_RETRIES`                                | `4`                               | Số lần thử lại một lần gọi API (0 đến 10)                       |
| `LEAD_SYNC_LOG_RETENTION_DAYS`                         | `30`                              | Số ngày giữ nhật ký lần chạy                                    |

Khi không mount được file khóa (ví dụ trên một số nền tảng container), dùng biến base64:

```bash
base64 -w0 secrets/google-sa.json
```

Mọi biến đều tùy chọn. Chưa cấu hình đủ thì ứng dụng vẫn khởi động; `POST /lead-sync/runs` trả `503` và `GET /lead-sync/status` nêu thứ còn thiếu. Giá trị sai định dạng (cron không hợp lệ, URL webhook không phải HTTPS, base64 không giải mã được) làm ứng dụng dừng ngay khi khởi động và nêu tên biến.

Sau khi sửa `.env` phải khởi động lại ứng dụng; chế độ watch chỉ theo dõi mã nguồn.

## 6. Cấu trúc Sheet và mapping

### 6.1. Các cột

Chín cột do người dùng nhập: `Tên khách hàng`, `Email`, `Số điện thoại`, `Công ty`, `Nguồn lead (UTM Source)`, `Ngân sách dự kiến`, `Trạng thái`, `Người phụ trách`, `Ghi chú`.

Năm cột do ứng dụng tự thêm vào cuối hàng tiêu đề ở lần chạy đầu:

| Cột                      | Nội dung                                                              |
| ------------------------ | --------------------------------------------------------------------- |
| `Trạng thái đồng bộ`     | `Chờ xử lý`, `Đã đồng bộ` hoặc `Lỗi`. Ô trống được coi là `Chờ xử lý` |
| `Lead ID Bitrix24`       | Cột ẩn                                                                |
| `Thời gian đồng bộ cuối` | `yyyy-MM-dd HH:mm:ss` theo `LEAD_SYNC_TIMEZONE`                       |
| `Thông báo lỗi`          | Nêu cột sai và cách sửa; được xóa khi hàng đồng bộ thành công         |
| `Sync Hash`              | Cột ẩn                                                                |

Quy tắc khi dùng Sheet:

- Cột được tìm theo **tên tiêu đề**, nên có thể đổi thứ tự cột. Không đổi tên tiêu đề.
- Không sửa hai cột ẩn.
- Mỗi hàng cần `Tên khách hàng` và ít nhất một trong hai `Email`, `Số điện thoại`.
- Muốn ép đồng bộ lại một hàng: đặt `Trạng thái đồng bộ` thành `Chờ xử lý`.

### 6.2. `config/mapping.json`

Mỗi phần tử của `fields` nối một cột với một trường lead:

```json
{ "column": "Ngân sách dự kiến", "field": "opportunity", "type": "number" }
```

| Kiểu       | Ví dụ đầu vào                                         | Gửi sang Bitrix24                                                                     |
| ---------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `string`   | `"  Nguyễn  Văn An "`                                 | `"Nguyễn Văn An"`                                                                     |
| `email`    | `"An@Example.com "`                                   | `"an@example.com"`                                                                    |
| `phone`    | `0901 234 567`, `901234567`, `+84 901234567`          | `"+84901234567"`                                                                      |
| `number`   | `1500000`, `1.500.000 ₫`, `15tr`                      | `1500000`, `1500000`, `15000000`                                                      |
| `date`     | `08/10/2026`, `2026-10-08`, ô định dạng ngày          | `"2026-10-08"` (ngày trước tháng sau; bỏ phần giờ)                                    |
| `datetime` | `08/10/2026 14:30`, `2026-10-08T14:30:00`, ô ngày giờ | `"2026-10-08T14:30:00+07:00"`; ô không ghi múi giờ thì tính theo `LEAD_SYNC_TIMEZONE` |
| `enum`     | `Đang liên hệ`                                        | Mã trong bảng `values`, ví dụ `IN_PROCESS`                                            |
| `user`     | Email hoặc tên người phụ trách                        | ID trong bảng `values`; không có thì dùng `defaults.assignedById`                     |

Ô email hoặc số điện thoại có thể chứa nhiều giá trị, ngăn bằng dấu phẩy, chấm phẩy hoặc xuống dòng. Giá trị đầu là khóa chống trùng; các giá trị sau được thêm vào lead và không thay thế giá trị lead đã có.

Các khóa khác của file:

- `titleTemplate`: mẫu sinh tiêu đề lead, ví dụ `{Tên khách hàng} - {Công ty}`.
- `defaults`: giá trị gửi kèm mọi hàng (mặc định `currencyId: VND`, `stageId: NEW`, `assignedById: 1`).
- `dedupe.keys`: khóa chống trùng, mặc định `["email", "phone"]`.
- `sheet.headerRow`: số hàng chứa tiêu đề, mặc định `1`.

Trường tùy chỉnh khai báo như trường thường với tên gốc:

```json
{ "column": "Mã chiến dịch", "field": "UF_CRM_CAMPAIGN_CODE", "type": "string" }
```

Mapping được kiểm tra ở đầu mỗi lần chạy. Nếu cột không có trong Sheet hoặc trường không có trong `crm.item.fields`, lần chạy kết thúc `failed`, nêu đúng tên cột hoặc trường sai, và không hàng nào bị đụng tới.

Sửa mapping làm mọi hàng được đồng bộ lại ở lần chạy kế tiếp. Nên chạy thử trước để xem số hàng bị ảnh hưởng. Mapping sửa được bằng tay trong file, qua `PUT /lead-sync/mapping`, hoặc trong trang quản trị (mục 7.2).

## 7. Chạy đồng bộ

### 7.1. Dòng lệnh

```bash
pnpm sync:leads --dry-run   # chạy thử, không ghi gì vào Bitrix24 và Sheet
pnpm sync:leads             # chạy một lần và chờ kết quả
pnpm sync:leads --force     # đồng bộ lại mọi hàng dù không đổi
```

`make sync-leads` và `make sync-leads-dry` là hai lệnh tắt tương ứng. Mã thoát khác 0 khi lần chạy `failed`, `aborted` hoặc không khởi động được.

Trình tự nên làm ở lần đầu: `--dry-run`, xem bảng tổng kết, rồi mới chạy thật.

### 7.2. Trang quản trị

Mở `http://localhost:3000/lead-sync.html` sau khi đăng nhập ở trang chủ.

| Mục             | Nội dung                                                             |
| --------------- | -------------------------------------------------------------------- |
| Tổng quan       | Kết nối Google và Bitrix24, lịch, bộ đếm của lần chạy gần nhất       |
| Lịch sử đồng bộ | Các lần chạy; bấm vào một lần để xem từng hàng và lý do lỗi          |
| Mapping cột     | Xem và sửa mapping; mapping sai bị từ chối kèm lý do, file không đổi |

Nút "Chạy thử" là `--dry-run`, ô "Đồng bộ lại mọi hàng" là `--force`.

### 7.3. HTTP

Các endpoint dưới đây cần JWT lấy từ `POST /auth/login`.

| Lời gọi                                                             | Kết quả                                                                |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `POST /lead-sync/runs` với body `{"dryRun": false, "force": false}` | `202 {"runId": "..."}`, lần chạy tiếp tục ở nền                        |
| `GET /lead-sync/runs/<runId>`                                       | Bộ đếm và các hàng đã tạo, cập nhật, lỗi                               |
| `GET /lead-sync/runs?page=1&limit=20`                               | Lịch sử, mới nhất trước                                                |
| `GET /lead-sync/status`                                             | Lịch, lần chạy gần nhất, kiểm tra kết nối Google và Bitrix24           |
| `GET /lead-sync/mapping`, `PUT /lead-sync/mapping`                  | Đọc và lưu mapping; mapping sai trả `400` kèm lý do                    |
| `POST /lead-sync/pull`                                              | Kéo giai đoạn và người phụ trách của mọi lead về Sheet (cần `two-way`) |
| `POST /lead-sync/bitrix-events/register`                            | Đăng ký nhận sự kiện lead với Bitrix24 (cần `two-way`, OAuth)          |
| `GET /google/oauth/authorize`                                       | Lấy đường dẫn cấp quyền Google (chế độ `oauth`)                        |

`409` nghĩa là đang có lần chạy khác (thông báo kèm `runId`). `503` nghĩa là chưa cấu hình đủ.

```bash
curl -X POST http://localhost:3000/lead-sync/runs \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{}'
```

### 7.4. Theo lịch

Đặt `LEAD_SYNC_CRON` rồi chạy server (`pnpm start:dev` hoặc Docker). Nhịp nào trùng lúc lần chạy trước chưa xong thì bị bỏ qua, không xếp hàng. Lệnh CLI không khởi động lịch.

### 7.5. Docker

```bash
docker compose up -d --build
docker compose run --rm app node dist/cli/lead-sync.js --dry-run
```

`docker-compose.yml` mount `./secrets` (ghi được, để lưu refresh token Google OAuth) và `./config` (chỉ đọc). Vì `./config` chỉ đọc nên trong Docker không sửa mapping qua trang quản trị được; sửa file trên máy chủ.

## 8. Đồng bộ hai chiều

Bật bằng `LEAD_SYNC_DIRECTION=two-way`. Chiều về mặc định gồm các cột có bảng `values` trong mapping (kiểu `enum` và `user`), tức `Trạng thái` và `Người phụ trách`: mã của Bitrix24 được đổi thành nhãn trong Sheet. Mã không có nhãn trong mapping (ví dụ giai đoạn `CONVERTED`) được bỏ qua.

Cột kiểu `string` hoặc `number` chảy về khi mapping khai báo thêm `"pull": true`; đặt `"pull": false` để một cột `enum` hoặc `user` không chảy về. Email, số điện thoại và ngày tháng chỉ đi một chiều.

```json
{ "column": "Công ty", "field": "companyTitle", "type": "string", "pull": true }
```

### 8.1. Xung đột

Hàng đã bị sửa trong Sheet sau lần đồng bộ cuối (nội dung không còn khớp `Sync Hash`) thì **Sheet thắng**: hàng không bị ghi đè, và lần chạy Sheet → Bitrix24 kế tiếp đẩy giá trị của Sheet lên.

Hàng không có sửa đổi chờ thì nhận giá trị của Bitrix24 cùng `Sync Hash` mới, nên thay đổi không bị dội ngược thành một lần cập nhật. Sự kiện do chính lần chạy của ứng dụng gây ra tìm thấy Sheet đã khớp và không ghi gì.

### 8.2. Real-time

Bitrix24 gọi `POST <APP_PUBLIC_URL>/lead-sync/bitrix-events` mỗi khi một lead đổi. Các sự kiện trong 2 giây được gom lại và kéo về trong một lần chạy (`trigger=webhook`). Mỗi sự kiện được kiểm bằng `application_token`; token lạ bị trả `403`.

Có hai cách để Bitrix24 biết địa chỉ này, dùng được song song:

- **Ứng dụng đã cài qua OAuth:** đặt `APP_PUBLIC_URL`, chạy ứng dụng, gọi một lần `POST /lead-sync/bitrix-events/register` kèm JWT. Gọi lại khi đổi địa chỉ công khai.
- **Outgoing webhook tạo tay** (khi chỉ dùng incoming webhook): vào **Tài nguyên cho nhà phát triển → Khác → Webhook ra**, đặt handler là `<APP_PUBLIC_URL>/lead-sync/bitrix-events`, chọn sự kiện cập nhật Lead (`ONCRMLEADUPDATE`) và sự kiện tạo Lead (`ONCRMLEADADD`), bấm **Create**, rồi chép token Bitrix24 hiện ra vào `BITRIX24_OUTGOING_TOKEN`.

ID của lead vừa đổi được xếp vào một hàng chờ trong SQLite và chỉ rời hàng chờ sau một lần kéo về không thất bại. Sự kiện nhận ngay trước khi ứng dụng khởi động lại, hoặc trong lúc Bitrix24 lỗi, được kéo về sau.

Địa chỉ handler phải truy cập được từ internet; `localhost` không dùng được. Khi cả hai cách cùng bật, mỗi thay đổi sinh hai sự kiện nhưng lead chỉ được kéo về một lần.

### 8.3. Lead tạo trong Bitrix24

Lead tạo trực tiếp trong Bitrix24 (sự kiện `ONCRMLEADADD`) được thêm thành một hàng mới dưới hàng cuối của Sheet, kèm Lead ID, nên lần chạy chiều đi sau đó bỏ qua nó. Hai trường hợp không thêm hàng:

- Lead do chính lần đồng bộ tạo ra: hàng của nó đã có sẵn.
- Lead có email hoặc số điện thoại đã nằm trong một hàng: hàng đó sẽ được nối với lead ở lần chạy chiều đi, thêm hàng nữa sẽ thành trùng.

Để nhận sự kiện này: ứng dụng đã cài thì gọi lại `POST /lead-sync/bitrix-events/register`; outgoing webhook tạo tay thì chọn thêm sự kiện tạo Lead. Kéo tay (`POST /lead-sync/pull`) không tìm lead mới, chỉ cập nhật các hàng đã liên kết.

### 8.4. Kéo tay

`POST /lead-sync/pull` kèm JWT kéo mọi lead đã liên kết (`trigger=pull`). Dùng khi không có địa chỉ công khai, hoặc để bù các sự kiện bị lỡ lúc ứng dụng tắt.

Hai chiều dùng chung khóa "mỗi lúc một lần chạy" với chiều đi. Khi đang bận, sự kiện được thử lại mỗi 5 giây, tối đa 12 lần.

## 9. Chống trùng và idempotency

- Hàng chưa có Lead ID luôn được tìm trùng trước bằng `crm.duplicate.findbycomm`, theo email rồi số điện thoại. Tìm thấy thì cập nhật lead đó, không thì tạo mới.
- Hàng đã có Lead ID chỉ được gửi lại khi nội dung đổi (so `Sync Hash`). Đổi định dạng ô, ví dụ in đậm hoặc `15000000` thành `15,000,000`, không tính là đổi.
- Hai hàng trỏ tới cùng một lead: hàng trên được xử lý, hàng dưới nhận `Trùng với hàng N`.
- Gửi batch bị timeout: ứng dụng không gửi lại nguyên lệnh mà tìm trùng lại trước, nên lead đã tạo ở lần gọi trước không bị tạo lần hai.
- Xóa nội dung ô Lead ID của một hàng đã đồng bộ: lần chạy sau tìm trùng và nối lại đúng lead cũ.

## 10. Xử lý lỗi

| Loại lỗi                                                       | Ứng dụng làm gì                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Dữ liệu một hàng sai                                           | Hàng đó ghi `Lỗi` kèm lý do; bị bỏ qua cho tới khi được sửa                                 |
| Bitrix24 từ chối một hàng                                      | Như trên; các hàng khác vẫn đồng bộ                                                         |
| Rate limit, timeout, 5xx                                       | Thử lại có backoff. Hết lượt: cả lô 25 hàng ghi lỗi tạm thời và được thử lại ở lần chạy sau |
| `OPERATION_TIME_LIMIT`                                         | Dừng lần chạy (`aborted`); các hàng còn lại ghi `Chờ xử lý`                                 |
| Sai khóa, Sheet chưa share, mapping sai, portal ở CRM đơn giản | Lần chạy kết thúc `failed` kèm việc cần làm                                                 |

Sự cố thường gặp:

| Thông báo                                                 | Nguyên nhân và cách sửa                                                                                    |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `Chưa cấu hình GOOGLE_SHEET_ID`                           | Thiếu biến trong `.env`                                                                                    |
| `Chưa cấu hình khóa service account`                      | Thiếu cả `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` lẫn `..._KEY_BASE64`                                            |
| `Không đọc được file khóa service account ...`            | File không nằm ở đường dẫn trong `.env`; kiểm tra tên file                                                 |
| `Chưa cấp quyền Google`                                   | Chế độ `oauth` nhưng chưa đồng ý; làm bước 5 của mục 3.2                                                   |
| `Google từ chối truy cập`                                 | Chưa share Sheet quyền Editor cho email của service account, hoặc khóa sai                                 |
| `Spreadsheet không có worksheet tên ...`                  | Tên tab khác `GOOGLE_SHEET_NAME`; đổi tên tab, không phải tên file                                         |
| `Sheet không có cột ...`                                  | Tiêu đề cột trong Sheet khác với `mapping.json`                                                            |
| `Bitrix24 không có trường lead ...`                       | Sai tên trường trong mapping; đối chiếu với `crm.item.fields`                                              |
| `Bitrix24 đang ở chế độ CRM đơn giản`                     | Bật CRM cổ điển, xem mục 4.1                                                                               |
| `Gói dịch vụ của portal Bitrix24 không cho dùng REST API` | Portal chặn REST. Có thể do gói dịch vụ, cũng có thể là khóa tạm thời sau một đợt gọi dồn dập (xem mục 12) |
| `Bitrix24 installation không khớp` (409 khi cài)          | Một portal khác với `BITRIX24_DOMAIN` đang cài ứng dụng; sửa `.env` rồi cài lại                            |
| `Lead không còn tồn tại trong Bitrix24`                   | Lead đã bị xóa; xóa nội dung ô Lead ID nếu muốn tạo lại                                                    |
| `Ô Lead ID Bitrix24 không phải số nguyên dương`           | Ô bị sửa tay; xóa nội dung ô để đồng bộ lại                                                                |
| `Hàng bị di chuyển trong lúc đồng bộ`                     | Có người sắp xếp hoặc chèn hàng khi đang chạy; lần chạy sau tự xử lý                                       |
| `Chưa kết nối Bitrix24`                                   | Chưa đặt `BITRIX24_WEBHOOK_URL` và chưa cài ứng dụng qua `/install`                                        |
| `Đồng bộ hai chiều đang tắt`                              | Đặt `LEAD_SYNC_DIRECTION=two-way`                                                                          |
| `Sự kiện Bitrix24 có application_token không hợp lệ`      | Token trong `BITRIX24_OUTGOING_TOKEN` khác token của webhook ra; chép lại từ portal                        |

Nên đặt lịch ngoài giờ nhập liệu cao điểm: sắp xếp hoặc chèn hàng trong lúc đang chạy làm các hàng đó bị hoãn sang lần chạy sau.

## 11. Giám sát

Log của server có một dòng mở đầu, một dòng mỗi lô và một dòng tổng kết:

```text
Lead sync <runId> finished: total=120 created=30 updated=10 skipped=78 failed=2 duration=14.2s
Lead pullback <runId> finished: total=1 updated=1 skipped=0 conflicts=0
```

Mỗi hàng lỗi có một dòng `error` gồm số hàng, bước thất bại, mã lỗi và thông báo. Log và nhật ký không chứa email, số điện thoại hay tên khách hàng; số hàng và Lead ID đủ để truy ngược.

Nhật ký nằm trong hai bảng SQLite `lead_sync_run` và `lead_sync_run_item`, đọc qua trang quản trị hoặc `GET /lead-sync/runs`. Cột nguồn của một lần chạy là `schedule`, `http`, `cli` (chiều đi) hoặc `webhook`, `pull` (chiều về). Lần chạy cũ hơn `LEAD_SYNC_LOG_RETENTION_DAYS` ngày bị xóa ở đầu mỗi lần chạy.

Số lần gọi API cho 150 hàng mới (6 lô): Bitrix24 14 lần (1 `crm.settings.mode.get`, 1 `crm.item.fields`, 6 batch tìm trùng, 6 batch ghi), Google 9 lần đọc và 8 lần ghi. Chạy lại khi không có thay đổi: Bitrix24 2 lần, Google 3 lần đọc. Các con số này được ghim bằng test tự động với client giả.

## 12. Kết quả trên hệ thống thật (08/10/2026)

| Kịch bản                             | Kết quả                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC1 Tạo mới                          | 5 hàng mẫu: 4 lead được tạo, 1 hàng cố ý sai bị báo `Lỗi`. Giai đoạn đúng theo cột `Trạng thái`; số điện thoại mất số 0 khi import được lưu thành `+84...` |
| Chạy lại                             | Mọi hàng `skipped`, Bitrix24 không có lead mới                                                                                                             |
| TC2 Cập nhật                         | Sửa một ô: 1 hàng `updated`, lead đổi theo, thời gian đồng bộ đổi                                                                                          |
| TC2 Định dạng                        | In đậm và đổi định dạng số của ô: `skipped`, không có lệnh ghi                                                                                             |
| TC3 Trùng email, trùng số điện thoại | Lead tạo tay trong Bitrix24 được cập nhật, không có lead mới; `0977000111` khớp với `+84977000111`                                                         |
| TC4 Lỗi dữ liệu                      | Hàng sai ghi `Lỗi` kèm lý do; các hàng khác vẫn chạy                                                                                                       |
| Custom field                         | Trường `UF_CRM_*` nhận đúng giá trị; đổi mapping làm mọi hàng đồng bộ lại một lần                                                                          |
| Kiểu `date`                          | Bitrix24 nhận `2026-10-08` cho một trường ngày tùy chỉnh                                                                                                   |
| Nhiều giá trị                        | Thêm email và số điện thoại thứ hai vào ô: lead nhận thêm hai giá trị, giá trị cũ giữ nguyên                                                               |
| HTTP, lịch, cột ẩn                   | `POST /lead-sync/runs` trả 202; lần chạy theo cron xuất hiện đúng đầu phút; hai cột kỹ thuật được ẩn                                                       |
| Hiệu năng                            | 150 hàng mới: 150 lead trong 22,2 giây, 6 lô, 0 lần gặp rate limit. Chạy lại: `skipped=150` trong 2,6 giây                                                 |
| Hai chiều                            | Đổi giai đoạn lead trong Bitrix24: ô `Trạng thái` đổi theo sau khoảng 5 giây; lần chạy chiều đi sau đó `skipped`                                           |
| Xung đột                             | Sửa Sheet rồi đổi lead trong Bitrix24: hàng không bị ghi đè, lần chạy chiều đi đẩy giá trị của Sheet lên                                                   |
| Google OAuth                         | Cấp quyền, đọc và ghi Sheet bằng refresh token, chạy trọn cả hai chiều                                                                                     |
| Incoming webhook                     | Chạy thử, cập nhật lead, chạy lại và real-time đều đạt                                                                                                     |
| Outgoing webhook                     | Sự kiện của webhook ra và của ứng dụng đã cài cùng được chấp nhận; lead được kéo về một lần; token lạ bị trả 403                                           |

Chưa kiểm trên hệ thống thật: việc thử lại khi gặp rate limit và timeout của Bitrix24. Portal có trả `QUERY_LIMIT_EXCEEDED` khi bị gọi dồn dập, nhưng các lệnh của lần đồng bộ không gặp, nên nhánh này mới có test tự động.

Một quan sát về Bitrix24: sau một đợt gọi dồn dập (khoảng 900 lệnh trong vài giây), portal trả `FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN` cho mọi lệnh trong khoảng 20 phút rồi tự hoạt động lại. Lỗi này vì vậy có thể là khóa tạm thời, không nhất thiết do gói dịch vụ. Chưa có tài liệu của Bitrix24 xác nhận cơ chế này.

Câu hỏi còn mở: `crm.duplicate.findbycomm` có trả lead đã chuyển đổi hoặc đã xóa hay không. Nếu có và điều đó gây nối nhầm, lọc theo `stageSemanticId` trong `BitrixLeadGateway.getLeads`.

## 13. Giới hạn của phiên bản này

- Chiều về không gồm email, số điện thoại, ngày tháng và tiêu đề lead; các cột này chỉ đi từ Sheet sang Bitrix24.
- Lead tạo trong Bitrix24 lúc ứng dụng không nhận được sự kiện (ứng dụng tắt, chưa đăng ký sự kiện tạo lead) không được thêm vào Sheet về sau.
- Người phụ trách tra bằng bảng tĩnh trong mapping, chưa tra qua `user.get`.
- Khóa "mỗi lúc một lần chạy" nằm trong SQLite, nên chỉ có tác dụng khi server và CLI dùng chung file dữ liệu. Chạy nhiều container với volume riêng không được hỗ trợ.

## 14. Tham khảo trong repo

| Nội dung                                               | Vị trí                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Điều phối, hàm thuần, API, lịch, hai chiều             | `src/modules/lead-sync/`                                                      |
| Xác thực (service account, OAuth) và gọi Google Sheets | `src/modules/google-sheets/`                                                  |
| Gọi REST, batch, giới hạn tốc độ Bitrix24              | `src/modules/bitrix/`                                                         |
| Lệnh CLI                                               | `src/cli/lead-sync.ts`                                                        |
| Trang quản trị                                         | `public/lead-sync.html`, `public/js/lead-sync.js`, `public/css/lead-sync.css` |
| Mapping mặc định                                       | `config/mapping.json`                                                         |
| Dữ liệu mẫu                                            | `samples/leads-template.csv`, `samples/leads-150.csv`                         |
| Bản rút gọn của tài liệu này                           | `Readme.txt`, mục 15                                                          |
