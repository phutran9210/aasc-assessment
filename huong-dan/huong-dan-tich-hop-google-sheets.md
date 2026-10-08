# Hướng dẫn tích hợp Google Sheets với Bitrix24 (đồng bộ Lead)

Tài liệu dành cho người cài đặt và vận hành. Các mục 2 đến 8 đi theo thứ tự công việc: thiết lập Google, thiết lập Bitrix24, cấu hình, chạy, đồng bộ hai chiều, xử lý sự cố, giám sát.

## 1. Tổng quan

Sales nhập khách hàng tiềm năng vào một Google Sheet. Ứng dụng đọc Sheet, tạo hoặc cập nhật Lead trong Bitrix24, rồi ghi kết quả vào chính hàng đó. Khi bật hai chiều, thay đổi trong Bitrix24 được ghi ngược về Sheet.

```text
Google Sheet --đọc--> lead-sync (NestJS) --batch: tìm trùng, add/update--> Bitrix24
     ^                     |    ^
     +--ghi kết quả--------+    +--sự kiện lead tạo mới / thay đổi (hai chiều)--+
                           |
                           +--> SQLite: nhật ký lần chạy, khóa một-lần-chạy, hàng chờ sự kiện
```

- Trạng thái của từng hàng (Lead ID, Sync Hash) nằm trong Sheet. SQLite chỉ giữ nhật ký và hàng chờ.
- Mỗi lần chạy xử lý từng lô 25 hàng.
- Chạy lại không tạo lead trùng.

Cần có: Node ≥ 24.9 và pnpm 11.2.2 (hoặc Docker), một project Google Cloud, một Google Sheet, một portal Bitrix24, file `.env` (`cp .env.example .env`). Cài ứng dụng qua OAuth và nhận sự kiện real-time cần thêm một địa chỉ công khai, ví dụ ngrok.

## 2. Thiết lập Google

Chọn một trong hai cách xác thực.

### 2.1. Service account (mặc định)

1. Vào <https://console.cloud.google.com>, tạo project, bật **Google Sheets API**.
2. **IAM & Admin → Service Accounts → Create service account**. Không gán role.
3. Mở service account, **Keys → Add key → Create new key → JSON**. Lưu thành `secrets/google-sa.json`.
4. Tạo Google Sheet: **File → Import → Upload** file `samples/leads-template.csv`.
5. Đổi tên **tab** ở thanh dưới cùng thành `Leads`. Import CSV tạo tab tên `Untitled`; đổi tên file không đổi tên tab.
6. **Share** Sheet cho email trong trường `client_email` của file JSON, quyền **Editor**.
7. Chép chuỗi giữa `/d/` và `/edit` trong URL của Sheet vào `GOOGLE_SHEET_ID`.

### 2.2. OAuth 2.0

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**, loại **Web application**.
2. Để trống **Authorized JavaScript origins**. Thêm vào **Authorized redirect URIs**: `http://localhost:3000/google/oauth/callback`.
3. Ứng dụng OAuth ở chế độ thử nghiệm: thêm email sẽ đăng nhập vào **Test users**, nếu không Google trả `403 access_denied`.
4. Trong `.env`: `GOOGLE_AUTH_MODE=oauth`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`. Redirect URI phải khớp từng ký tự với URI đã đăng ký, kể cả dấu `/` cuối.
5. Chạy ứng dụng, đăng nhập, gọi `GET /google/oauth/authorize` kèm JWT, mở `url` trả về và đồng ý. Đường dẫn dùng một lần, hết hạn sau 10 phút.
6. Refresh token được lưu vào `GOOGLE_OAUTH_TOKEN_FILE` (mặc định `secrets/google-oauth-token.json`, quyền 600).

Tài khoản đã đồng ý phải có quyền sửa Sheet.

## 3. Thiết lập Bitrix24

### 3.1. Bật CRM cổ điển

Portal mới mặc định ở chế độ CRM đơn giản: lead vừa tạo bị chuyển ngay thành Deal và Contact, mất giai đoạn lấy từ Sheet. Ứng dụng kiểm tra chế độ này trước mỗi lần chạy và dừng nếu portal không dùng Lead.

Vào **CRM → Cài đặt → Chế độ CRM**, chọn **CRM cổ điển**. Xong khi menu CRM có mục **Leads**.

### 3.2. Cho ứng dụng gọi Bitrix24

Chọn một trong hai cách.

**Incoming webhook.** **Ứng dụng → Tài nguyên cho nhà phát triển → Khác → Webhook vào**. Chọn quyền `crm` (thêm `user` nếu muốn tra người phụ trách theo email), bấm **Create**. Chép URL trong ô "Webhook để gọi REST API" vào `BITRIX24_WEBHOOK_URL`. URL này là secret. Khi biến có giá trị, mọi lời gọi Bitrix24 của ứng dụng đi qua webhook, kể cả API `/contacts`.

**Cài ứng dụng qua OAuth.** Để trống `BITRIX24_WEBHOOK_URL`, cài ứng dụng theo mục 13 của `Readme.txt`. "Your handler path" và "Initial installation path" đều là `https://<địa chỉ công khai>/install`, quyền `crm`.

