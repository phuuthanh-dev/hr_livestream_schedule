# HR Streaming Schedule Web

Website Next.js hiển thị lịch livestream theo tuần từ MongoDB, được Admin chủ động đồng bộ từ `Live_Session_Master`. Hệ thống có đăng nhập Admin/Nhân viên, xác nhận ca theo đúng người được phân công, cảnh báo Studio thiếu support, support-only và các nút đồng bộ Google Sheet dành riêng cho Admin.

## Phân quyền

- Admin có quyền đồng bộ Sheet và xác nhận/hủy xác nhận cho Host hoặc Support Live.
- Admin dùng nút `Cập nhật nhân viên` để đồng bộ `Portfolio_Master` và `Support_Master` vào collection MongoDB `schedule_people`.
- Admin dùng nút `Cập nhật lịch` để chạy logic schedule trên Google Sheets một lần, lấy toàn bộ `Live_Session_Master` và lưu snapshot vào MongoDB.
- Nhân viên chọn vai trò và mã nhân viên từ roster `schedule_people`; website không đọc trực tiếp master Google Sheet trong luồng login.
- Nhân viên chỉ được xác nhận/hủy đúng `Session_ID`, đúng vai trò và đúng mã nhân viên được gán trên `Live_Session_Master`.
- Nhân viên mặc định chỉ thấy `Ca của tôi` và có thể chuyển sang `Tất cả ca live` khi cần.
- Quyền được kiểm tra ở cả Next.js API và Apps Script ngay trước khi ghi Sheet. `Session_ID` trùng sẽ bị từ chối để tránh sửa nhầm dòng.
- Tài khoản nhân viên chưa có mật khẩu có thể tạo mật khẩu lần đầu. Mật khẩu chỉ cần không rỗng và không vượt quá 72 byte; MongoDB chỉ lưu bcrypt hash với cost 12, không lưu mật khẩu gốc.

Lưu ý: cơ chế tự tạo mật khẩu lần đầu cho phép người biết mã nhân viên claim tài khoản chưa được tạo. Nếu cần bảo mật cao hơn, nên bổ sung mã mời do HR cấp hoặc yêu cầu Admin kích hoạt tài khoản.

## Apps Script API

1. Đồng bộ toàn bộ file trong thư mục `app_script/` vào project Apps Script gắn với Google Sheet master.
2. Chạy `generateScheduleWebToken()` một lần trong Apps Script editor.
3. Deploy Apps Script dạng Web app, Execute as `Me`, access `Anyone with the link`.
4. Copy URL `/exec` vào `GOOGLE_SCHEDULE_API_URL` và token vào `GOOGLE_SCHEDULE_API_TOKEN`.
5. Tạo deployment version mới mỗi khi thay đổi `app_script/WebApi.gs`; deployment cũ không tự nhận code mới.

Sau khi deploy Apps Script có endpoint `action=people`, đăng nhập Admin và bấm `Cập nhật nhân viên` lần đầu. Sync dùng transaction: upsert người hiện có, giữ tài khoản/mật khẩu trong `schedule_users`, và đánh dấu `active=false` đối với người không còn trong master. Một roster rỗng sẽ bị từ chối để tránh vô hiệu hóa nhầm toàn bộ nhân viên.

Sau đó bấm `Cập nhật lịch` lần đầu để khởi tạo cache MongoDB. Việc xem hoặc chuyển tuần chỉ đọc MongoDB và không gọi Apps Script. Mỗi lần Admin cập nhật lịch dùng một lượt Apps Script; mỗi lần xác nhận/hủy xác nhận dùng một lượt ghi Apps Script rồi cập nhật MongoDB, không đọc lại toàn bộ Sheet.

`SCHEDULE_WEB_TOKEN` không tự hết hạn. Token tồn tại trong Script Properties đến khi bị sửa/xóa hoặc chạy lại `generateScheduleWebToken()`; chạy lại hàm sẽ làm token cũ mất hiệu lực ngay. Phiên đăng nhập dashboard có thời hạn 7 ngày.

## MongoDB và Vercel

```bash
DASHBOARD_AUTH_SECRET=long-random-secret
GOOGLE_SCHEDULE_API_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
GOOGLE_SCHEDULE_API_TOKEN=token-from-generateScheduleWebToken
MONGODB_URI=mongodb+srv://USER:PASSWORD@HOST/
MONGODB_DB=hr_streaming
ADMIN_BOOTSTRAP_PASSWORD=your-initial-admin-password
```

`ADMIN_BOOTSTRAP_PASSWORD` chỉ dùng khi collection `schedule_users` chưa có tài khoản Admin. Lần đăng nhập Admin đầu tiên sẽ tạo bcrypt hash trong MongoDB; sau đó có thể xóa biến bootstrap khỏi Vercel và redeploy. Không commit mật khẩu hay MongoDB URI thật vào repository.

Trên MongoDB Atlas, cho phép network access từ Vercel và giới hạn quyền database user vào database ứng dụng. Sau khi thay đổi biến môi trường Vercel, phải redeploy; Preview và Production cần cấu hình riêng nếu dùng cả hai.

### Collections và quan hệ

- `schedule_people`: roster nhân viên, khóa duy nhất `personKey = role:employeeId`.
- `schedule_users`: tài khoản đăng nhập; `accountKey` của nhân viên liên kết với roster theo dạng `employee:role:employeeId`.
- `schedule_sessions`: một document cho mỗi `Session_ID`; `hostPersonKey`, `supportPersonKey` và các backup key liên kết tới `schedule_people.personKey`. Bản ghi không còn trong snapshot mới được giữ để audit nhưng chuyển `active=false`.
- `schedule_sync_runs`: lịch sử từng lần Admin cập nhật lịch; `schedule_sessions.syncBatchId` liên kết tới `schedule_sync_runs.batchId`.
- `schedule_confirmation_events`: append-only audit log; `sessionId` liên kết tới `schedule_sessions.sessionKey`, `actorAccountKey` liên kết tới `schedule_users.accountKey`.

MongoDB không ép foreign key như SQL, nên các business key được lưu trực tiếp và có unique/query index. Refresh dùng transaction, từ chối snapshot rỗng/sai ngày/trùng `Session_ID`, và dùng `confirmationRevision` để không cho refresh cũ ghi đè một confirm mới hơn.

## Local Dev

```bash
npm install
npm run dev
```

Mỗi lần chuyển tuần, dashboard gọi API Next.js đúng một lần với phạm vi `from/to`; API này chỉ query MongoDB. Trình duyệt không nhận Google API token hoặc MongoDB URI; các thao tác đọc/ghi đều đi qua Next.js server routes.
