AASC ASSESSMENT - HƯỚNG DẪN CÀI ĐẶT, CẤU HÌNH VÀ CHẠY ỨNG DỤNG
================================================================

Ứng dụng NestJS (TypeScript) cho ba bài kiểm tra của AASC (đề bài nằm trong docs/):

  A. Tư duy lập trình
       - Bài 1: API quản lý Task (CRUD, validate, Swagger)
       - Bài 2: Tính số Fibonacci thứ 50 (Dynamic Programming + BigInt)
       - Bài 3: Server game - tài khoản (JWT, bcrypt), Line 98, Cờ Caro X O (WebSocket)
  B. Đánh giá API cơ bản
       - OAuth 2.0 với Bitrix24: nhận sự kiện cài đặt, lưu và tự làm mới token
       - API quản lý Contact trên Bitrix24 (kèm địa chỉ và thông tin ngân hàng)
  C. Tích hợp cơ bản
       - Biểu mẫu Jotform -> tự tạo Contact trong Bitrix24 CRM

Cả ba bài đã hoàn thành. Đây là tài liệu hướng dẫn duy nhất của dự án (dùng bảng mã UTF-8).

  Mục 1-12    Cài đặt, cấu hình, chạy và sử dụng chung; Bài A
  Mục 13      Bài B: cấu hình ngrok và Bitrix24, API Contact, lỗi đã xử lý, kết quả test
  Mục 14      Bài C: cấu hình Jotform, webhook, lỗi đã xử lý, kết quả test

Báo cáo chi tiết của Bài A nằm trong thư mục docs/tu-duy-lap-trinh/:

      bai-1-nestjs-task-api.md      Bài 1: lý thuyết NestJS, API Task, kết quả test
      bai-2-fibonacci.md            Bài 2: thuật toán, độ phức tạp, thời gian thực thi
      bai-3-server-game.md          Bài 3: tài khoản, Line 98, Cờ Caro, giao thức WebSocket


1. YÊU CẦU MÔI TRƯỜNG
---------------------
  - Node.js 24.9 trở lên   (kiểm tra: node -v)
  - pnpm 11 trở lên        (cài đặt: npm install -g pnpm   hoặc   corepack enable)
  - Không cần cài cơ sở dữ liệu: ứng dụng dùng SQLite, file dữ liệu tự tạo.
  - Hệ điều hành: Linux, macOS hoặc Windows.

  Hoặc chỉ cần Docker (có Docker Compose): xem mục 5 "CHẠY BẰNG DOCKER". Khi đó không
  cần cài Node.js và pnpm.

  Tùy chọn: GNU Make để dùng các lệnh rút gọn (xem mục 6 "MAKEFILE").

  Riêng Bài B và Bài C cần thêm:
  - ngrok (https://ngrok.com/download) để Bitrix24 và Jotform gọi được về máy (mục 13.1).
  - Một portal Bitrix24 có quyền tạo Local Application (mục 13.2).
  - Một tài khoản Jotform và API Key (mục 14.2). Máy chạy ứng dụng phải gọi ra được
    api.jotform.com (mục 14.9).


2. CÀI ĐẶT
----------
  Bước 1. Tải mã nguồn:

      git clone <địa-chỉ-repository>
      cd aasc

  Bước 2. Cài thư viện:

      pnpm install

      Lệnh này tự biên dịch thư viện native (better-sqlite3, bcrypt). Nếu gặp lỗi
      "Could not locate the bindings file", chạy:

      pnpm rebuild better-sqlite3 bcrypt

  Bước 3. Tạo file cấu hình:

      cp .env.example .env          (Windows: copy .env.example .env)


3. CẤU HÌNH (file .env)
-----------------------
  Các giá trị mặc định đủ để chạy thử trên máy cá nhân; không bắt buộc sửa.

  NODE_ENV                development | production | test         (mặc định: development)
  PORT                    Cổng HTTP                                (mặc định: 3000)
  CORS_ORIGINS            * hoặc danh sách origin cách nhau dấu phẩy   (mặc định: *)
  SWAGGER_ENABLED         Bật Swagger UI tại /docs: true | false   (mặc định: true)
  DATABASE_PATH           Đường dẫn file SQLite                    (mặc định: data/app.sqlite)
  DATABASE_SYNCHRONIZE    Tự tạo bảng từ entity: true | false      (mặc định: true)
  DATABASE_LOGGING        Ghi log câu lệnh SQL: true | false       (mặc định: false)
  JWT_SECRET              Khóa ký JWT, tối thiểu 16 ký tự.
                          BẮT BUỘC đặt giá trị riêng khi NODE_ENV=production.
  JWT_EXPIRES_IN_SECONDS  Thời hạn access token, tính bằng giây    (mặc định: 86400 = 1 ngày)
  BCRYPT_ROUNDS           Độ khó băm mật khẩu, từ 4 đến 15         (mặc định: 10)

  Bài B - Bitrix24 (để trống thì ứng dụng vẫn chạy; cách lấy giá trị: mục 13.2):

  BITRIX24_CLIENT_ID              Application ID của Local Application, dạng local.xxxx.xxxx
  BITRIX24_CLIENT_SECRET          Application key của Local Application
  BITRIX24_DOMAIN                 Hostname portal, không có https:// (vd: abc.bitrix24.vn)
  BITRIX24_REQUISITE_PRESET_ID    ID mẫu requisite dùng cho địa chỉ và ngân hàng

  Bài C - Jotform (để trống thì các endpoint /jotform trả 503; cách lấy: mục 14.2-14.4):

  JOTFORM_API_KEY                 API Key của tài khoản Jotform
  JOTFORM_FORM_ID                 Dãy số cuối URL biểu mẫu
  JOTFORM_WEBHOOK_SECRET          Chuỗi bí mật tự đặt, tối thiểu 16 ký tự
  JOTFORM_API_BASE_URL            (mặc định: https://api.jotform.com; vùng EU dùng
                                  https://eu-api.jotform.com)

  Nếu một giá trị sai định dạng, ứng dụng dừng ngay khi khởi động và in tên biến bị sai.


4. CHẠY ỨNG DỤNG
----------------
  Chế độ phát triển (tự khởi động lại khi sửa mã):

      pnpm start:dev

  Chế độ production:

      pnpm build
      pnpm start:prod

  Lưu ý: chạy lệnh tại thư mục gốc của dự án (ứng dụng đọc thư mục public/ và data/ từ đây).

  Khi khởi động thành công, màn hình in:

      Server is running on http://localhost:3000

  Các địa chỉ:

      http://localhost:3000/          Giao diện game (đăng ký, đăng nhập, Line 98, Cờ Caro)
      http://localhost:3000/docs      Swagger UI - tài liệu và thử API
      http://localhost:3000/health    Kiểm tra trạng thái ứng dụng


5. CHẠY BẰNG DOCKER
-------------------
  Yêu cầu: Docker 24 trở lên, có Docker Compose (lệnh "docker compose").

  Bước 1. Tạo file cấu hình (nếu chưa có):

      cp .env.example .env

  Bước 2. Build image và chạy container ở chế độ nền:

      docker compose up -d --build

  Bước 3. Mở http://localhost:3000 (hoặc cổng đặt ở PORT trong .env).

  Các lệnh thường dùng:

      docker compose ps                 Xem trạng thái (cột STATUS hiện "healthy" khi sẵn sàng)
      docker compose logs -f app        Xem log
      docker compose down               Dừng và xóa container, GIỮ dữ liệu
      docker compose down --volumes     Dừng và XÓA toàn bộ dữ liệu

  Ghi chú:
    - Dữ liệu SQLite nằm trong volume "aasc-data" nên không mất khi tạo lại container.
    - Container đọc cấu hình từ file .env. Bên trong container ứng dụng luôn nghe cổng 3000;
      biến PORT trong .env chỉ quyết định cổng mở ra trên máy.
    - Image mặc định NODE_ENV=production. Nếu tự chạy bằng "docker run" (không qua
      docker compose) thì phải truyền JWT_SECRET riêng, ví dụ:

          docker run -p 3000:3000 -e JWT_SECRET=mot-khoa-bi-mat-dai-hon-16-ky-tu aasc-assessment

    - Image chỉ chứa thư viện production nên không chạy được "pnpm db:seed" và các lệnh
      test bên trong container; dùng các lệnh đó ở máy có Node.js (mục 2).


6. MAKEFILE
-----------
  Nếu máy có GNU Make, có thể dùng các lệnh rút gọn. Gõ "make" để xem danh sách.

      make setup            Cài thư viện và tạo .env (lần đầu)
      make dev              Chạy chế độ phát triển
      make start            Build rồi chạy bản production
      make seed             Tạo 100 task mẫu, XÓA task hiện có (make seed COUNT=250)
      make fibonacci        Bài 2
      make test             Unit test
      make test-e2e         E2E test
      make check            Lint + typecheck + toàn bộ test
      make docker-up        Build image và chạy container
      make docker-logs      Xem log container
      make docker-ps        Xem trạng thái container
      make docker-down      Dừng container, giữ dữ liệu
      make docker-clean     Dừng container và XÓA dữ liệu


7. SỬ DỤNG
----------
  7.1. Bài 1 - API Task

      Mở http://localhost:3000/docs, nhóm "Tasks".

      Tạo dữ liệu mẫu (100 task tiếng Việt). CHÚ Ý: lệnh này XÓA toàn bộ task hiện có
      trước khi tạo:

          pnpm db:seed
          pnpm db:seed 250          (số lượng tùy chọn, từ 1 đến 10000)

      Ví dụ bằng cURL:

          curl -X POST http://localhost:3000/tasks -H "Content-Type: application/json" -d "{\"title\":\"Viet tai lieu\"}"
          curl "http://localhost:3000/tasks?page=1&limit=20"

  7.2. Bài 2 - Fibonacci

          pnpm fibonacci            In F(10), F(20), F(50) và thời gian 10 lần chạy
          pnpm test:fibonacci       Chạy bộ test

  7.3. Bài 3 - Game

      a) Mở http://localhost:3000
      b) Nhập tên đăng nhập (3-30 ký tự: chữ, số, gạch dưới) và mật khẩu (ít nhất 8 ký tự),
         bấm "Đăng ký". Tài khoản mới được đăng nhập luôn.
      c) Tùy chọn: đặt nickname và email ở khung "Tài khoản".
      d) Chọn "Line 98" hoặc "Cờ Caro X O".

      Line 98:
          Bấm vào một bóng rồi bấm vào ô trống để di chuyển. Xếp từ 5 bóng cùng màu thành
          hàng ngang, dọc hoặc chéo để xóa và ghi điểm. Sau mỗi lượt có 3 bóng mới xuất
          hiện. Nút "Trợ giúp" gợi ý một nước đi.
          Ván chơi được lưu: tải lại trang vẫn tiếp tục đúng ván đang chơi.

      Cờ Caro:
          Bấm "Tìm trận" để ghép cặp ngẫu nhiên với người chơi khác. Để thử một mình: mở
          thêm một cửa sổ ẩn danh, đăng ký tài khoản thứ hai, cả hai cùng bấm "Tìm trận".
          X đi trước; ai có 5 ký hiệu liên tiếp trước thì thắng. Lịch sử trận hiện ở bên phải.

  7.4. Bài B - Bitrix24 OAuth và API Contact:    xem mục 13.

  7.5. Bài C - Jotform -> Bitrix24:               xem mục 14.