Chuyển sang portal khác: sửa `BITRIX24_DOMAIN`, `BITRIX24_CLIENT_ID`, `BITRIX24_CLIENT_SECRET` rồi cài lại. Chỉ portal trùng `BITRIX24_DOMAIN` được thay bản ghi cài đặt cũ; portal khác nhận 409.

### 3.3. Cho Bitrix24 báo sự kiện về (chỉ cần khi dùng hai chiều)

Handler là `<APP_PUBLIC_URL>/lead-sync/bitrix-events`. Địa chỉ phải truy cập được từ internet.

- **Ứng dụng đã cài qua OAuth:** gọi một lần `POST /lead-sync/bitrix-events/register` kèm JWT. Gọi lại khi đổi địa chỉ công khai.
- **Chỉ dùng incoming webhook:** **Tài nguyên cho nhà phát triển → Khác → Webhook ra**. Điền handler, chọn hai sự kiện tạo Lead (`ONCRMLEADADD`) và cập nhật Lead (`ONCRMLEADUPDATE`), bấm **Create**. Chép token Bitrix24 hiện ra vào `BITRIX24_OUTGOING_TOKEN`.

Hai cách dùng được cùng lúc; một lead được báo hai lần vẫn chỉ được xử lý một lần.

## 4. Cấu hình

### 4.1. `.env`

Tối thiểu, với service account và incoming webhook:

```dotenv
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=secrets/google-sa.json
GOOGLE_SHEET_ID=<id của Sheet>
GOOGLE_SHEET_NAME=Leads
BITRIX24_WEBHOOK_URL=https://<portal>.bitrix24.com/rest/<user id>/<mã>/
```

| Biến                                                                                | Mặc định                          | Ý nghĩa                                                                         |
| ----------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------- |
| `GOOGLE_AUTH_MODE`                                                                  | `service_account`                 | `service_account` hoặc `oauth`                                                  |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`                                                   | trống                             | Đường dẫn file khóa JSON                                                        |
| `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64`                                                 | trống                             | File khóa mã hóa base64 (`base64 -w0 secrets/google-sa.json`); ưu tiên hơn file |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` | trống                             | OAuth client, khi dùng chế độ `oauth`                                           |
| `GOOGLE_OAUTH_TOKEN_FILE`                                                           | `secrets/google-oauth-token.json` | Nơi lưu refresh token                                                           |
| `GOOGLE_SHEET_ID`                                                                   | trống                             | Chuỗi giữa `/d/` và `/edit`                                                     |
| `GOOGLE_SHEET_NAME`                                                                 | `Leads`                           | Tên tab                                                                         |
| `BITRIX24_WEBHOOK_URL`                                                              | trống                             | Có giá trị thì dùng incoming webhook thay OAuth                                 |
| `BITRIX24_OUTGOING_TOKEN`                                                           | trống                             | Token của webhook ra (mục 3.3)                                                  |
| `APP_PUBLIC_URL`                                                                    | trống                             | Địa chỉ công khai của ứng dụng                                                  |
| `LEAD_SYNC_DIRECTION`                                                               | `sheet-to-bitrix`                 | `two-way` bật thêm chiều Bitrix24 về Sheet                                      |
| `LEAD_SYNC_MAPPING_PATH`                                                            | `config/mapping.json`             | File mapping                                                                    |
| `LEAD_SYNC_CRON`                                                                    | trống                             | Biểu thức cron, ví dụ `*/15 * * * *`; trống là tắt lịch                         |
| `LEAD_SYNC_TIMEZONE`                                                                | `Asia/Ho_Chi_Minh`                | Múi giờ của lịch, cột thời gian và ô ngày giờ                                   |
| `LEAD_SYNC_DEFAULT_COUNTRY`                                                         | `VN`                              | Quốc gia khi chuẩn hóa số điện thoại: `VN`, `US`, `SG`                          |
| `LEAD_SYNC_MAX_RETRIES`                                                             | `4`                               | Số lần thử lại một lời gọi API (0 đến 10)                                       |
| `LEAD_SYNC_LOG_RETENTION_DAYS`                                                      | `30`                              | Số ngày giữ nhật ký lần chạy                                                    |

