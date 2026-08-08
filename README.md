# HR Streaming Schedule Web

Website Next.js hiển thị lịch livestream theo tuần từ `Live_Session_Master`, có login/password, nút cập nhật Google Sheet, cảnh báo Studio thiếu support, support-only và confirm host/support.

## Apps Script API

1. Deploy Apps Script cùng source này lên Google Sheet master.
2. Chạy hàm `generateScheduleWebToken()` một lần trong Apps Script editor.
3. Copy token được tạo vào biến môi trường `GOOGLE_SCHEDULE_API_TOKEN`.
4. Deploy Apps Script dạng Web app, Execute as `Me`, access `Anyone with the link`.
5. Copy Web app URL vào `GOOGLE_SCHEDULE_API_URL`.

`SCHEDULE_WEB_TOKEN` không tự hết hạn. Token tồn tại trong Apps Script `Script Properties` cho đến khi bị sửa/xóa hoặc chạy lại `generateScheduleWebToken()`; mỗi lần chạy lại hàm, token cũ mất hiệu lực ngay. Phiên đăng nhập dashboard là cơ chế riêng và có thời hạn 7 ngày.

## Vercel Env

```bash
DASHBOARD_USERNAME=hr
DASHBOARD_PASSWORD=your-password
DASHBOARD_AUTH_SECRET=long-random-secret
GOOGLE_SCHEDULE_API_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
GOOGLE_SCHEDULE_API_TOKEN=token-from-generateScheduleWebToken
```

After changing Vercel environment variables, redeploy the latest deployment so the new values are loaded by the serverless API routes. If you test with a Preview URL, set the same variables for the Preview environment too.

## Local Dev

```bash
npm install
npm run dev
```

The browser never receives the Google API token. Mỗi lần chuyển tuần, dashboard gọi API một lần với đúng phạm vi `from/to`, kể cả khi quay lại tuần đã xem. Refresh và confirm vẫn đi qua Next.js API routes vì đây là các thao tác đọc/ghi dữ liệu mới.