8. DANH SÁCH API
----------------
  Tài liệu đầy đủ, kèm chức năng gọi thử, có tại http://localhost:3000/docs (Swagger UI).

      GET    /health                Trạng thái ứng dụng và kết nối cơ sở dữ liệu
      GET    /docs                  Swagger UI (khi SWAGGER_ENABLED=true)
      GET    /docs-json             Tài liệu OpenAPI dạng JSON

      POST   /tasks                 Tạo task                                  (Bài 1)
      GET    /tasks                 Danh sách task: ?page=1&limit=20&status=Done
      GET    /tasks/:id             Một task theo ID
      PATCH  /tasks/:id             Cập nhật task
      DELETE /tasks/:id             Xóa task

      GET    /                      Giao diện game                            (Bài 3)
      POST   /auth/register         Đăng ký bằng username, password
      POST   /auth/login            Đăng nhập, nhận JWT (accessToken)
      GET    /users/me              Thông tin tài khoản          (cần Bearer token)
      PATCH  /users/me              Đổi email, nickname          (cần Bearer token)
      GET    /caro/matches          Lịch sử trận Caro            (cần Bearer token)

      Socket.IO /line98             Chơi Line 98 (token gửi ở bước handshake)
      Socket.IO /caro               Chơi Cờ Caro (token gửi ở bước handshake)

      POST   /install               Bitrix24 gọi khi cài app: ONAPPINSTALL/ONAPPUPDATE   (Bài B)
      GET    /install/authorize     Chuyển sang trang ủy quyền OAuth      (cần Bearer token)
      GET    /install?code=&state=  Đổi code lấy token và lưu
      GET    /contacts              Danh sách contact: ?page=1&limit=20   (cần Bearer token)
      POST   /contacts              Tạo contact                           (cần Bearer token)
      PUT    /contacts/:id          Cập nhật contact                      (cần Bearer token)
      DELETE /contacts/:id          Xóa contact                           (cần Bearer token)

      POST   /jotform/webhook?secret=...   Jotform gọi khi có submission mới            (Bài C)
      POST   /jotform/sync          Đồng bộ lại submission bị lỡ          (cần Bearer token)

  Mọi lỗi trả về có cùng định dạng, thông báo bằng tiếng Việt:

      {
        "statusCode": 404,
        "error": "Not Found",
        "message": "Task không tồn tại",
        "path": "/tasks/0199a1b2-c3d4-7e5f-8a6b-0123456789ab",
        "timestamp": "2026-10-04T15:00:00.000Z"
      }

  "message" là một chuỗi, hoặc một danh sách chuỗi khi có nhiều lỗi validate.
  "path" và log không bao giờ chứa query string (tránh lộ token, mã OAuth).


9. KIỂM THỬ VÀ KIỂM TRA MÃ NGUỒN
---------------------------------
      pnpm test                 Unit test (Jest)
      pnpm test:e2e             E2E test: REST và WebSocket thật, SQLite trong bộ nhớ
      pnpm test:cov             Unit test kèm báo cáo coverage
      pnpm test:fibonacci       Test Bài 2
      pnpm lint                 ESLint            (pnpm lint:fix để tự sửa)
      pnpm format               Prettier          (pnpm format:check để chỉ kiểm tra)
      pnpm typecheck            Kiểm tra kiểu TypeScript
      pnpm check                Chạy tất cả: lint + typecheck + unit + e2e + Fibonacci

  Kết quả mong đợi của "pnpm check":

      Unit test:      450 passed
      E2E test:       78 passed
      Fibonacci:      29 passed

  Đo coverage cho toàn bộ unit test:

      pnpm test:cov --runInBand

  Kết quả coverage gần nhất:

      Statements:     92.17%
      Lines:          92.27%
      Functions:      93.26%
      Branches:       76.13%

  Bộ test bao phủ API Task, xác thực JWT, tài khoản người dùng, engine và gateway của Line 98
  và Cờ Caro, xác thực WebSocket, các lỗi nghiệp vụ, cùng các luồng REST/WebSocket end to end;
  OAuth và làm mới token Bitrix24, API Contact, bộ điều tiết tốc độ; ánh xạ, chống trùng và
  webhook của Jotform.

  Unit và e2e test dùng transport giả lập, không gọi mạng Bitrix24 hay Jotform. Phần tích hợp
  thật được kiểm tra bằng cURL trên portal thật; kết quả ghi ở mục 13.6 và 14.8.

  E2E test in ra ba số đo hiệu năng:
      - GET /tasks với 100 bản ghi (yêu cầu dưới 200ms)
      - 10 người chơi Caro đồng thời (yêu cầu độ trễ dưới 200ms)
      - 10 người chơi Line 98 đồng thời (yêu cầu độ trễ dưới 200ms)