Thiếu cấu hình: ứng dụng vẫn khởi động, `POST /lead-sync/runs` trả `503`, `GET /lead-sync/status` nêu thứ còn thiếu. Sai định dạng (cron, URL webhook, base64): ứng dụng dừng khi khởi động và nêu tên biến. Sửa `.env` xong phải khởi động lại.

### 4.2. Các cột của Sheet

Người dùng nhập chín cột: `Tên khách hàng`, `Email`, `Số điện thoại`, `Công ty`, `Nguồn lead (UTM Source)`, `Ngân sách dự kiến`, `Trạng thái`, `Người phụ trách`, `Ghi chú`.

Ứng dụng tự thêm năm cột ở lần chạy đầu:

| Cột                      | Nội dung                                                     |
| ------------------------ | ------------------------------------------------------------ |
| `Trạng thái đồng bộ`     | `Chờ xử lý`, `Đã đồng bộ` hoặc `Lỗi`. Ô trống là `Chờ xử lý` |
| `Lead ID Bitrix24`       | Cột ẩn                                                       |
| `Thời gian đồng bộ cuối` | `yyyy-MM-dd HH:mm:ss` theo `LEAD_SYNC_TIMEZONE`              |
| `Thông báo lỗi`          | Cột sai và cách sửa; được xóa khi hàng đồng bộ thành công    |
| `Sync Hash`              | Cột ẩn                                                       |

- Cột được tìm theo tên tiêu đề: đổi thứ tự được, đổi tên thì không.
- Không sửa hai cột ẩn.
- Mỗi hàng cần `Tên khách hàng` và ít nhất `Email` hoặc `Số điện thoại`.
- Ép đồng bộ lại một hàng: đặt `Trạng thái đồng bộ` thành `Chờ xử lý`.

### 4.3. Mapping (`config/mapping.json`)

Mỗi phần tử của `fields` nối một cột với một trường lead:

```json
{ "column": "Ngân sách dự kiến", "field": "opportunity", "type": "number" }
```

| Kiểu       | Ví dụ đầu vào                                         | Gửi sang Bitrix24                                                                                                               |
| ---------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `string`   | `"  Nguyễn  Văn An "`                                 | `"Nguyễn Văn An"`                                                                                                               |
| `email`    | `"An@Example.com "`                                   | `"an@example.com"`                                                                                                              |
| `phone`    | `0901 234 567`, `901234567`, `+84 901234567`          | `"+84901234567"`                                                                                                                |
| `number`   | `1500000`, `1.500.000 ₫`, `15tr`, `500k`              | `1500000`, `1500000`, `15000000`, `500000`                                                                                      |
| `date`     | `08/10/2026`, `2026-10-08`, ô ngày                    | `"2026-10-08"` (ngày trước tháng sau)                                                                                           |
| `datetime` | `08/10/2026 14:30`, `2026-10-08T14:30:00`, ô ngày giờ | `"2026-10-08T14:30:00+07:00"`; thiếu múi giờ thì lấy `LEAD_SYNC_TIMEZONE`                                                       |
| `enum`     | `Đang liên hệ`                                        | Mã trong bảng `values`, ví dụ `IN_PROCESS`                                                                                      |
| `user`     | Email hoặc tên người phụ trách                        | ID trong bảng `values`; email ngoài bảng được tra bằng `user.get` (cần quyền `user`); không có thì dùng `defaults.assignedById` |

