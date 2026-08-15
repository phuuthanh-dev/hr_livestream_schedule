# RootRotation Livestream HR

Website Next.js để quản lý nhân sự livestream, lịch rảnh, lịch live, tuyển dụng và hồ sơ hợp đồng trên nền `Website API + MongoDB`.

## Overview

- `Website / MongoDB` là nguồn dữ liệu chính cho roster, lịch rảnh và lịch live.
- `Google Sheet` hiện dùng cho 2 nhóm việc:
  - mirror / bootstrap dữ liệu tuyển dụng và collect lịch rảnh
  - giữ tương thích với quy trình vận hành cũ
- Form ứng tuyển tại `/apply` tự tạo hoặc cập nhật nhân sự nội bộ rồi mới đồng bộ xuống sheet nguồn.

## Main Modules

- `👥 Nhân sự`: roster Host / Support trong `schedule_people`
- `🗓️ Lịch rảnh`: nhân sự đăng ký slot rảnh theo tuần
- `🎬 Lịch live`: hệ thống chạy lịch tuần, admin có thể chỉnh tay từng ca
- `📝 Ứng tuyển`: form public + admin recruitment dashboard
- `📄 Hợp đồng`: profile hợp đồng, ảnh CCCD, metadata hồ sơ
- `📍 Địa điểm`: danh mục `Home / Studio`
- `💰 Payroll / training / review`: đang tiếp tục hoàn thiện theo từng hạng mục nghiệp vụ

## Scheduling Logic

1. Host và Support đăng ký lịch rảnh theo tuần.
2. Chỉ các tuần có trạng thái `submitted` hoặc `locked` mới được dùng để chạy lịch.
3. Khi admin bấm `Chạy lịch tuần`, hệ thống tạo trực tiếp lịch vào `schedule_sessions`.
4. Chạy lại tuần sẽ chỉ cập nhật các ca tương lai chưa xác nhận và chưa override tay.
5. Ca hiện tại, ca quá khứ, ca đã xác nhận hoặc ca admin chỉnh tay sẽ được giữ nguyên.

### Location Mapping

- `workLocation` trong `schedule_people` là field location chính của scheduler.
- Host:
  - `home` → chỉ được xếp ca `Home`
  - `studio` → chỉ được xếp ca `Studio`
  - `both` → mặc định đăng ký `Home`, admin có thể đổi từng slot sang `Studio`
- Support không có location riêng; support chỉ đi cùng ca `Studio`.

### Candidate Rules

- Host phải `active` và có `trainingStatus` hợp lệ mới được xếp.
- Host được ưu tiên theo:
  - `level / rank`
  - tải tuần hiện tại
  - `cashOffer`
  - tên / mã nhân viên
- Mỗi host tối đa `2 ca / ngày`.
- Ca `Home` không cần support.
- Ca `Studio` sẽ ghép support theo block liên tục:
  - ngày thường: block `4 giờ`
  - cuối tuần: support `_6H` cho block `6 giờ`

Nếu không còn slot rảnh hợp lệ trong phần còn lại của tuần, API sẽ từ chối chạy để tránh làm mất lịch hiện tại.

## Data Flow

### 1. Ứng tuyển → Nhân sự

1. Ứng viên gửi form tại `/apply`
2. Hệ thống lưu vào `people_applications`
3. Tự tạo hoặc cập nhật nhân sự trong `schedule_people`
4. Tự sinh mã `HRLT..` hoặc `HRSL..` nếu chưa có
5. Lưu / cập nhật `recruitment_profiles`
6. Đồng bộ xuống sheet nguồn bằng Apps Script nếu cấu hình

### 2. Nhân sự → Lịch rảnh

1. Host / Support đăng ký slot rảnh trong `/availability`
2. Dữ liệu lưu vào:
  - `schedule_availability_weeks`
  - `schedule_availability_slots`
3. Nếu tuần đã gửi, website có thể sync lại xuống 2 tab collect

### 3. Lịch rảnh → Lịch live

1. Admin xem trang `/availability/summary`
2. Bấm `Tạo lịch` hoặc `Chạy lịch tuần`
3. Engine đọc:
  - `schedule_people`
  - `schedule_availability_slots`
  - `schedule_sessions` hiện tại
4. Ghi kết quả thẳng vào `schedule_sessions`

## Permissions

- `Admin`
  - quản lý nhân sự, địa điểm, recruitment, hợp đồng
  - xem và chỉnh lịch rảnh
  - chạy lịch tuần
  - chỉnh tay host / support / location của từng ca
- `Employee`
  - chỉ sửa lịch rảnh của chính mình
  - chỉ xác nhận đúng ca được phân công
  - không sửa được slot đã bắt đầu hoặc đã ở quá khứ

Mọi phiên đăng nhập đều được kiểm tra lại với MongoDB; đổi mật khẩu hoặc khóa tài khoản sẽ làm cookie cũ mất hiệu lực.

## Collections