10. CẤU TRÚC THƯ MỤC
--------------------
      src/
        main.ts                 Khởi động: CORS, security headers, Swagger, giao diện tĩnh
        app.module.ts           Module gốc, đăng ký pipe/filter/interceptor toàn cục
        common/                 Dùng chung toàn ứng dụng
          constants/              Hằng số phân trang
          decorators/             Swagger: ApiList, ApiDetail, ApiCreate, ApiUpdate, ApiDelete
          dto/                    PaginationQueryDto, PaginationMetaDto, ErrorResponseDto
          filters/                HttpExceptionFilter: định dạng lỗi thống nhất, ghi log
          interceptors/           LoggingInterceptor: ghi log mỗi request thành công
          messages/               createModuleMessages(): thông báo theo từng module
          pipes/                  UuidParamPipe: kiểm tra tham số :id
          types/                  PaginatedResponse, ErrorResponse
          utils/                  Ngày giờ (Temporal), tiện ích phân trang
          ws/                     Tiện ích WebSocket: toAck, GameRuleError, KeyedMutex
        config/                 Biến môi trường (validate bằng Zod), các hàm setup khi khởi động
        core/
          database/               Kết nối SQLite, BaseEntity, BaseRepository, đăng ký entity, seed
          health/                 GET /health
        modules/
          task/                   Bài 1: API Task (kèm seeders/ dùng @faker-js/faker)
          auth/                   Bài 3: đăng ký, đăng nhập, JWT guard, xác thực WebSocket
          user/                   Bài 3: tài khoản, cập nhật email và nickname
          line98/                 Bài 3: Line 98 (engine = luật chơi, service, gateway)
          caro/                   Bài 3: Cờ Caro (engine = luật chơi, ghép cặp, gateway, lịch sử)
          bitrix/                 Bài B: OAuth, lưu và làm mới token, REST client, giới hạn tốc độ
          contact/                Bài B: API Contact (contact, requisite, địa chỉ, ngân hàng)
          jotform/                Bài C: webhook, Jotform API client, ánh xạ, đồng bộ, chống trùng
      public/                   Bài 3: giao diện trình duyệt (HTML5 Canvas)
      scripts/fibonacci/        Bài 2: thuật toán, test, benchmark (JavaScript thuần)
      test/                     E2E test
      docs/                     Đề bài (PDF)
      docs/tu-duy-lap-trinh/    Báo cáo từng bài
      docs/superpowers/plans/   Tài liệu triển khai từng phần
      docs/superpowers/specs/   Tài liệu thiết kế
      Dockerfile                Image production (multi-stage, chạy bằng user không phải root)
      docker-compose.yml        Chạy container kèm volume dữ liệu
      Makefile                  Các lệnh rút gọn

  Mỗi module trong src/modules/ có cùng bố cục: controllers/ (hoặc gateways/), services/,
  repositories/, entities/, dto/, constants/, types/, messages/, decorators/, __tests__/.