Ô email hoặc số điện thoại nhận nhiều giá trị, ngăn bằng dấu phẩy, chấm phẩy hoặc xuống dòng. Giá trị đầu là khóa chống trùng; các giá trị sau được thêm vào lead, không thay giá trị lead đã có.

Các khóa khác:

- `titleTemplate`: mẫu tiêu đề lead, ví dụ `{Tên khách hàng} - {Công ty}`.
- `defaults`: giá trị gửi kèm mọi hàng (`currencyId: VND`, `stageId: NEW`, `assignedById: 1`).
- `dedupe.keys`: khóa chống trùng, mặc định `["email", "phone"]`.
- `sheet.headerRow`: hàng chứa tiêu đề, mặc định `1`.
- `pull` trên từng cột: xem mục 6.1.

Trường tùy chỉnh dùng tên gốc:

```json
{ "column": "Mã chiến dịch", "field": "UF_CRM_CAMPAIGN_CODE", "type": "string" }
```

Mapping được kiểm tra ở đầu mỗi lần chạy. Cột không có trong Sheet hoặc trường không có trong `crm.item.fields`: lần chạy `failed`, nêu tên cột hoặc trường, không hàng nào bị đụng tới.

Sửa mapping làm mọi hàng đồng bộ lại ở lần chạy kế tiếp; chạy thử trước. Sửa bằng file, bằng `PUT /lead-sync/mapping`, hoặc trong trang quản trị.

## 5. Chạy và triển khai

### 5.1. Dòng lệnh

```bash
pnpm sync:leads --dry-run   # chạy thử, không ghi gì vào Bitrix24 và Sheet
pnpm sync:leads             # chạy một lần và chờ kết quả
pnpm sync:leads --force     # đồng bộ lại mọi hàng dù không đổi
```

Mã thoát khác 0 khi lần chạy `failed`, `aborted` hoặc không khởi động được. Lần đầu: chạy `--dry-run`, xem bảng tổng kết, rồi chạy thật.

Dữ liệu thử:

```bash
pnpm seed:leads 500      # thêm 500 hàng sinh bằng faker tiếng Việt vào cuối Sheet
pnpm seed:leads --clear  # xóa mọi hàng seed và các lead tương ứng trong Bitrix24
```

Hàng seed mang email thuộc miền `seed.example.com`; lệnh xóa chỉ đụng tới các hàng đó. Lệnh không chạy khi `NODE_ENV=production`, kể cả trong bản Docker.

### 5.2. Trang quản trị

`http://localhost:3000/lead-sync.html`, sau khi đăng nhập ở trang chủ.

| Mục             | Nội dung                                                                  |
| --------------- | ------------------------------------------------------------------------- |
| Tổng quan       | Kết nối Google và Bitrix24, lịch, bộ đếm của lần chạy gần nhất            |
| Lịch sử đồng bộ | Các lần chạy, 10 lần mỗi trang; bấm một lần để xem từng hàng và lý do lỗi |
| Mapping cột     | Xem và sửa mapping; mapping sai bị từ chối kèm lý do                      |

"Chạy thử" là `--dry-run`, "Đồng bộ lại mọi hàng" là `--force`.

### 5.3. HTTP

Cần JWT lấy từ `POST /auth/login`.

