# HR Streaming Schedule Web

Website Next.js hiển thị lịch livestream theo tuần từ `Live_Session_Master`, có login/password, nút cập nhật Google Sheet, cảnh báo Studio thiếu support, support-only và confirm host/support.

## Apps Script API

1. Deploy Apps Script cùng source này lên Google Sheet master.
2. Chạy hàm `generateScheduleWebToken()` một lần trong Apps Script editor.
3. Copy token được tạo vào biến môi trường `GOOGLE_SCHEDULE_API_TOKEN`.
4. Deploy Apps Script dạng Web app, Execute as `Me`, access `Anyone with the link`.
5. Copy Web app URL vào `GOOGLE_SCHEDULE_API_URL`.

## Vercel Env

```bash
DASHBOARD_USERNAME=hr
DASHBOARD_PASSWORD=your-password
DASHBOARD_AUTH_SECRET=long-random-secret
GOOGLE_SCHEDULE_API_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
GOOGLE_SCHEDULE_API_TOKEN=token-from-generateScheduleWebToken
```

## Local Dev

```bash
npm install
npm run dev
```

The browser never receives the Google API token. All sheet reads, refreshes and confirm writes go through Next.js API routes.