11. QUY ƯỚC KHI VIẾT MÃ
-----------------------
  Dành cho người phát triển tiếp dự án.

  - Dự án là ESM: mọi import nội bộ phải có đuôi .js, kể cả qua alias
    (ví dụ './foo.service.js', '@common/utils/index.js').
  - Path alias cho import khác module: @common/*, @config/*, @core/*, @modules/*, @/*.
    Import trong cùng module dùng đường dẫn tương đối.
  - Không dùng any, không dùng enum (dùng object "as const"), không đọc process.env
    ngoài thư mục src/config/.
  - Ngày giờ dùng Temporal từ '@common/utils/index.js'; không gọi new Date() hay Date.now()
    để lấy giờ hiện tại. Dùng nowIso(), nowMs() (mili giây, cho hạn chót và khóa) hoặc
    nowDate() (cho cột datetime của TypeORM). new Date(...) chỉ xuất hiện khi đổi một giá
    trị Temporal sang Date để lưu vào cơ sở dữ liệu.
  - Thêm entity mới: khai báo tên bảng trong TABLE_NAMES, kế thừa BaseEntity, thêm class
    vào ENTITIES, tạo repository kế thừa BaseRepository. File entity và repository import
    trực tiếp base.entity.js, base.repository.js, table-names.js trong @core/database/
    (không qua @core/database/index.js, để tránh import vòng).
  - Thông báo trả về người dùng viết tiếng Việt và khai báo trong thư mục messages/ của
    module; không viết chuỗi rải rác trong service hay controller.
  - Luật chơi của game là hàm thuần trong thư mục engine/; handler của gateway luôn bọc
    trong toAck(...) để client luôn nhận được phản hồi.
  - Không đặt global prefix hay versioning (/api/v1): đề bài quy định sẵn đường dẫn.
  - Test đặt trong __tests__/ của từng module; tên test dạng
    "should <kết quả> when <điều kiện>".
  - Commit theo dạng <type>(<scope>): <subject>, với type là một trong:
    feat, fix, refactor, docs, test, chore, perf.


12. XỬ LÝ SỰ CỐ
---------------
  "Biến môi trường không hợp lệ: ... at <TÊN_BIẾN>"
      Sửa giá trị của biến đó trong file .env.

  "EADDRINUSE: address already in use :::3000"
      Cổng 3000 đang được dùng. Đổi PORT trong .env hoặc tắt chương trình đang chiếm cổng.

  "Could not locate the bindings file" (better-sqlite3 hoặc bcrypt)
      Chạy: pnpm rebuild better-sqlite3 bcrypt

  Trang game báo "Phiên đăng nhập không hợp lệ hoặc đã hết hạn"
      Đăng nhập lại. Xảy ra khi token hết hạn hoặc JWT_SECRET bị đổi.

  Muốn xóa toàn bộ dữ liệu để làm lại từ đầu
      Chạy trực tiếp: tắt ứng dụng, xóa thư mục data/, chạy lại.
      Chạy bằng Docker: docker compose down --volumes, rồi docker compose up -d.

  /contacts trả 503 "Bitrix24 chưa được cài đặt" hoặc "cần cài đặt lại ứng dụng"
      Chưa có token, hoặc refresh token không còn dùng được. Vào Bitrix24 > Developer
      resources > Integrations, mở ứng dụng và bấm Reinstall (mục 13.2).

  Bitrix24 gọi POST / và nhận 404 khi cài ứng dụng
      Đường dẫn trong form Local Application thiếu /install. Sửa cả hai trường thành
      https://<ngrok-domain>/install rồi Reinstall.

  /jotform/webhook trả 502 "Không lấy được dữ liệu từ Jotform"
      Máy không gọi ra được api.jotform.com (một số mạng chặn jotform.com). Kiểm tra bằng
      "curl https://api.jotform.com/"; nếu báo connection reset, bật VPN (ví dụ Cloudflare
      WARP: warp-cli connect). Submission bị lỡ được lưu ở trạng thái FAILED; sau khi có
      mạng, gọi POST /jotform/sync để xử lý lại.

  Container Docker thoát ngay với "Biến môi trường không hợp lệ ... at JWT_SECRET"
      Image chạy ở NODE_ENV=production nên cần JWT_SECRET riêng. Dùng docker compose
      (đọc file .env) hoặc truyền -e JWT_SECRET=... khi docker run.


13. BÀI B - ĐÁNH GIÁ API CƠ BẢN: BITRIX24 OAUTH VÀ API CONTACT
--------------------------------------------------------------
  Ứng dụng nhận sự kiện cài đặt từ Bitrix24, lưu access token và refresh token vào SQLite,
  tự làm mới token, và cung cấp REST API quản lý Contact. Secret, access token và refresh
  token chỉ nằm trong .env và SQLite, không được trả về qua API hay ghi vào log.

  13.1. Cấu hình ngrok

      ngrok http 3000

      Port phải trùng PORT trong .env. Dùng URL ở dòng "Forwarding" (ví dụ
      https://<ngrok-domain>) cho các bước bên dưới. Để URL không đổi sau mỗi lần chạy, nhận
      một domain miễn phí tại https://dashboard.ngrok.com/domains rồi chạy:

          ngrok http 3000 --url https://<ngrok-domain>

      Mở http://127.0.0.1:4040 để xem từng request Bitrix24 và Jotform gửi tới.

  13.2. Cấu hình Bitrix24

      a) Trên portal, vào Applications > Developer resources > Other > Local application,
         chọn loại Server.
      b) Điền cả "Your handler path" và "Initial installation path" là
         https://<ngrok-domain>/install (phải có /install), bật "Uses API only", cấp quyền CRM.
      c) Bấm Save. Bitrix24 hiện Application ID và Application key, đồng thời gọi
         POST /install với sự kiện ONAPPINSTALL.
      d) Điền .env rồi khởi động lại server:

             BITRIX24_CLIENT_ID              Application ID, dạng local.xxxx.xxxx
             BITRIX24_CLIENT_SECRET          Application key
             BITRIX24_DOMAIN                 Hostname portal, không có https://
             BITRIX24_REQUISITE_PRESET_ID    ID mẫu requisite cho cá nhân (thường là mẫu
                                             "Person"), tra bằng crm.requisite.preset.list

      e) Vào Developer resources > Integrations, mở ứng dụng và bấm Reinstall để cài lại
         với cấu hình đầy đủ.

  13.3. Dữ liệu Contact

      Contact gồm name (bắt buộc), phone, email, website,
      address { ward, district, province } và bank { bankName, accountNumber }.

      Phía Bitrix24, contact dùng crm.item.* với entityTypeId: 3 (các lệnh crm.contact.* đã bị
      Bitrix24 đánh dấu deprecated); thông tin ngân hàng dùng crm.requisite.* và
      crm.requisite.bankdetail.*; địa chỉ dùng crm.address.*.

      Mọi route /contacts cần header "Authorization: Bearer <JWT>"; JWT lấy từ POST /auth/login.

      Tạo contact mẫu (đề bài yêu cầu ít nhất 3 contact có đủ tên, địa chỉ, số điện thoại,
      email, website và thông tin ngân hàng). Tạo qua chính API này để dữ liệu nằm đúng chỗ
      mà GET /contacts đọc lại; gọi 3 lần với dữ liệu khác nhau:

          curl -X POST $B/contacts -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
            -d '{"name":"Nguyễn Văn An","phone":"+84901234567","email":"an.nguyen@example.com","website":"https://an-nguyen.example.com","address":{"ward":"Phường Bến Nghé","district":"Quận 1","province":"TP Hồ Chí Minh"},"bank":{"bankName":"Vietcombank","accountNumber":"0123456789"}}'

      Cũng có thể tạo trong giao diện Bitrix24 (CRM > Liên hệ > Tạo), với điều kiện địa chỉ
      và thông tin ngân hàng nằm trong mục Chi tiết (requisite) dùng mẫu có ID bằng
      BITRIX24_REQUISITE_PRESET_ID; contact tạo với mẫu khác sẽ không hiện địa chỉ và ngân
      hàng qua API.

  13.4. Quản lý token

      - Trước mỗi lần gọi Bitrix24, token được làm mới nếu còn dưới 60 giây là hết hạn.
      - Nếu Bitrix24 vẫn từ chối token (expired_token, invalid_token, NO_AUTH_FOUND), token
        được làm mới một lần rồi lệnh gọi được lặp lại.
      - Nhiều request cùng lúc chỉ sinh một lần làm mới: trong một tiến trình các request dùng
        chung một promise; giữa các tiến trình có khóa refreshLockedUntil trong SQLite.
      - Token mới chỉ được ghi nếu refresh token trong DB vẫn là cái đã dùng, nên một lần cài
        lại ứng dụng không bị kết quả làm mới cũ ghi đè.

  13.5. Các lỗi đã xử lý và cách kiểm tra

      Thiếu hoặc sai JWT
          -> 401. Kiểm tra: gọi /contacts không kèm header Authorization.
      Dữ liệu sai (email, điện thoại, thiếu tên)
          -> 400 kèm danh sách lỗi. Kiểm tra: POST /contacts với email sai định dạng.
      Contact không tồn tại
          -> 404 "Contact không tồn tại". Kiểm tra: PUT hoặc DELETE /contacts/999999.
      Access token hết hạn
          -> Tự làm mới rồi gọi lại. Kiểm tra: đợi quá 1 giờ, hoặc lùi accessTokenExpiresAt
             trong SQLite.
      Access token không hợp lệ
          -> Làm mới một lần rồi gọi lại. Kiểm tra: sửa accessToken trong SQLite thành giá
             trị sai.
      Nhiều request cùng thấy token hỏng
          -> Chỉ một lần làm mới được gửi đi. Kiểm tra: lùi accessTokenExpiresAt rồi gửi 12
             request đồng thời.
      Làm mới token thất bại
          -> 503, cần cài lại ứng dụng. Kiểm tra: dùng sai BITRIX24_CLIENT_SECRET.
      Chưa cài ứng dụng
          -> 503 "Bitrix24 chưa được cài đặt". Kiểm tra: gọi /contacts khi bảng
             bitrix_installation trống.
      Bitrix24 trả lỗi 4xx/5xx
          -> 502. Lý do gốc nằm ở dòng log BitrixApiService.
      Bitrix24 không phản hồi trong 10 giây
          -> 504.
      Gọi dồn dập vượt giới hạn tốc độ của Bitrix24 (thùng 50 request, rút 2 request/giây)
          -> Server tự xếp hàng các lệnh gọi; request phải chờ quá 8 giây nhận 429. Nếu
             Bitrix24 vẫn trả QUERY_LIMIT_EXCEEDED thì thử lại sau 0,5s, 1s, 2s.
             Kiểm tra: gửi 60 request GET /contacts đồng thời.
      Payload cài đặt thiếu trường hoặc sự kiện lạ
          -> 400, không lưu token. Kiểm tra: POST /install với auth rỗng.
      Tạo requisite, địa chỉ hoặc ngân hàng lỗi giữa chừng
          -> Xóa contact vừa tạo rồi trả lỗi.

      Mọi lỗi từ Bitrix24 được ghi log kèm tên method, thông báo, mã lỗi và HTTP status.

  13.6. Kết quả test bằng cURL

      Chạy ngày 05/10/2026 qua URL ngrok, trên portal Bitrix24 thật có sẵn 3 contact mẫu.
      $B là URL ngrok, $JWT lấy từ /auth/login:

          B=https://<ngrok-domain>
          JWT=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' \
            -d '{"username":"<user>","password":"<password>"}' \
            | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")

      a) Cài đặt. Bấm Reinstall trên Bitrix24; ngrok ghi nhận:

          POST /install  200 OK   (User-Agent: Bitrix24 Webhook Engine, event=ONAPPINSTALL)
          {"status":"ok"}

      b) Không có JWT -> 401

          curl $B/contacts

          {"statusCode":401,"error":"Unauthorized","message":"Bạn cần đăng nhập để thực hiện thao tác này","path":"/contacts","timestamp":"2026-10-05T07:06:36.878Z"}

      c) Danh sách có phân trang -> 200

          curl "$B/contacts?page=1&limit=2" -H "Authorization: Bearer $JWT"

          {"data":[{"id":"13","name":"Nguyễn Văn An","phone":"+84901234567","email":"an.nguyen@example.com","website":"https://an-nguyen.example.com","address":{"ward":"Phường Bến Nghé","district":"Quận 1","province":"TP Hồ Chí Minh"},"bank":{"bankName":"Vietcombank","accountNumber":"0123456789"}},{"id":"15","name":"Trần Thị Bình","phone":"+84912345678","email":"binh.tran@example.com","website":"https://binh-tran.example.com","address":{"ward":"Phường Dịch Vọng","district":"Quận Cầu Giấy","province":"Hà Nội"},"bank":{"bankName":"Techcombank","accountNumber":"1903456789012"}}],"meta":{"total":3,"page":1,"limit":2,"totalPages":2}}

          Trang 2 (page=2&limit=2) trả contact còn lại, "Lê Hoàng Cường", với cùng meta.total là 3.

      d) Tạo contact -> 201

          curl -X POST $B/contacts -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
            -d '{"name":"Phạm Thị Dung","phone":"+84934567890","email":"dung.pham@example.com","website":"https://dung-pham.example.com","address":{"ward":"Phường Tân Định","district":"Quận 1","province":"TP Hồ Chí Minh"},"bank":{"bankName":"ACB","accountNumber":"2468013579"}}'

          {"id":"19","name":"Phạm Thị Dung","phone":"+84934567890","email":"dung.pham@example.com","website":"https://dung-pham.example.com","address":{"ward":"Phường Tân Định","district":"Quận 1","province":"TP Hồ Chí Minh"},"bank":{"bankName":"ACB","accountNumber":"2468013579"}}

      e) Cập nhật điện thoại và ngân hàng -> 200

          curl -X PUT $B/contacts/19 -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
            -d '{"phone":"+84939999999","bank":{"bankName":"MB Bank","accountNumber":"1122334455"}}'

          {"id":"19","name":"Phạm Thị Dung","phone":"+84939999999","email":"dung.pham@example.com","website":"https://dung-pham.example.com","address":{"ward":"Phường Tân Định","district":"Quận 1","province":"TP Hồ Chí Minh"},"bank":{"bankName":"MB Bank","accountNumber":"1122334455"}}

      f) Dữ liệu sai -> 400, mỗi trường một thông báo

          curl -X POST $B/contacts -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
            -d '{"phone":"abc","email":"khong-phai-email","website":"ftp://x","address":{"ward":"W","district":"","province":"P"},"bank":{"bankName":"B"}}'

          {"statusCode":400,"error":"Bad Request","message":["Tên là bắt buộc và không được vượt quá 255 ký tự","Số điện thoại không hợp lệ","Email không hợp lệ","Website phải là URL http hoặc https hợp lệ","address.Quận/huyện là bắt buộc","bank.Số tài khoản là bắt buộc"],"path":"/contacts","timestamp":"2026-10-05T07:28:33.215Z"}

      g) Email sai khi cập nhật -> 400

          curl -X PUT $B/contacts/21 -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"email":"sai"}'

          {"statusCode":400,"error":"Bad Request","message":["Email không hợp lệ"],"path":"/contacts/21","timestamp":"2026-10-05T07:28:33.374Z"}

      h) Contact không tồn tại -> 404

          curl -X PUT $B/contacts/999999 -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"name":"X"}'

          {"statusCode":404,"error":"Not Found","message":"Contact không tồn tại","path":"/contacts/999999","timestamp":"2026-10-05T07:06:43.401Z"}

      i) Xóa contact -> 204, xóa lần hai -> 404

          curl -X DELETE $B/contacts/19 -H "Authorization: Bearer $JWT"      (204, không có body)
          curl -X DELETE $B/contacts/19 -H "Authorization: Bearer $JWT"

          {"statusCode":404,"error":"Not Found","message":"Contact không tồn tại","path":"/contacts/19","timestamp":"2026-10-05T07:06:45.453Z"}

      k) Làm mới token

          Lùi accessTokenExpiresAt trong SQLite về quá khứ rồi gọi GET /contacts: trả 200, cặp
          access/refresh token trong bảng bitrix_installation được thay mới. Sửa accessToken
          thành giá trị sai rồi gọi lại: Bitrix24 trả invalid_token, server làm mới token và
          vẫn trả 200. Với 12 request đồng thời ở cả hai trường hợp: 12/12 trả 200.


14. BÀI C - TÍCH HỢP JOTFORM -> BITRIX24
----------------------------------------
  Khi có người gửi biểu mẫu Jotform, Jotform gọi webhook của ứng dụng. Ứng dụng đọc lại
  submission qua Jotform API rồi tạo một Contact trong Bitrix24.

  14.1. Ánh xạ trường

      Trường trên biểu mẫu    Loại trường Jotform                          Contact Bitrix24
      Họ và tên               Full Name, hoặc Short Text đầu tiên          NAME
      Số điện thoại           Phone                                        PHONE
      Email                   Email                                        EMAIL

      Trường được nhận diện theo loại, không theo nhãn, nên có thể đặt nhãn tùy ý.

  14.2. Tài khoản Jotform và API Key

      a) Đăng ký tài khoản Jotform bằng email được mời.
      b) Mở trang Account API tại https://www.jotform.com/myaccount/api (trong trang
         My Account, mục API ở menu bên trái).
      c) Bấm "Create New Key" ở góc phải. Một dòng key mới xuất hiện; bấm vào tên để đặt
         nhãn, ví dụ aasc-bitrix24.
      d) Ở cột Permissions, bấm mũi tên để chọn quyền: "Read Access" (chỉ đọc) là đủ cho ứng
         dụng; chọn "Full Access" nếu muốn đăng ký webhook bằng API ở mục 14.4.
      e) Chép key vào JOTFORM_API_KEY. Tài khoản thuộc vùng dữ liệu EU thì đặt thêm
         JOTFORM_API_BASE_URL=https://eu-api.jotform.com.

      Mỗi gói Jotform có giới hạn số lần gọi API mỗi ngày (gói miễn phí: 1000 lần, đặt lại lúc
      nửa đêm giờ EST). Mỗi submission tốn một lần gọi; mỗi lần POST /jotform/sync tốn một lần.

  14.3. Tạo biểu mẫu

      a) Create Form > Start From Scratch.
      b) Thêm ba trường và bật Required cho cả ba: Full Name (hoặc Short Text) cho Họ và tên,
         Phone cho Số điện thoại, Email cho Email.
      c) Publish. URL có dạng https://form.jotform.com/252771234567890; dãy số cuối là
         JOTFORM_FORM_ID.

  14.4. Kết nối Bitrix24 và webhook

      a) Hoàn tất mục 13.2. Tích hợp này dùng chính OAuth token của Local Application đó để
         gọi Bitrix24, nên không cần tạo thêm inbound webhook trên Bitrix24.
      b) Tự đặt một chuỗi bí mật ít nhất 16 ký tự (ví dụ: openssl rand -hex 24) và ghi vào
         JOTFORM_WEBHOOK_SECRET.
      c) Khởi động lại server, rồi đăng ký webhook bằng một trong hai cách:

         Giao diện: trong Form Builder, bấm Settings trên thanh màu cam ở đầu trang >
         Integrations ở menu bên trái > gõ "Webhooks" vào ô tìm kiếm và bấm vào biểu tượng
         Webhooks > dán URL dưới đây vào ô "Add WebHook" > bấm "Complete Integration".

             https://<ngrok-domain>/jotform/webhook?secret=<JOTFORM_WEBHOOK_SECRET>

         (Đừng nhầm với ô "Request an integration" ở cuối trang: đó là form gửi đề xuất cho
         Jotform.)

         API (cần key Full Access):

             curl -X POST "https://api.jotform.com/form/$JOTFORM_FORM_ID/webhooks" \
               -H "APIKEY: $JOTFORM_API_KEY" \
               --data-urlencode "webhookURL=https://<ngrok-domain>/jotform/webhook?secret=$JOTFORM_WEBHOOK_SECRET"

  14.5. Endpoint

      POST /jotform/webhook?secret=...    Jotform gọi khi có submission mới (secret trong URL)
      POST /jotform/sync                  Đọc 100 submission mới nhất và xử lý những bản chưa
                                          đồng bộ (cần Bearer token)

      Jotform chờ webhook tối đa 30 giây; server trả lời sau khi đã tạo xong Contact, thường
      trong 1-2 giây.

      Phản hồi của webhook:

          {"status":"synced","submissionId":"...","contactId":"..."}

      status là "synced" (vừa tạo Contact), "duplicate" (submission này đã có Contact, không
      tạo thêm) hoặc "processing" (một request khác đang xử lý).

  14.6. Nhật ký

      Mỗi submission có một dòng trong bảng SQLite jotform_submission: thời điểm nhận, trạng
      thái (PROCESSING, SYNCED, FAILED, INVALID), ID Contact và lỗi nếu có. Console ghi các
      dòng JotformSyncService: "received", "synced to Bitrix24 contact <id>", "failed: <lý do>".

  14.7. Các lỗi đã xử lý và cách kiểm tra

      Sai hoặc thiếu secret
          -> 401, không lưu. Kiểm tra: gọi webhook không kèm ?secret=.
      Chưa cấu hình JOTFORM_*
          -> 503, không lưu. Kiểm tra: bỏ trống JOTFORM_API_KEY.
      Thiếu submissionID, hoặc sai form
          -> 400, không lưu. Kiểm tra: gửi formID khác JOTFORM_FORM_ID.
      Jotform trả 401: API Key sai, hoặc submissionID không tồn tại trong tài khoản (Jotform
      trả cùng một lỗi cho cả hai)
          -> 503, lưu FAILED. Kiểm tra: đặt sai JOTFORM_API_KEY, hoặc gọi webhook với một
             submissionID bịa.
      Jotform lỗi mạng hoặc timeout
          -> 502 hoặc 504, lưu FAILED.
      Thiếu tên, điện thoại hoặc email sai
          -> 422 kèm danh sách lỗi, lưu INVALID.
      Bitrix24 lỗi, hết token, bị giới hạn tốc độ
          -> 502, 503 hoặc 429, lưu FAILED. Kiểm tra: gỡ cài đặt app Bitrix24 rồi gửi form.
      Webhook bị gửi lặp
          -> 200 "duplicate", giữ SYNCED. Kiểm tra: gọi lại webhook với cùng submissionID.

      Các bản FAILED và INVALID được xử lý lại khi Jotform gửi lại webhook hoặc khi gọi
      POST /jotform/sync.

  14.8. Kết quả test

      Chạy ngày 05/10/2026 qua URL ngrok, với Jotform thật (form "Thông tin cá nhân" gồm
      Full Name, Phone, Email, đều bắt buộc) và portal Bitrix24 thật.

      a) Gửi form trên trình duyệt. Sau khi bấm Gửi, Jotform tự gọi webhook và Contact xuất
         hiện trên Bitrix24 sau khoảng 2 giây:

          POST /jotform/webhook   200 OK   (multipart/form-data, do Jotform gửi)
          {"status":"synced","submissionId":"6670036051423673304","contactId":"31"}

          LOG [JotformSyncService] Jotform submission 6670036051423673304 received
          LOG [JotformSyncService] Jotform submission 6670036051423673304 synced to Bitrix24 contact 31
          LOG [HTTP] POST /jotform/webhook 200 +1822ms

         Webhook của Jotform mang các field formID, submissionID, rawRequest, pretty,
         formTitle, ip, username, webhookURL, type, event...; ứng dụng chỉ dùng formID và
         submissionID. Contact #31 trên Bitrix24 có tên, điện thoại và email đúng như đã nhập
         trên form.

      b) Các trường hợp còn lại dùng submission tạo bằng POST /form/{id}/submissions của
         Jotform API. Jotform không gọi webhook cho submission tạo qua API, nên các lời gọi
         webhook dưới đây do cURL gửi với cùng định dạng multipart.

          B=https://<ngrok-domain>
          W="$B/jotform/webhook?secret=<JOTFORM_WEBHOOK_SECRET>"

          # Đăng ký webhook cho form
          curl -X POST "https://api.jotform.com/form/<FORM_ID>/webhooks" -H "APIKEY: <API_KEY>" \
            --data-urlencode "webhookURL=$W"
          # {"responseCode":200,"message":"success","content":["https://<ngrok-domain>/jotform/webhook?secret=..."]}

          # Đồng bộ submission bị lỡ: đọc danh sách từ Jotform API, tạo Contact trên Bitrix24
          curl -X POST $B/jotform/sync -H "Authorization: Bearer $JWT"
          # {"total":1,"synced":1,"duplicate":0,"processing":0,"failed":0}   [200]

          # Chạy lại -> không tạo thêm Contact
          curl -X POST $B/jotform/sync -H "Authorization: Bearer $JWT"
          # {"total":1,"synced":0,"duplicate":1,"processing":0,"failed":0}   [200]

          # Webhook cho một submission mới -> đọc qua GET /submission/{id}, tạo Contact
          curl -X POST "$W" -F formID=<FORM_ID> -F submissionID=6670002009323059719 -F 'rawRequest={}'
          # {"status":"synced","submissionId":"6670002009323059719","contactId":"29"}   [200]

          # Webhook lặp cho submission đã đồng bộ
          curl -X POST "$W" -F formID=<FORM_ID> -F submissionID=6670001539329210508
          # {"status":"duplicate","submissionId":"6670001539329210508","contactId":"27"}   [200]

          # Sai secret -> 401; submissionID không tồn tại -> 503
          curl -X POST "$B/jotform/webhook?secret=sai" -F submissionID=6670002009323059719     # [401]
          curl -X POST "$W" -F formID=<FORM_ID> -F submissionID=1234567890123456789            # [503]

      c) Dữ liệu Jotform trả về cho submission và Contact tương ứng trên Bitrix24 (đọc lại qua
         GET /contacts):

          control_fullname   {"first":"Kiểm Thử","last":"Jotform"}    NAME:  Kiểm Thử Jotform
          control_phone      {"full":"(090) 111-2233"}                PHONE: (090) 111-2233
          control_email      kiemthu.jotform@example.com              EMAIL: kiemthu.jotform@example.com

      d) Log của server:

          LOG  [JotformSyncService] Jotform submission 6670001539329210508 received
          LOG  [JotformSyncService] Jotform submission 6670001539329210508 synced to Bitrix24 contact 27
          LOG  [JotformSyncService] Jotform sync finished: {"total":1,"synced":1,"duplicate":0,"processing":0,"failed":0}
          WARN [JotformSyncService] Jotform submission 6670001539329210508 already synced to contact 27

         Dòng tương ứng trong bảng jotform_submission: status = SYNCED, bitrixContactId = 27,
         có createdAt (lúc nhận) và syncedAt (lúc tạo xong Contact).

  14.9. Lưu ý khi chạy ở mạng chặn jotform.com

      Server phải gọi ra được api.jotform.com. Nếu "curl https://api.jotform.com/" báo
      connection reset, bật VPN (ví dụ Cloudflare WARP: warp-cli connect) trước khi chạy. Khi
      không tới được Jotform, webhook trả 502 và submission được lưu ở trạng thái FAILED để
      POST /jotform/sync xử lý lại sau.


15. BÀI D - ĐỒNG BỘ LEAD TỪ GOOGLE SHEETS SANG BITRIX24
-------------------------------------------------------
  Team sales nhập khách hàng tiềm năng vào một Google Sheet. Ứng dụng đọc Sheet theo lịch
  (hoặc khi được yêu cầu), tạo hoặc cập nhật Lead trong Bitrix24, rồi ghi kết quả vào chính
  hàng đó. Chạy lại bao nhiêu lần cũng không tạo lead trùng.

  15.1. Kiến trúc

      Google Sheet --đọc--> lead-sync (NestJS) --batch: tìm trùng, add/update--> Bitrix24
           ^                     |
           +--ghi kết quả--------+--> SQLite: nhật ký lần chạy, khóa "mỗi lúc một lần chạy"

      - Sheet là nơi giữ trạng thái từng hàng (Lead ID, Sync Hash). SQLite chỉ giữ nhật ký.
      - Mỗi lần chạy xử lý từng lô 25 hàng: tìm trùng -> ghi Bitrix24 -> ghi lại Sheet.
      - Mã nguồn: src/modules/lead-sync (điều phối, hàm thuần), src/modules/google-sheets
        (xác thực, gọi Google), src/modules/bitrix (gọi REST, batch, giới hạn tốc độ).

  15.2. Chuẩn bị Google

      a) Vào https://console.cloud.google.com, tạo project, bật "Google Sheets API".
      b) IAM & Admin -> Service Accounts -> Create service account. Mở service account vừa
         tạo -> Keys -> Add key -> JSON. Lưu file thành secrets/google-sa.json (thư mục
         secrets/ không được commit).
      c) Tạo Google Sheet: File -> Import -> Upload samples/leads-template.csv. Đổi tên tab
         thành "Leads".
      d) Bấm Share, dán email của service account (trường client_email trong file JSON),
         chọn quyền Editor.
      e) Chép chuỗi giữa /d/ và /edit trong URL của Sheet vào GOOGLE_SHEET_ID.

      Cách khác, dùng OAuth 2.0 của một tài khoản Google thay cho service account:
      a) APIs & Services -> Credentials -> Create credentials -> OAuth client ID, loại
         "Web application"; thêm Authorized redirect URI
         http://localhost:3000/google/oauth/callback (hoặc https://<ngrok-domain>/...).
      b) Đặt GOOGLE_AUTH_MODE=oauth, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET và
         GOOGLE_OAUTH_REDIRECT_URI trong .env, rồi chạy ứng dụng.
      c) Đăng nhập, gọi GET /google/oauth/authorize (kèm JWT), mở "url" trả về bằng trình
         duyệt và đồng ý. Google chuyển về /google/oauth/callback; refresh token được lưu
         vào GOOGLE_OAUTH_TOKEN_FILE (mặc định secrets/google-oauth-token.json, quyền 600).
      d) Tài khoản đã đồng ý phải có quyền sửa Sheet; không cần Share cho service account.
      Khi ứng dụng OAuth còn ở chế độ thử nghiệm, tài khoản đăng nhập phải nằm trong
      "Test users" của OAuth consent screen, nếu không Google báo 403 access_denied.
      Redirect URI trong .env phải khớp từng ký tự với URI đã đăng ký, kể cả dấu / cuối.

  15.3. Chuẩn bị Bitrix24

      Cách nhanh (webhook): Bitrix24 -> Developer resources -> Other -> Inbound webhook,
      chọn quyền CRM (crm) và Users (user), chép URL vào BITRIX24_WEBHOOK_URL. URL này là
      secret. Khi biến này có giá trị, mọi lời gọi Bitrix24 của ứng dụng (kể cả API Contact
      ở mục 13) dùng webhook.

      Cách khác (OAuth): để trống BITRIX24_WEBHOOK_URL và cài ứng dụng như mục 13.

  15.4. Cấu hình (.env)

      GOOGLE_SERVICE_ACCOUNT_KEY_FILE=secrets/google-sa.json
      GOOGLE_SHEET_ID=<id của Sheet>
      GOOGLE_SHEET_NAME=Leads
      BITRIX24_WEBHOOK_URL=https://<portal>.bitrix24.com/rest/<user id>/<mã>/
      LEAD_SYNC_CRON=*/15 * * * *          (để trống là tắt lịch)

      Các biến khác (múi giờ, quốc gia mặc định, số lần retry, thời gian giữ nhật ký) có
      giá trị mặc định; xem .env.example. Khi không mount được file khóa, dùng
      GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 (lệnh: base64 -w0 secrets/google-sa.json).

  15.5. Cấu trúc Sheet

      Chín cột do người dùng nhập: Tên khách hàng, Email, Số điện thoại, Công ty,
      Nguồn lead (UTM Source), Ngân sách dự kiến, Trạng thái, Người phụ trách, Ghi chú.

      Năm cột do ứng dụng tự thêm ở lần chạy đầu:
          Trạng thái đồng bộ      Chờ xử lý | Đã đồng bộ | Lỗi
          Lead ID Bitrix24        (cột ẩn)
          Thời gian đồng bộ cuối  yyyy-MM-dd HH:mm:ss
          Thông báo lỗi           nêu cột sai và cách sửa
          Sync Hash               (cột ẩn)

      Cột được tìm theo TÊN TIÊU ĐỀ nên có thể đổi thứ tự cột. Không đổi tên tiêu đề và
      không sửa hai cột ẩn. Muốn ép đồng bộ lại một hàng: đặt "Trạng thái đồng bộ" thành
      "Chờ xử lý". Mỗi hàng cần Tên khách hàng và ít nhất Email hoặc Số điện thoại.

  15.6. Mapping (config/mapping.json)

      Mỗi phần tử của "fields" nối một cột với một trường lead:
          { "column": "Ngân sách dự kiến", "field": "opportunity", "type": "number" }

      Kiểu     Ví dụ đầu vào                         Gửi sang Bitrix24
      string   "  Nguyễn  Văn An "                   "Nguyễn Văn An"
      email    "An@Example.com "                     "an@example.com"
      phone    0901 234 567, 901234567, +84...       "+84901234567"
      number   1500000, "1.500.000 ₫", "15tr"        1500000, 1500000, 15000000
      date     08/10/2026, 2026-10-08, ô ngày       "2026-10-08" (ngày trước tháng sau;
                                                     bỏ phần giờ)
      datetime 08/10/2026 14:30, ô ngày giờ         "2026-10-08T14:30:00+07:00" (giờ theo
                                                     LEAD_SYNC_TIMEZONE nếu ô không ghi múi)
      enum     "Đang liên hệ"                        mã trong bảng "values" (IN_PROCESS)
      user     email hoặc tên người phụ trách        ID trong bảng "values", không có thì
                                                     dùng defaults.assignedById

      Ô email hoặc số điện thoại có thể chứa nhiều giá trị, ngăn bằng dấu phẩy, chấm phẩy
      hoặc xuống dòng. Giá trị đầu là khóa chống trùng; các giá trị sau được thêm vào lead.

      Trường tùy chỉnh khai báo như trường thường với tên gốc, ví dụ
      { "column": "Kênh ưa thích", "field": "UF_CRM_1700000000", "type": "string" }.
      "titleTemplate" sinh tiêu đề lead; "defaults" là giá trị gửi kèm mọi hàng.
      Sửa mapping làm mọi hàng được đồng bộ lại ở lần chạy kế tiếp; nên chạy --dry-run trước.
      Mã giai đoạn (NEW, IN_PROCESS, ...) xem bằng crm.status.list của portal.

  15.7. Chạy

      pnpm sync:leads                Chạy một lần và chờ kết quả
      pnpm sync:leads --dry-run      Chạy thử, không ghi gì vào Bitrix24 và Sheet
      pnpm sync:leads --force        Đồng bộ lại mọi hàng dù không đổi
      make sync-leads                Tương đương pnpm sync:leads

      Qua HTTP (cần JWT, xem mục 7):
          POST /lead-sync/runs  {"dryRun": false, "force": false}   -> 202 {"runId": "..."}
          GET  /lead-sync/runs/<runId>                              -> bộ đếm, các hàng lỗi
          GET  /lead-sync/runs?page=1&limit=20                      -> lịch sử
          GET  /lead-sync/status                                    -> lịch, kết nối
      409 nghĩa là đang có lần chạy khác; 503 nghĩa là chưa cấu hình đủ.

      Theo lịch: đặt LEAD_SYNC_CRON rồi chạy server (pnpm start:dev hoặc Docker).

      Docker: docker compose up -d --build. File khóa đặt ở ./secrets, mapping ở ./config
      (hai thư mục được mount vào container). Chạy tay trong container:
          docker compose run --rm app node dist/cli/lead-sync.js --dry-run

      Trang quản trị: http://localhost:3000/lead-sync.html (đăng nhập ở trang chủ trước).
          Tổng quan           Kết nối Google và Bitrix24, lịch, bộ đếm của lần chạy gần nhất.
          Lịch sử đồng bộ     Các lần chạy; bấm vào một lần để xem từng hàng và lý do lỗi.
          Mapping cột         Xem và sửa mapping (GET, PUT /lead-sync/mapping). Mapping sai bị
                              từ chối kèm lý do, file không đổi. Trong Docker thư mục config
                              được mount chỉ đọc nên phải sửa file trên máy chủ.
          "Chạy thử" là --dry-run, "Đồng bộ lại mọi hàng" là --force.

  15.8. Chống trùng và idempotency

      - Hàng chưa có Lead ID luôn được tìm trùng trước (crm.duplicate.findbycomm theo
        email, rồi số điện thoại). Tìm thấy thì cập nhật lead đó, không thì tạo mới.
      - Hàng đã có Lead ID chỉ được gửi lại khi nội dung đổi (so Sync Hash).
      - Hai hàng trỏ tới cùng một lead: hàng trên được xử lý, hàng dưới nhận
        "Trùng với hàng N".
      - Gửi batch bị timeout: ứng dụng không gửi lại nguyên lệnh mà tìm trùng lại trước,
        nên lead đã được tạo ở lần gọi trước không bị tạo lần hai.

      Đồng bộ hai chiều (LEAD_SYNC_DIRECTION=two-way):
          Chiều về chỉ gồm các cột có bảng "values" trong mapping (kiểu enum và user), tức
          Trạng thái và Người phụ trách: mã của Bitrix24 được đổi thành nhãn trong Sheet.
          Real-time    Đặt APP_PUBLIC_URL, chạy ứng dụng, gọi một lần
                       POST /lead-sync/bitrix-events/register (kèm JWT). Bitrix24 sẽ gọi
                       POST <APP_PUBLIC_URL>/lead-sync/bitrix-events mỗi khi lead đổi; các
                       sự kiện trong 2 giây được gom lại và kéo về trong một lần chạy
                       (trigger=webhook). Sự kiện được kiểm bằng application_token.
          Kéo tay      POST /lead-sync/pull (kèm JWT) kéo mọi lead đã liên kết (trigger=pull).
          Xung đột     Hàng đã bị sửa trong Sheet sau lần đồng bộ cuối (nội dung không còn
                       khớp Sync Hash) thì Sheet thắng: không ghi đè, lần chạy
                       Sheet -> Bitrix24 kế tiếp sẽ đẩy giá trị của Sheet lên. Hàng không có
                       sửa đổi chờ thì nhận giá trị của Bitrix24 và Sync Hash mới, nên thay
                       đổi không bị dội ngược thành một lần cập nhật.
          Mã không có nhãn trong mapping (ví dụ giai đoạn CONVERTED) được bỏ qua.
          Hai chiều dùng chung khóa một-lần-chạy với chiều đi; khi đang bận, sự kiện được
          thử lại mỗi 5 giây, tối đa 12 lần.

  15.9. Xử lý lỗi và giám sát

      Loại lỗi                              Ứng dụng làm gì
      Dữ liệu một hàng sai                  Hàng đó: Lỗi + lý do. Bỏ qua cho tới khi sửa.
      Bitrix24 từ chối một hàng             Như trên; các hàng khác vẫn đồng bộ.
      Rate limit, timeout, 5xx              Thử lại có backoff (LEAD_SYNC_MAX_RETRIES).
                                            Hết lượt: cả lô 25 hàng ghi Lỗi tạm thời và
                                            được thử lại ở lần chạy sau.
      OPERATION_TIME_LIMIT                  Dừng lần chạy (aborted), hàng còn lại: Chờ xử lý.
      Sai khóa, Sheet chưa share, mapping sai   Lần chạy kết thúc failed kèm việc cần làm.

      Log của server có một dòng mở đầu, một dòng mỗi lô, một dòng tổng kết:
          Lead sync <runId> finished: total=120 created=30 updated=10 skipped=78 failed=2 duration=14.2s
      và một dòng error cho mỗi hàng lỗi (số hàng, bước, mã lỗi, thông báo). Log và nhật ký
      không chứa email, số điện thoại hay tên khách hàng. Nhật ký trong SQLite giữ
      LEAD_SYNC_LOG_RETENTION_DAYS ngày (mặc định 30).

      Sự cố thường gặp:
        "Google từ chối truy cập"          Chưa share Sheet quyền Editor cho service account.
        "không có worksheet tên ..."       Sai GOOGLE_SHEET_NAME.
        "Sheet không có cột ..."           Tiêu đề cột trong Sheet khác với mapping.json.
        "Bitrix24 không có trường lead"    Sai tên trường trong mapping; xem crm.item.fields.
        "chế độ CRM đơn giản"              Portal tắt Lead nên lead mới bị tự chuyển thành Deal
                                           và Contact; bật CRM cổ điển trong cài đặt CRM.
        "Lead không còn tồn tại"           Lead bị xóa bên Bitrix24; xóa ô Lead ID để tạo lại.
        Nên đặt lịch ngoài giờ nhập liệu cao điểm: sắp xếp hoặc chèn hàng trong lúc đang
        chạy làm các hàng đó bị hoãn sang lần chạy sau.

  15.10. Kịch bản kiểm thử

      TC1 Tạo lead mới     Thêm một hàng, chạy pnpm sync:leads. Lead xuất hiện trong
                           Bitrix24; hàng có Lead ID, "Đã đồng bộ", thời gian.
      TC2 Cập nhật         Sửa Ngân sách, chạy lại: lead được cập nhật. Chạy lần nữa:
                           skipped tăng, không có lệnh ghi.
      TC3 Trùng lặp        Tạo sẵn lead trong Bitrix24, thêm hàng cùng email: lead cũ được
                           cập nhật, không có lead mới. Hai hàng cùng email: hàng dưới Lỗi.
      TC4 Lỗi API          Đặt sai BITRIX24_WEBHOOK_URL: lần chạy failed, không hàng nào
                           bị đổi. Ngắt mạng giữa chừng: lô đang chạy ghi Lỗi tạm thời.
      Hiệu năng            Import samples/leads-150.csv, chạy đồng bộ.

      Kiểm thử tự động: pnpm test (TC1-TC4 trong sync-runner.service.spec.ts, dùng Sheet và
      Bitrix24 giả), pnpm test:e2e (HTTP: 202, 409, 401, 503), pnpm test:cov (ngưỡng 70%
      cho lead-sync và google-sheets; hiện đạt 90,9% và 99,2% dòng).

      Số lần gọi API cho 150 hàng mới (6 lô): Bitrix24 14 lần (1 crm.settings.mode.get +
      1 crm.item.fields + 6 batch tìm trùng + 6 batch ghi), Google 9 lần đọc và 8 lần ghi.
      Lần chạy lại không có thay đổi: Bitrix24 2 lần, Google 3 lần đọc.

      Kết quả chạy thật ngày 08/10/2026, trên một Google Sheet thật (service account) và
      một portal Bitrix24 thật (OAuth, chế độ CRM cổ điển):

        TC1 Tạo mới        5 hàng mẫu: created=4, failed=1 (hàng cố ý sai email và ngân sách).
                           Giai đoạn NEW / IN_PROCESS / PROCESSED đúng theo cột Trạng thái;
                           số điện thoại mất số 0 khi import được lưu thành +84...
        Chạy lại           skipped=5, Bitrix24 không có lead mới.
        TC2 Cập nhật       Sửa ô Công ty của một hàng: updated=1, skipped=4; lead đổi theo,
                           cột "Thời gian đồng bộ cuối" của hàng đó đổi.
        TC2 Định dạng      In đậm và đổi định dạng số của ô (15000000 thành 15,000,000):
                           skipped, không có lệnh ghi.
        TC3 Trùng email    Lead tạo tay trong Bitrix24, thêm hàng cùng email: updated=1,
                           created=0, ô Lead ID nhận ID của lead tạo tay.
        TC3 Trùng số ĐT    Lead tạo tay có +84977000111, hàng ghi 0977000111: updated=1.
        TC4 Lỗi dữ liệu    Hàng sai dữ liệu ghi "Lỗi" kèm lý do; các hàng khác vẫn chạy.
        Custom field       Thêm trường UF_CRM_CAMPAIGN_CODE và một cột vào mapping: giá trị
                           lên đúng lead; đổi mapping làm mọi hàng đồng bộ lại một lần.
        HTTP               POST /lead-sync/runs trả 202 (401 khi thiếu JWT); lần chạy hiện
                           trong GET /lead-sync/runs với trigger=http.
        Lịch               LEAD_SYNC_CRON="* * * * *": lần chạy trigger=schedule xuất hiện
                           đúng đầu phút kế tiếp.
        Cột ẩn             "Lead ID Bitrix24" và "Sync Hash" ẩn, ba cột còn lại hiện.
        Hiệu năng          150 hàng mới (samples/leads-150.csv): created=150 trong 22,2
                           giây, 6 lô, 0 lần gặp rate limit. Chạy lại: skipped=150 trong
                           2,6 giây.

        Nhiều giá trị      Thêm email và số điện thoại thứ hai vào một ô: lead nhận thêm hai
                           giá trị mới, giá trị cũ giữ nguyên; chạy lại skipped.
        Hai chiều          Đổi giai đoạn của lead trong Bitrix24: sau khoảng 5 giây ô Trạng
                           thái của hàng đổi theo (trigger=webhook, updated=1); lần chạy
                           chiều đi ngay sau đó skipped, không dội ngược.
        Xung đột           Sửa ô Công ty trong Sheet rồi đổi giai đoạn lead trong Bitrix24:
                           hàng không bị ghi đè (conflicts=1); lần chạy chiều đi đẩy giá trị
                           của Sheet lên, sự kiện do chính lần chạy đó sinh ra không ghi gì.

      Chưa kiểm trên hệ thống thật: xử lý rate limit và timeout của Bitrix24 (portal có trả
      QUERY_LIMIT_EXCEEDED khi bị gọi dồn dập, nhưng các lệnh của lần đồng bộ không gặp nên
      nhánh thử lại mới có test tự động).

      Chế độ BITRIX24_WEBHOOK_URL đã chạy thật ngày 08/10/2026 với một incoming webhook
      quyền CRM: chạy thử, cập nhật một lead, chạy lại (skipped) và nhận sự kiện real-time.
      Outgoing webhook tạo tay cùng BITRIX24_OUTGOING_TOKEN cũng đã chạy thật: mỗi lần đổi
      một lead, Bitrix24 gửi hai sự kiện (của ứng dụng đã cài và của outgoing webhook), cả
      hai được chấp nhận và lead chỉ được kéo về một lần; token lạ bị trả 403.

      Google OAuth đã chạy thật ngày 08/10/2026: cấp quyền qua /google/oauth/authorize, đọc
      và ghi Sheet bằng refresh token, rồi chạy trọn chiều đi, kéo về và real-time.

      Lưu ý về Bitrix24: sau một đợt gọi dồn dập (khoảng 900 lệnh trong vài giây, do bài thử
      rate limit), portal trả FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN cho mọi lệnh trong
      khoảng 20 phút rồi tự hoạt động lại. Lỗi này vì vậy có thể là khóa tạm thời, không
      nhất thiết do gói dịch vụ.

      Hai điều rút ra khi chạy thật:
        - Portal Bitrix24 mới mặc định ở chế độ CRM đơn giản (không dùng Lead): lead vừa tạo
          bị tự chuyển thành Deal và Contact, mất giai đoạn. Ứng dụng kiểm tra chế độ này
          trước mỗi lần chạy và dừng lại; bật CRM cổ điển trong CRM > Cài đặt > Chế độ CRM.
        - File CSV import vào Google Sheets tạo tab tên mặc định (ví dụ "Untitled"), không
          phải "Leads": đổi tên tab hoặc sửa GOOGLE_SHEET_NAME.

      Video demo: <liên kết>.