| Lời gọi                                                        | Kết quả                                             |
| -------------------------------------------------------------- | --------------------------------------------------- |
| `POST /lead-sync/runs` với `{"dryRun": false, "force": false}` | `202 {"runId": "..."}`, chạy tiếp ở nền             |
| `GET /lead-sync/runs?page=1&limit=20`                          | Lịch sử, mới nhất trước                             |
| `GET /lead-sync/runs/<runId>`                                  | Bộ đếm và các hàng đã tạo, cập nhật, lỗi            |
| `GET /lead-sync/status`                                        | Lịch, lần chạy gần nhất, kết nối Google và Bitrix24 |
| `GET /lead-sync/mapping`, `PUT /lead-sync/mapping`             | Đọc và lưu mapping; mapping sai trả `400`           |
| `POST /lead-sync/pull`                                         | Kéo từ Bitrix24 về Sheet (cần `two-way`)            |
| `POST /lead-sync/bitrix-events/register`                       | Đăng ký nhận sự kiện lead (cần `two-way`, OAuth)    |
| `GET /google/oauth/authorize`                                  | Đường dẫn cấp quyền Google (chế độ `oauth`)         |

`409`: đang có lần chạy khác. `503`: chưa cấu hình đủ.

### 5.4. Theo lịch

Đặt `LEAD_SYNC_CRON` rồi chạy server. Nhịp trùng lúc lần chạy trước chưa xong thì bị bỏ qua. Lệnh CLI không khởi động lịch.

### 5.5. Docker

```bash
docker compose up -d --build
docker compose run --rm app node dist/cli/lead-sync.js --dry-run
```

`./secrets` được mount ghi được (để lưu refresh token Google); `./config` được mount chỉ đọc, nên trong Docker phải sửa mapping bằng file trên máy chủ.

## 6. Đồng bộ hai chiều

Bật bằng `LEAD_SYNC_DIRECTION=two-way` và thiết lập sự kiện theo mục 3.3.

### 6.1. Cột nào chảy về Sheet

- Cột `enum` và `user` (`Trạng thái`, `Người phụ trách`): mặc định có. Mã của Bitrix24 được đổi thành nhãn trong bảng `values`; mã không có nhãn (ví dụ `CONVERTED`) bị bỏ qua.
- Cột `string` và `number`: chỉ khi mapping ghi `"pull": true`.
- Đặt `"pull": false` để một cột `enum` hoặc `user` không chảy về.
- Email, số điện thoại, ngày tháng và tiêu đề lead chỉ đi từ Sheet sang Bitrix24.

```json
{ "column": "Công ty", "field": "companyTitle", "type": "string", "pull": true }
```

### 6.2. Xung đột

Hàng đã bị sửa trong Sheet sau lần đồng bộ cuối (nội dung không khớp `Sync Hash`): **Sheet thắng**. Hàng không bị ghi đè; lần chạy Sheet → Bitrix24 kế tiếp đẩy giá trị của Sheet lên.

Hàng không có sửa đổi chờ: nhận giá trị của Bitrix24 cùng `Sync Hash` mới, nên lần chạy chiều đi sau đó bỏ qua nó. Sự kiện do chính ứng dụng gây ra tìm thấy Sheet đã khớp và không ghi gì.

### 6.3. Real-time

Bitrix24 gọi handler khi một lead được tạo hoặc thay đổi. Mỗi sự kiện được kiểm bằng `application_token`; token lạ nhận `403`. ID của lead vào một hàng chờ trong SQLite, các sự kiện trong 2 giây được xử lý chung một lần chạy (`trigger=webhook`).

- Lead rời hàng chờ sau một lần kéo về không thất bại. Sự kiện nhận ngay trước khi ứng dụng khởi động lại được xử lý lúc khởi động.
- Khi một lần chạy khác đang giữ khóa, lượt kéo về thử lại mỗi 5 giây cho tới khi khóa được nhả.
- Bitrix24 không gửi đủ sự kiện khi dữ liệu đổi dồn dập: tạo 500 lead liên tiếp, 125 sự kiện về tới ứng dụng. Cần đủ thì gọi thêm `POST /lead-sync/pull`.

### 6.4. Lead tạo trong Bitrix24

Lead tạo trực tiếp trong Bitrix24 được thêm thành hàng mới dưới hàng cuối, kèm Lead ID. Không thêm hàng cho:

- lead do chính lần đồng bộ tạo ra;
- lead có email hoặc số điện thoại đã nằm trong một hàng. Hàng đó được nối với lead ở lần chạy chiều đi.

