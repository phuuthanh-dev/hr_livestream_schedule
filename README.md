# HR Streaming Schedule Web

Website Next.js quản lý nhân sự, lịch rảnh và lịch livestream qua Website API + MongoDB. Riêng form ứng tuyển tự tạo nhân viên và đẩy dữ liệu sang Google Sheet nguồn thông qua Apps Script API.

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
CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME
```

`ADMIN_BOOTSTRAP_PASSWORD` chỉ dùng để khởi tạo Admin lần đầu. `CLOUDINARY_URL` chỉ được dùng ở server để ký upload trực tiếp và lưu ảnh CCCD ở chế độ `authenticated`; ảnh không đi qua giới hạn request body của Vercel Function. Không commit mật khẩu, MongoDB URI hoặc khóa Cloudinary thật vào repository.

```bash
GOOGLE_APPS_SCRIPT_API_URL=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
GOOGLE_APPS_SCRIPT_API_TOKEN=copy-from-generateScheduleWebToken
GOOGLE_SOURCE_APPS_SCRIPT_API_URL=https://script.google.com/macros/s/SOURCE_DEPLOYMENT_ID/exec
GOOGLE_SOURCE_APPS_SCRIPT_API_TOKEN=copy-from-generateSourceWebToken
```

`GOOGLE_SOURCE_APPS_SCRIPT_API_URL` và `GOOGLE_SOURCE_APPS_SCRIPT_API_TOKEN` dùng cho luồng ứng tuyển tự động sang file nguồn `Thông tin Mẫu Live` / `Thông tin Support Live`. Website sẽ ưu tiên cặp biến `SOURCE`, rồi mới fallback về cặp `GOOGLE_APPS_SCRIPT_*` cũ nếu bạn chưa tách deployment.

1. lưu hồ sơ vào `people_applications`
2. tự tạo hoặc cập nhật nhân viên trong `schedule_people`
3. tự sinh mã nhân sự `HRLT..` hoặc `HRSL..`
4. gọi Apps Script `action=submit_application`
5. ghi vào tab `Thông tin Mẫu Live` hoặc `Thông tin Support Live`

Nếu bước đẩy Google Sheet lỗi, hồ sơ và nhân viên vẫn được lưu nội bộ; submit kế tiếp với cùng số điện thoại sẽ cập nhật lại và thử đồng bộ lại thay vì tạo trùng mã mới.

## Training Support Live

- Trang `/support-training` dùng checklist training cho support live.
- Checklist lấy từ SOP support live và được lưu vào `support_training_profiles`.
- Hệ thống tự chấm `rating`, suy ra `level`, `cashOffer` và cập nhật lại hồ sơ support.
- Trang quản lý nhân sự không còn nhập tay `cashOffer` hay `castStatus`; Admin chỉ cập nhật `rating/grade`, hệ thống tự chuẩn hóa `cashOffer`.
- Mapping hiện tại:
  - `A` từ `>= 90%` checklist: `Cấp 4` · `120.000`
  - `B` từ `>= 75%` checklist: `Cấp 3` · `70.000`
  - `C` từ `>= 60%` checklist: `Cấp 2` · `50.000`
  - `D` dưới `60%`: `Cấp 1` · `30.000`

## Collections

- `schedule_people`: hồ sơ Host và Support.
- `schedule_users`: tài khoản đăng nhập.
- `schedule_locations`: danh mục Home/Studio.
- `schedule_availability_weeks`: trạng thái gửi lịch rảnh theo tuần.
- `schedule_availability_slots`: từng slot rảnh đã đăng ký.
- `schedule_sessions`: lịch chính được generator website tạo.
- `schedule_sync_runs`: lịch sử mỗi lần chạy lịch tuần.
- `schedule_confirmation_events`: audit log xác nhận và hủy xác nhận.
- `people_applications`: hồ sơ ứng tuyển gửi từ trang `/apply`.
- `people_applications`: hồ sơ ứng tuyển gửi từ trang `/apply`, kèm mã nhân sự và trạng thái đồng bộ sheet.
- `employee_contract_profiles`: thông tin hợp đồng và metadata ảnh CCCD riêng tư; không chứa BHXH.

## Local Program: Contract Drive Sync

- Local program nằm ở `local_programs/contract_drive_sync/`.
- Nhiệm vụ: đọc `schedule_people`, `employee_contract_profiles`, `people_applications`, tải ảnh CCCD từ Cloudinary, và sync bundle hồ sơ nhân sự lên Google Drive mỗi 1 giờ.
- Auth Google Drive dùng phiên đăng nhập hiện tại của `gws` CLI.
- Lệnh:
  - `npm run sync:contracts:drive`
  - `npm run sync:contracts:drive -- --dry-run`
  - `npm run sync:contracts:drive:watch`
  - `npm run sync:contracts:drive:install-agent`
- Tài liệu cấu hình: `docs/local-program-contract-drive-sync.md`

## Local Program: Host Offer Sync

- Local program nằm ở `local_programs/host_offer_sync/`.
- Nhiệm vụ: đọc `Thông tin Mẫu Live`, lấy `Đánh giá level` hoặc `Rating`, đề xuất `Lương thỏa thuận`, và ghi cột H cho các row company-account đủ điều kiện.
- Auth Google Sheets dùng phiên đăng nhập hiện tại của `gws` CLI.
- Lệnh:
  - `npm run sync:offers:host`
  - `npm run sync:offers:host -- --employee-id=HRLT25`
  - `npm run sync:offers:host -- --employee-id=HRLT25 --apply`
- Tài liệu cấu hình: `docs/local-program-host-offer-sync.md`

## Local Dev

```bash
npm install
npm run dev
npm run test:schedule
npm run typecheck
npm run build
```

Dashboard chỉ gọi các Next.js server route. Trình duyệt không nhận MongoDB URI và không kết nối trực tiếp database.
