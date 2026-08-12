# HR Streaming Schedule Web

Website Next.js quản lý nhân sự, lịch rảnh và lịch livestream hoàn toàn qua Website API + MongoDB. Luồng vận hành không đọc hoặc ghi Google Sheet.

## Luồng xếp lịch

1. Host và Support đăng ký rồi gửi lịch rảnh theo tuần.
2. Admin chọn tuần và bấm `Chạy lịch tuần`.
3. Server chỉ dùng tuần `submitted/locked` và tạo một ca cho mỗi slot có Host hoặc Support đăng ký. Slot chỉ có Support vẫn tạo ca Studio với Host trống.
4. Host được xếp theo rank, tải tuần, cash offer, tên và mã nhân viên; tối đa hai ca mỗi ngày.
5. Host `Both` mặc định Home. Ca Home không có Support; ca Studio ghép Support thành block 4 giờ, riêng Support `_6H` cuối tuần là block 6 giờ.
6. Kết quả được ghi thẳng vào `schedule_sessions` và hiển thị ngay, không có Draft/Preview/Publish riêng.
7. Chạy lại tuần chỉ thay ca tương lai chưa xác nhận. Ngày hiện tại, ngày quá khứ và ca đã xác nhận được giữ nguyên.

Nếu chưa có Host hoặc Support gửi slot rảnh trong phần còn lại của tuần, API từ chối chạy để tránh xóa nhầm lịch hiện tại. Ca thiếu Host hoặc Support vẫn được lưu với trạng thái `open` và cảnh báo tương ứng.

## Phân quyền

- Admin quản lý nhân viên qua `/api/employees`, quản lý địa điểm, xem tổng hợp lịch rảnh, chạy lịch tuần và xác nhận/hủy xác nhận ca.
- Nhân viên chỉ sửa lịch rảnh của mình và chỉ xác nhận đúng ca, vai trò, mã nhân viên được phân công.
- Nhân viên không được sửa lịch rảnh của slot đã bắt đầu hoặc thuộc quá khứ.
- Mọi session đăng nhập được kiểm tra lại với MongoDB; đổi/reset mật khẩu hoặc khóa tài khoản sẽ vô hiệu hóa cookie cũ.

## Biến môi trường

```bash
DASHBOARD_AUTH_SECRET=long-random-secret
MONGODB_URI=mongodb+srv://USER:PASSWORD@HOST/
MONGODB_DB=hr_streaming
ADMIN_BOOTSTRAP_PASSWORD=your-initial-admin-password
```

`ADMIN_BOOTSTRAP_PASSWORD` chỉ dùng để khởi tạo Admin lần đầu. Không commit mật khẩu hoặc MongoDB URI thật vào repository.

## Collections

- `schedule_people`: hồ sơ Host và Support.
- `schedule_users`: tài khoản đăng nhập.
- `schedule_locations`: danh mục Home/Studio.
- `schedule_availability_weeks`: trạng thái gửi lịch rảnh theo tuần.
- `schedule_availability_slots`: từng slot rảnh đã đăng ký.
- `schedule_sessions`: lịch chính được generator website tạo.
- `schedule_sync_runs`: lịch sử mỗi lần chạy lịch tuần.
- `schedule_confirmation_events`: audit log xác nhận và hủy xác nhận.

## Local Dev

```bash
npm install
npm run dev
npm run test:schedule
npm run typecheck
npm run build
```

Dashboard chỉ gọi các Next.js server route. Trình duyệt không nhận MongoDB URI và không kết nối trực tiếp database.