### 6.5. Kéo tay

`POST /lead-sync/pull` cập nhật mọi hàng đã liên kết (`trigger=pull`). Nó không tìm lead mới.

## 7. Xử lý sự cố

Cách ứng dụng phản ứng:

| Loại lỗi                                                       | Hành vi                                                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Dữ liệu một hàng sai                                           | Hàng ghi `Lỗi` kèm lý do; bị bỏ qua tới khi được sửa                         |
| Bitrix24 từ chối một hàng                                      | Như trên; các hàng khác vẫn đồng bộ                                          |
| Rate limit, timeout, 5xx                                       | Thử lại có backoff. Hết lượt: cả lô ghi lỗi tạm thời, thử lại ở lần chạy sau |
| `OPERATION_TIME_LIMIT`                                         | Dừng lần chạy (`aborted`); các hàng còn lại ghi `Chờ xử lý`                  |
| Sai khóa, Sheet chưa share, mapping sai, portal ở CRM đơn giản | Lần chạy `failed` kèm việc cần làm                                           |

Tra theo thông báo:

| Thông báo                                                  | Nguyên nhân và cách sửa                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `Chưa cấu hình GOOGLE_SHEET_ID`                            | Thiếu biến trong `.env`                                                        |
| `Chưa cấu hình khóa service account`                       | Thiếu cả `..._KEY_FILE` lẫn `..._KEY_BASE64`                                   |
| `Không đọc được file khóa service account ...`             | File không ở đường dẫn ghi trong `.env`                                        |
| `Chưa cấp quyền Google`                                    | Chế độ `oauth` nhưng chưa đồng ý; làm bước 5 mục 2.2                           |
| `Google từ chối truy cập`                                  | Chưa share Sheet quyền Editor, hoặc khóa sai                                   |
| `Spreadsheet không có worksheet tên ...`                   | Tên tab khác `GOOGLE_SHEET_NAME`                                               |
| `Sheet không có cột ...`                                   | Tiêu đề cột khác với mapping                                                   |
| `Bitrix24 không có trường lead ...`                        | Sai tên trường trong mapping; đối chiếu `crm.item.fields`                      |
| `Bitrix24 đang ở chế độ CRM đơn giản`                      | Bật CRM cổ điển (mục 3.1)                                                      |
| `Gói dịch vụ của portal Bitrix24 không cho dùng REST API`  | Portal chặn REST: do gói dịch vụ, hoặc khóa tạm sau khi bị gọi dồn dập (mục 9) |
| `Chưa kết nối Bitrix24`                                    | Chưa đặt `BITRIX24_WEBHOOK_URL` và chưa cài ứng dụng                           |
| `Bitrix24 installation không khớp` (409 khi cài)           | Portal đang cài khác `BITRIX24_DOMAIN`                                         |
| `Current authorization type is denied` khi đăng ký sự kiện | Đang dùng incoming webhook; tạo webhook ra (mục 3.3)                           |
| `Sự kiện Bitrix24 có application_token không hợp lệ`       | `BITRIX24_OUTGOING_TOKEN` khác token của webhook ra                            |
| `Đồng bộ hai chiều đang tắt`                               | Đặt `LEAD_SYNC_DIRECTION=two-way`                                              |
| `Assignees not looked up with user.get` (log)              | Thiếu quyền `user`; ứng dụng dùng người phụ trách mặc định                     |
| `Lead không còn tồn tại trong Bitrix24`                    | Lead đã bị xóa; xóa ô Lead ID để tạo lại                                       |
| `Ô Lead ID Bitrix24 không phải số nguyên dương`            | Ô bị sửa tay; xóa nội dung ô                                                   |
| `Hàng bị di chuyển trong lúc đồng bộ`                      | Có người sắp xếp hoặc chèn hàng khi đang chạy; lần chạy sau tự xử lý           |
| `Trùng với hàng N`                                         | Hai hàng cùng email hoặc số điện thoại; hàng trên được xử lý                   |

## 8. Giám sát và bảo trì

