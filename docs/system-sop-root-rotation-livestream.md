# SOP RootRotation Livestream App

## 1. Mục đích tài liệu

Tài liệu này mô tả cách hệ thống RootRotation Livestream đang lưu, đọc, đồng bộ và đối soát dữ liệu vận hành theo đúng source code hiện tại.

Phạm vi cập nhật lần này tập trung vào:

- sheet nào đang được dự án dùng thật,
- tab nào phục vụ module nào,
- luồng nào đồng bộ từ website sang sheet hoặc ngược lại,
- luồng nào đồng bộ sang Google Drive,
- ghi chú kỹ thuật về Google Sheets API và Google Drive API.

## 2. Kiến trúc dữ liệu tổng thể của dự án

### 2.1. Nguồn dữ liệu runtime chính

Trong code hiện tại, hệ thống vận hành hằng ngày chủ yếu trên:

- Website Next.js
- MongoDB

MongoDB hiện giữ dữ liệu runtime cho:

- roster nhân sự,
- lịch rảnh,
- lịch live,
- hồ sơ tuyển dụng chuẩn hóa,
- hồ sơ hợp đồng,
- bảng lương đã tính,
- log sync sheet,
- log sync Drive.

### 2.2. Nguồn dữ liệu Google Sheet đang kết nối

Hệ thống hiện đang kết nối programmatically đến 3 file Google Sheet chính:

1. File tuyển dụng + collect lịch rảnh  
   URL: [https://docs.google.com/spreadsheets/d/12WU5jM-KC9EngkA_xBS3U82KYnO-8RMwGwk9fwcGe3o/edit?usp=sharing](https://docs.google.com/spreadsheets/d/12WU5jM-KC9EngkA_xBS3U82KYnO-8RMwGwk9fwcGe3o/edit?usp=sharing)

2. File master HR / grading / session chuẩn  
   URL: [https://docs.google.com/spreadsheets/d/1x6nVWbe1v80Px4UVRYciOwFJYNdEF8f6LC4gKGbgclw/edit?gid=1442437380#gid=1442437380](https://docs.google.com/spreadsheets/d/1x6nVWbe1v80Px4UVRYciOwFJYNdEF8f6LC4gKGbgclw/edit?gid=1442437380#gid=1442437380)

3. File workspace payroll  
   URL: [https://docs.google.com/spreadsheets/d/19JJ86Hpe7tTnyjTIrJrFcli6ZbupiWIV4s235iHvsvA/edit?usp=sharing](https://docs.google.com/spreadsheets/d/19JJ86Hpe7tTnyjTIrJrFcli6ZbupiWIV4s235iHvsvA/edit?usp=sharing)

### 2.3. Ghi chú quan trọng

- Hệ thống không còn dùng cách upload file thủ công qua Shared Brain cho các file này.
- Backend gọi trực tiếp Google Sheets API bằng service account / JWT.
- Việc “sheet nào là master tuyệt đối” hiện khác nhau theo từng module; cần đọc theo từng luồng bên dưới.

## 3. Kết nối kỹ thuật với Google Sheets

### 3.1. Cách kết nối

Source code xác nhận hệ thống dùng:

- `googleapis`
- service account JWT
- scope `https://www.googleapis.com/auth/spreadsheets`

File thực thi chính:

- [googleSheets.ts](D:/HR_STREAMING/lib/googleSheets.ts)

### 3.2. Biến môi trường chính

- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_PAYROLL_SPREADSHEET_ID`

### 3.3. Ý nghĩa vận hành

- Các module sheet sync đang đọc/ghi trực tiếp bằng API.
- Không có bước upload workbook thủ công làm nguồn trung gian cho các file sheet này.

## 4. Ma trận sheet và tab đang dùng trong dự án

## 4.1. File: 2. Lịch live và support live update

URL: [https://docs.google.com/spreadsheets/d/12WU5jM-KC9EngkA_xBS3U82KYnO-8RMwGwk9fwcGe3o/edit?usp=sharing](https://docs.google.com/spreadsheets/d/12WU5jM-KC9EngkA_xBS3U82KYnO-8RMwGwk9fwcGe3o/edit?usp=sharing)

### Các tab đang có

- `Thông tin Mẫu Live`
- `Thông tin Support Live`
- `Collect lịch live chính`
- `Collect lịch sp live`
- `LIVE STREAM/ SCHEDULE`
- `Lương + commission`

### Tab nào đang dùng thật trong code

#### `Thông tin Mẫu Live`

Dùng cho:

- sync tuyển dụng Host từ sheet về website,
- sync tuyển dụng Host từ website lên sheet,
- ghi `Mã HĐ` khi tạo hợp đồng,
- host offer evaluation / salary proposal,
- map dữ liệu contract field từ sheet vào website.

Các trường contract hiện đang được map từ tab này nếu có:

- Gmail / Email
- Ngày sinh
- CCCD
- Ngày cấp
- Nơi cấp
- Thường trú
- Tạm trú
- STK
- Bank

File code chính:

- [recruitmentSheetImport.ts](D:/HR_STREAMING/lib/recruitmentSheetImport.ts)

#### `Thông tin Support Live`

Dùng cho:

- sync tuyển dụng Support từ sheet về website,
- sync tuyển dụng Support từ website lên sheet,
- ghi `Mã HĐ` khi tạo hợp đồng,
- map một phần dữ liệu contract field từ sheet vào website.

File code chính:

- [recruitmentSheetImport.ts](D:/HR_STREAMING/lib/recruitmentSheetImport.ts)

#### `Collect lịch live chính`

Dùng cho:

- import availability Host từ sheet về Mongo,
- sync tuần availability Host từ website xuống sheet,
- ghi log sync lịch rảnh.

File code chính:

- [availabilitySheetImport.ts](D:/HR_STREAMING/lib/availabilitySheetImport.ts)

#### `Collect lịch sp live`

Dùng cho:

- import availability Support từ sheet về Mongo,
- sync tuần availability Support từ website xuống sheet,
- ghi log sync lịch rảnh.

File code chính:

- [availabilitySheetImport.ts](D:/HR_STREAMING/lib/availabilitySheetImport.ts)

#### `LIVE STREAM/ SCHEDULE`

Hiện tab này có trong file, nhưng source code website hiện tại không dùng nó làm nguồn schedule runtime chính.

Ghi chú:

- Website đang tạo và publish lịch live vào MongoDB `schedule_sessions`.
- Tab này hiện phù hợp hơn với vai trò legacy / đối chiếu vận hành cũ, không phải nguồn schedule runtime chính trong app.

#### `Lương + commission`

Tab này đang có trong file nhưng source code payroll runtime hiện tại không đọc trực tiếp tab này.

## 4.2. File: HR_STREAMING_ MASTER FILE

URL: [https://docs.google.com/spreadsheets/d/1x6nVWbe1v80Px4UVRYciOwFJYNdEF8f6LC4gKGbgclw/edit?gid=1442437380#gid=1442437380](https://docs.google.com/spreadsheets/d/1x6nVWbe1v80Px4UVRYciOwFJYNdEF8f6LC4gKGbgclw/edit?gid=1442437380#gid=1442437380)

### Các tab đang có

- `Portfolio_Master`
- `Support_Master`
- `Live_Session_Master`
- `Grade_Review`
- `Base_Salary_Card`

### Tab nào đang dùng thật trong code

#### `Portfolio_Master`

Dùng cho:

- local program sync review grade host,
- đối chiếu Host ID trong payroll rules,
- tham chiếu grade / rating / strengths / weaknesses,
- downstream analysis cho host review.

Code liên quan:

- [sync_grade_review.py](D:/HR_STREAMING/local_programs/grade_review_sync/sync_grade_review.py)
- [calc_livestream_payroll.py](D:/HR_STREAMING/skills/05_payroll/livestream-payroll-rules/scripts/calc_livestream_payroll.py)

#### `Support_Master`

Dùng cho:

- đối chiếu Support ID trong payroll rules.

Code liên quan:

- [calc_livestream_payroll.py](D:/HR_STREAMING/skills/05_payroll/livestream-payroll-rules/scripts/calc_livestream_payroll.py)

#### `Live_Session_Master`

Về mặt nghiệp vụ, đây là tab session master chuẩn của file HR master.

Tuy nhiên trong source code website hiện tại:

- lịch live runtime vẫn đang vận hành trong MongoDB,
- chưa có một module sheet sync chính thức nào đọc/ghi tab này làm master runtime của app web.

Điều này có nghĩa:

- tab `Live_Session_Master` hiện là nguồn chuẩn nghiệp vụ ở lớp tài liệu / local program / đối chiếu,
- nhưng chưa phải runtime source chính của website schedule engine hiện tại.

#### `Grade_Review`

Dùng cho:

- program `grade-review-sync` để ghi kết quả review host về sheet.

Code liên quan:

- [sync_grade_review.py](D:/HR_STREAMING/local_programs/grade_review_sync/sync_grade_review.py)

#### `Base_Salary_Card`

Dùng cho:

- payroll rules của Host,
- local program review host theo grade.

Code liên quan:

- [calc_livestream_payroll.py](D:/HR_STREAMING/skills/05_payroll/livestream-payroll-rules/scripts/calc_livestream_payroll.py)
- [host_grade_review.py](D:/HR_STREAMING/local_programs/livestream_host_grade_review/host_grade_review.py)

## 4.3. File: Livestream Payroll Workspace

URL: [https://docs.google.com/spreadsheets/d/19JJ86Hpe7tTnyjTIrJrFcli6ZbupiWIV4s235iHvsvA/edit?usp=sharing](https://docs.google.com/spreadsheets/d/19JJ86Hpe7tTnyjTIrJrFcli6ZbupiWIV4s235iHvsvA/edit?usp=sharing)

### Các tab đang có

- `Host`
- `Support`
- `Bảng lươngT7`
- `Payroll_2026-08-03`
- `Payroll_2026-08-10`

### Luồng dùng trong code

Website payroll export hiện:

- không ghi vào `Host`
- không ghi vào `Support`
- không ghi vào `Bảng lươngT7`

Website sẽ tạo hoặc cập nhật động các tab theo format:

- `Payroll_yyyy-mm-dd`

Ví dụ:

- `Payroll_2026-08-03`
- `Payroll_2026-08-10`

Code liên quan:

- [payrollSheetExport.ts](D:/HR_STREAMING/lib/payrollSheetExport.ts)

## 5. Luồng đồng bộ sheet trong dự án

## 5.1. Tuyển dụng: Sheet ↔ Website

### Nguồn sheet

File:

- `2. Lịch live và support live update`

Tab:

- `Thông tin Mẫu Live`
- `Thông tin Support Live`

### Luồng `Sheet → Website`

Dùng để:

- bootstrap hồ sơ nhân sự,
- tạo hoặc cập nhật `schedule_people`,
- tạo hoặc cập nhật `recruitment_profiles`,
- map dữ liệu contract vào `employee_contract_profiles`.

### Luồng `Website → Sheet`

Dùng để:

- đẩy dữ liệu tuyển dụng đã chuẩn hóa từ website xuống lại 2 tab,
- ghi `Mã HĐ`,
- ghi đè hoặc tạo mới row nếu website đang có hồ sơ mà sheet chưa có dòng tương ứng.

### Log liên quan

Mongo collections:

- `recruitment_sheet_sync_runs`
- `recruitment_sheet_sync_conflicts`

## 5.2. Lịch rảnh: Sheet ↔ Website

### Nguồn sheet

File:

- `2. Lịch live và support live update`

Tab:

- `Collect lịch live chính`
- `Collect lịch sp live`

### Luồng `Sheet → Website`

Dùng để:

- import lịch rảnh Host / Support về MongoDB,
- tạo hoặc ghi đè tuần availability tùy policy,
- phát hiện `unknown_employee`, `import_blocked`, `force_import`, `website_overwrite`.

### Luồng `Website → Sheet`

Dùng để:

- đẩy tuần availability đã submit từ website về 2 tab collect,
- overwrite dữ liệu slot của tuần tương ứng trên sheet.

### Log liên quan

Mongo collections:

- `availability_sheet_sync_runs`
- `availability_sheet_sync_conflicts`

## 5.3. Payroll: Website → Google Sheet

### Nguồn runtime

Nguồn runtime để export payroll là:

- bảng lương đã tính trong MongoDB,
- dữ liệu lấy từ `getPayrollDashboard()`.

### Đích sheet

File:

- `Livestream Payroll Workspace`

Tab đích:

- tạo động theo tuần với format `Payroll_yyyy-mm-dd`

Ví dụ:

- `Payroll_2026-08-03`
- `Payroll_2026-08-10`

### Quy tắc export

- clear vùng cũ trên tab đích,
- ghi header + detail rows + summary rows,
- read-back để kiểm tra mismatch,
- lưu log export vào Mongo.

### Log liên quan

Mongo collection:

- `payroll_sheet_exports`

## 5.4. Grade review: Local program → Google Sheet

### Đích sheet

File:

- `HR_STREAMING_ MASTER FILE`

Tab đích:

- `Grade_Review`

Có thể append thêm nhận xét vào:

- `Portfolio_Master`

Program:

- `grade-review-sync`

## 6. Luồng Google Drive trong dự án

## 6.1. Google Drive dùng cho gì

Google Drive hiện được dùng cho 2 nhóm chính:

1. Hồ sơ hợp đồng nhân sự
2. Tài liệu sinh tự động như hợp đồng và phiếu lương

## 6.2. Root folder Drive

Root folder hồ sơ nhân sự được lấy từ:

- `GOOGLE_DRIVE_CONTRACT_FOLDER_ID`
- fallback `LOCAL_CONTRACT_SYNC_FOLDER_ID`
- fallback `GOOGLE_DRIVE_CONTRACT_ROOT_FOLDER_ID`

Nếu không có env override, code đang fallback về folder ID mặc định:

- `1IxJs0myuunN49Z944vWzu1gr_8OqLFKv`

Code:

- [googleDrive.ts](D:/HR_STREAMING/lib/googleDrive.ts)

## 6.3. Sync hồ sơ hợp đồng lên Drive

### Luồng realtime từ website

Khi lưu hồ sơ hợp đồng hoặc upload CCCD xong, API có thể gọi sync realtime lên Drive.

Code liên quan:

- [contractDriveRealtime.ts](D:/HR_STREAMING/lib/contractDriveRealtime.ts)
- [route.ts](D:/HR_STREAMING/app/api/contract-profile/route.ts)
- [route.ts](D:/HR_STREAMING/app/api/contract-profile/upload/complete/route.ts)
- [route.ts](D:/HR_STREAMING/app/api/contract-profile/sync-drive/route.ts)

### File được sync vào folder nhân sự

Trong folder mỗi nhân sự, hệ thống có thể ghi:

- `person-profile.json`
- `contract-profile.json`
- `recruitment-profile.json`
- `application-profile.json`
- `support-training-profile.json`
- `cv-reference.txt`
- `README.md`
- ảnh CCCD mặt trước
- ảnh CCCD mặt sau
- file CV remote nếu tải được

### Tên folder nhân sự

Folder nhân sự được đảm bảo theo:

- `Tên nhân sự - Mã nhân sự - role`

và gắn `appProperties.employeeId` để tìm lại đúng folder.

## 6.4. Upload ảnh CCCD

Ảnh CCCD hiện không upload thẳng vào Drive từ browser.

Luồng thực tế là:

1. Browser xin chữ ký upload
2. Ảnh được upload vào Cloudinary dạng `authenticated`
3. Backend verify asset
4. Backend sync file ảnh đó sang Google Drive

Code liên quan:

- [contractCloudinary.ts](D:/HR_STREAMING/lib/contractCloudinary.ts)
- [contractDriveRealtime.ts](D:/HR_STREAMING/lib/contractDriveRealtime.ts)

## 6.5. Google Doc hợp đồng

### Cách tạo

Hệ thống:

- copy từ Google Docs template hợp đồng,
- thay placeholder bằng dữ liệu hồ sơ,
- lưu file vào folder nhân sự trên Drive,
- ghi lại link doc vào hồ sơ contract,
- cố gắng ghi `Mã HĐ` ngược lại lên tab tuyển dụng tương ứng.

Template mặc định:

- `1NjjgR1rsqVSZH-H4do6JK8BnZPqw2pkplTpC32igzoA`

Code liên quan:

- [contractDocumentGeneration.ts](D:/HR_STREAMING/lib/contractDocumentGeneration.ts)

### Đồng bộ ngược về sheet

Sau khi tạo hợp đồng, hệ thống gọi:

- `updateRecruitmentSheetContractCode()`

Để ghi `Mã HĐ` về:

- `Thông tin Mẫu Live` nếu là Host
- `Thông tin Support Live` nếu là Support

## 6.6. Google Doc phiếu lương

### Cách tạo

Hệ thống:

- tổng hợp payroll theo người,
- copy Google Docs template phiếu lương,
- thay nội dung bằng dữ liệu thực nhận theo range ngày hoặc theo tuần,
- lưu file vào đúng folder nhân sự trên Google Drive.

Template mặc định:

- `1ykdRKfFj0UHpOgLylvAg_ly5gOZhhNfEITdcaefxjQg`

Code liên quan:

- [payrollPayslip.ts](D:/HR_STREAMING/lib/payrollPayslip.ts)

## 7. Trạng thái tích hợp theo source code hiện tại

### 7.1. Đã kết nối thật

- Google Sheets API cho sheet tuyển dụng / collect
- Google Sheets API cho payroll export
- Google Drive API cho folder hồ sơ nhân sự
- Google Docs API cho tạo hợp đồng
- Google Docs API cho tạo phiếu lương
- Cloudinary cho upload ảnh CCCD trước khi sync sang Drive

### 7.2. Đang mang tính transitional / legacy

- tab `LIVE STREAM/ SCHEDULE` chưa phải runtime source chính của website
- tab `Lương + commission` chưa phải nguồn payroll runtime trực tiếp
- `Live_Session_Master` là schema chuẩn nghiệp vụ nhưng website schedule runtime hiện vẫn đang publish vào Mongo trước

## 8. Kết luận vận hành

Nếu nhìn theo source code hiện tại, dự án đang chia dữ liệu thành 4 lớp:

1. Runtime website / MongoDB
2. Sheet tuyển dụng + collect lịch rảnh
3. HR master / grading / payroll rules
4. Google Drive cho hồ sơ và tài liệu phát sinh

Tóm tắt nhanh:

- Tuyển dụng Host/Support sync qua `Thông tin Mẫu Live` và `Thông tin Support Live`
- Lịch rảnh sync qua `Collect lịch live chính` và `Collect lịch sp live`
- Payroll export ghi ra `Livestream Payroll Workspace` dưới tab `Payroll_yyyy-mm-dd`
- Grade review local program ghi về `Grade_Review`
- Hợp đồng và phiếu lương sinh file Google Doc và lưu trong folder nhân sự trên Google Drive