- `schedule_people`: roster Host / Support
- `schedule_users`: tài khoản đăng nhập
- `schedule_locations`: danh mục địa điểm hoạt động
- `schedule_availability_weeks`: trạng thái tuần lịch rảnh
- `schedule_availability_slots`: từng slot rảnh đã đăng ký
- `schedule_sessions`: lịch live chính
- `schedule_sync_runs`: lịch sử chạy lịch tuần
- `schedule_confirmation_events`: audit log xác nhận ca
- `people_applications`: hồ sơ ứng tuyển public
- `recruitment_profiles`: hồ sơ tuyển dụng chuẩn hóa để sync sheet / admin edit
- `employee_contract_profiles`: hồ sơ hợp đồng và metadata giấy tờ
- `support_training_profiles`: checklist training support
- `recruitment_sheet_sync_runs`: log sync website ↔ sheet cho tuyển dụng
- `recruitment_sheet_sync_conflicts`: conflict log tuyển dụng
- `availability_sheet_sync_runs`: log sync collect lịch rảnh
- `availability_sheet_sync_conflicts`: conflict log collect lịch rảnh

## Sync Strategy

### Tuyển dụng

- `Sheet → Website`
  - dùng để bootstrap hoặc resync dữ liệu từ 2 tab:
    - `Thông tin Mẫu Live`
    - `Thông tin Support Live`
- `Website → Sheet`
  - đẩy dữ liệu recruitment chuẩn hóa từ website xuống lại 2 tab nguồn
- Có:
  - sync log
  - conflict log
  - duplicate row detection theo `Mã nhân viên`

### Lịch rảnh

- `Sheet → Website`
  - import 2 tab collect lịch rảnh về MongoDB
- `Website → Sheet`
  - đẩy lại tuần đã gửi từ website xuống collect sheet
- Có:
  - sync log
  - conflict log

## Environment Variables

```bash
DASHBOARD_AUTH_SECRET=long-random-secret
MONGODB_URI=mongodb+srv://USER:PASSWORD@HOST/
MONGODB_DB=hr_streaming
ADMIN_BOOTSTRAP_PASSWORD=your-initial-admin-password
CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME
GOOGLE_APPS_SCRIPT_API_URL=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
GOOGLE_APPS_SCRIPT_API_TOKEN=copy-from-generateScheduleWebToken
GOOGLE_SOURCE_APPS_SCRIPT_API_URL=https://script.google.com/macros/s/SOURCE_DEPLOYMENT_ID/exec
GOOGLE_SOURCE_APPS_SCRIPT_API_TOKEN=copy-from-generateSourceWebToken
```

Ghi chú:

- `ADMIN_BOOTSTRAP_PASSWORD` chỉ dùng khi khởi tạo admin đầu tiên
- `CLOUDINARY_URL` chỉ dùng ở server để ký upload ảnh CCCD chế độ `authenticated`
- recruitment sheet sync sẽ ưu tiên cặp biến `GOOGLE_SOURCE_*`

## Local Programs

### `📁 contract_drive_sync`

Thư mục: `local_programs/contract_drive_sync/`

Mục tiêu:

- đọc dữ liệu từ MongoDB
- gom bundle hồ sơ nhân sự
- tải ảnh / file liên quan
- sync lên Google Drive theo chu kỳ

Hiện tại bundle có thể gồm dữ liệu từ:

- `schedule_people`
- `employee_contract_profiles`
- `people_applications`
- `recruitment_profiles`
- `support_training_profiles`

Artifacts sync gồm:

- `person-profile.json`
- `contract-profile.json`
- `application-profile.json`
- `recruitment-profile.json`
- `support-training-profile.json`
- `README.md`
- `cv-reference.txt`
- ảnh CCCD / CV nếu có

Lệnh:

```bash
npm run sync:contracts:drive
npm run sync:contracts:drive -- --dry-run
npm run sync:contracts:drive:watch
npm run sync:contracts:drive:install-agent
```

Tài liệu: `docs/local-program-contract-drive-sync.md`

### `📊 host_offer_sync`

Thư mục: `local_programs/host_offer_sync/`

Mục tiêu:

- đọc tab `Thông tin Mẫu Live`
- lấy `Đánh giá level` hoặc `Rating`
- đề xuất `Lương thỏa thuận`
- ghi xuống sheet khi đủ điều kiện

Lệnh:

```bash
npm run sync:offers:host
npm run sync:offers:host -- --employee-id=HRLT25
npm run sync:offers:host -- --employee-id=HRLT25 --apply
```

Tài liệu: `docs/local-program-host-offer-sync.md`

## Local Development

```bash
npm install
npm run dev
npm run typecheck
npm run test:schedule
npm run build
```

## Production Notes

- Browser không kết nối MongoDB trực tiếp; toàn bộ đi qua Next.js server routes
- Không cho tạo nhân viên tay từ admin trong production flow
- Nguồn master hiện tại là `Website / MongoDB`
- Sheet đang là lớp tương thích và đồng bộ vận hành

## Suggested Reading Order

- `docs/local-program-contract-drive-sync.md`
- `docs/local-program-host-offer-sync.md`
- `lib/scheduleEngine.ts`
- `lib/availabilityStore.ts`
- `lib/recruitmentSheetImport.ts`
- `lib/availabilitySheetImport.ts`