**Log.** Mỗi lần chạy có một dòng mở đầu, một dòng mỗi lô và một dòng tổng kết:

```text
Lead sync <runId> finished: total=120 created=30 updated=10 skipped=78 failed=2 duration=14.2s
Lead pullback <runId> finished: total=1 added=0 updated=1 skipped=0 conflicts=0
```

Mỗi hàng lỗi có một dòng `error` gồm số hàng, bước thất bại, mã lỗi, thông báo. Log không chứa email, số điện thoại hay tên khách hàng.

**Nhật ký.** Bảng `lead_sync_run` và `lead_sync_run_item`, xem trong trang quản trị hoặc `GET /lead-sync/runs`. Nguồn của một lần chạy: `schedule`, `http`, `cli` (chiều đi), `webhook`, `pull` (chiều về). Lần chạy cũ hơn `LEAD_SYNC_LOG_RETENTION_DAYS` ngày tự bị xóa.

**Kiểm tra nhanh.** `GET /lead-sync/status` trả kết nối Google, kết nối Bitrix24, lịch và lần chạy gần nhất.

**Việc định kỳ.**

| Việc                       | Cách làm                                                                  |
| -------------------------- | ------------------------------------------------------------------------- |
| Đổi khóa service account   | Tạo key mới, thay file, khởi động lại, xóa key cũ trên Google Cloud       |
| Cấp lại quyền Google OAuth | Gọi lại `GET /google/oauth/authorize` và đồng ý                           |
| Đổi mã incoming webhook    | Tạo mới trong portal, sửa `BITRIX24_WEBHOOK_URL`, khởi động lại           |
| Đổi địa chỉ công khai      | Sửa `APP_PUBLIC_URL`; đăng ký lại sự kiện hoặc sửa handler của webhook ra |
| Sao lưu                    | File SQLite ở `DATABASE_PATH` và thư mục `secrets/`                       |
| Bù sự kiện bị lỡ           | `POST /lead-sync/pull`                                                    |

Đặt lịch ngoài giờ nhập liệu cao điểm: hàng bị sắp xếp hoặc chèn lúc đang chạy bị hoãn sang lần chạy sau.

Số lời gọi API cho 150 hàng mới (6 lô): Bitrix24 14 (1 `crm.settings.mode.get`, 1 `crm.item.fields`, 6 batch tìm trùng, 6 batch ghi), Google 9 đọc và 8 ghi. Chạy lại khi không đổi: Bitrix24 2, Google 3 đọc.

## 9. Kết quả kiểm thử

Chạy ngày 08/10/2026 trên một Google Sheet thật và một portal Bitrix24 thật.

| Kịch bản                            | Kết quả                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| TC1 Tạo mới                         | 5 hàng mẫu: 4 lead được tạo đúng giai đoạn, 1 hàng cố ý sai bị báo `Lỗi`. Số điện thoại mất số 0 khi import được lưu thành `+84...` |
| TC2 Cập nhật                        | Sửa một ô: 1 hàng `updated`, lead đổi theo. Chỉ đổi định dạng ô: `skipped`                                                          |
| TC3 Trùng lặp                       | Lead tạo tay trong Bitrix24 được cập nhật theo email và theo số điện thoại; không có lead mới                                       |
| TC4 Lỗi dữ liệu                     | Hàng sai ghi `Lỗi` kèm lý do; các hàng khác vẫn chạy                                                                                |
| Idempotency                         | Chạy lại: mọi hàng `skipped`                                                                                                        |
| Custom field, `date`, nhiều giá trị | Trường `UF_CRM_*` nhận đúng giá trị; Bitrix24 nhận `2026-10-08`; email và số điện thoại thứ hai được thêm vào lead                  |
| HTTP, lịch, cột ẩn                  | `POST /lead-sync/runs` trả 202; lần chạy theo cron xuất hiện đúng đầu phút; hai cột kỹ thuật được ẩn                                |
| Hiệu năng 150 hàng                  | 150 lead trong 22,2 giây, 6 lô. Chạy lại: 2,6 giây                                                                                  |
| Hiệu năng 500 hàng                  | 500 lead trong 72,4 giây, 20 lô. Chạy lại: 2,3 giây. `--force`: 508 lead trong 46,6 giây. Kéo về 508 lead: 11,7 giây                |
| Đối chiếu sau 500 hàng              | 508 hàng liên kết, 508 lead trên portal, 0 chỗ lệch về giai đoạn, người phụ trách, công ty, ngân sách                               |
| Hai chiều                           | Đổi giai đoạn trong Bitrix24: Sheet đổi theo sau khoảng 5 giây; lần chạy chiều đi sau đó `skipped`                                  |
| Xung đột                            | Sửa Sheet rồi đổi lead trong Bitrix24: hàng không bị ghi đè; lần chạy chiều đi đẩy giá trị của Sheet lên                            |
| Cột `"pull": true`                  | Đổi công ty và ngân sách trong Bitrix24: hai ô của hàng đổi theo                                                                    |
| Lead tạo trong Bitrix24             | Webhook ra gửi `ONCRMLEADADD`; sau khoảng 4 giây lead thành hàng mới; không có lead trùng                                           |
| Google OAuth                        | Cấp quyền, đọc và ghi Sheet bằng refresh token, chạy cả hai chiều                                                                   |
| Incoming và outgoing webhook        | Chạy thử, cập nhật, real-time đều đạt; token lạ nhận 403                                                                            |
| Trang quản trị                      | 75 lần chạy chia 8 trang; chi tiết lần chạy 500 hàng mở trong khoảng 0,1 giây                                                       |
| Smoke test                          | 22 kiểm tra đạt: trang, phân quyền, kết nối, hai chiều đồng bộ, không dội ngược                                                     |
| Docker                              | Bản production build được và khởi động được                                                                                         |

Không gặp rate limit trong các lần chạy trên. Việc thử lại khi gặp rate limit và timeout có test tự động, chưa xảy ra trên hệ thống thật. Nhánh tra người phụ trách thành công bằng `user.get` cũng mới có test tự động, vì portal thử chỉ cấp quyền `crm`. Lệnh `pnpm seed:leads --clear` mới có test tự động.

Quan sát về Bitrix24: sau khoảng 900 lời gọi trong vài giây, portal trả `FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN` cho mọi lời gọi trong khoảng 20 phút rồi tự hoạt động lại. Tài liệu của Bitrix24 không mô tả cơ chế này.

Kiểm thử tự động: `pnpm check` chạy lint, kiểm tra kiểu, unit test và e2e. `pnpm test:cov` áp ngưỡng 70% cho `lead-sync` và `google-sheets`.

## 10. Giới hạn

- Chiều về không gồm email, số điện thoại, ngày tháng và tiêu đề lead.
- Lead tạo trong Bitrix24 lúc ứng dụng không nhận được sự kiện không được thêm vào Sheet về sau; kéo tay chỉ cập nhật hàng đã liên kết.
- Chưa biết `crm.duplicate.findbycomm` có trả lead đã chuyển đổi hoặc đã xóa hay không.
- Khóa một-lần-chạy nằm trong SQLite: server và CLI phải dùng chung file dữ liệu. Nhiều container với volume riêng không được hỗ trợ.

## 11. Tham khảo trong repo

| Nội dung                                         | Vị trí                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| Điều phối, hàm thuần, API, lịch, hai chiều, seed | `src/modules/lead-sync/`                                                      |
| Xác thực và gọi Google Sheets                    | `src/modules/google-sheets/`                                                  |
| Gọi REST, batch, giới hạn tốc độ Bitrix24        | `src/modules/bitrix/`                                                         |
| Lệnh CLI                                         | `src/cli/lead-sync.ts`, `src/cli/lead-sheet-seed.ts`                          |
| Trang quản trị                                   | `public/lead-sync.html`, `public/js/lead-sync.js`, `public/css/lead-sync.css` |
| Mapping mặc định                                 | `config/mapping.json`                                                         |
| Dữ liệu mẫu                                      | `samples/leads-template.csv`, `samples/leads-150.csv`                         |
| Bản rút gọn                                      | `Readme.txt`, mục 15                                                          |
