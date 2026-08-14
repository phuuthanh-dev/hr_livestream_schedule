# Local Program: Contract Drive Sync

## Mục tiêu

Local program này chạy trên máy local để đồng bộ bundle hồ sơ nhân sự từ MongoDB lên Google Drive mỗi 1 giờ.

Folder Drive đích mặc định:

- `1IxJs0myuunN49Z944vWzu1gr_8OqLFKv`

Link:

- [Google Drive folder](https://drive.google.com/drive/folders/1IxJs0myuunN49Z944vWzu1gr_8OqLFKv)

## Dữ liệu được sync

Nguồn:

- collection `schedule_people`
- collection `employee_contract_profiles`
- collection `people_applications`

Đầu ra trên Drive cho mỗi nhân sự:

- 1 folder con
- `person-profile.json`
- `contract-profile.json`
- `application-profile.json`
- `cv-reference.txt`
- `README.md`
- ảnh CCCD trước
- ảnh CCCD sau

## Local config riêng của program

Program này tách riêng khỏi website.

Nó dùng:

- `local_programs/contract_drive_sync/.env.local`
- `local_programs/contract_drive_sync/.env.example`

### 1. File `.env.local`

```bash
LOCAL_CONTRACT_SYNC_MONGODB_URI=
LOCAL_CONTRACT_SYNC_MONGODB_DB=hr_streaming
LOCAL_CONTRACT_SYNC_CLOUDINARY_URL=
LOCAL_CONTRACT_SYNC_FOLDER_ID=1IxJs0myuunN49Z944vWzu1gr_8OqLFKv
LOCAL_CONTRACT_SYNC_INTERVAL_MINUTES=60
LOCAL_CONTRACT_SYNC_STATE_PATH=./.state/last-sync.json
```

### 2. GWS CLI login

- Program gọi trực tiếp `gws drive files ...`, không tự giữ thêm Google auth riêng.
- Đăng nhập 1 lần trên máy local:

```bash
gws auth login -s drive
```

- Có thể kiểm tra phiên hiện tại:

```bash
gws auth status
```

### 3. Quyền vào Google Drive

- Tài khoản đang đăng nhập bằng `gws` phải có quyền vào folder Drive đích.
- Program không cần `LOCAL_CONTRACT_SYNC_GWS_CLIENT_EMAIL`, `LOCAL_CONTRACT_SYNC_GWS_PRIVATE_KEY`, hoặc `LOCAL_CONTRACT_SYNC_GWS_IMPERSONATE_USER`.
- Không cần OAuth desktop app hay token file riêng của local program.

## Cách chạy

### Dry run

```bash
npm run sync:contracts:drive -- --dry-run
```

### Chạy 1 lần

```bash
npm run sync:contracts:drive
```

### Chỉ sync 1 nhân sự

```bash
npm run sync:contracts:drive -- --employee-id=HRLT25
```

### Chạy vòng lặp

```bash
npm run sync:contracts:drive:watch
```

## Cài chạy nền mỗi 1 giờ trên macOS

```bash
npm run sync:contracts:drive:install-agent
```

Sau đó:

```bash
launchctl unload ~/Library/LaunchAgents/co.delements.hr.contract-drive-sync.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/co.delements.hr.contract-drive-sync.plist
```

## State local

State mặc định:

- `local_programs/contract_drive_sync/.state/last-sync.json`

Program chỉ sync lại khi `updatedAt` của hồ sơ thay đổi.

## Ghi chú vận hành

- Ảnh CCCD được lấy từ Cloudinary private URL rồi upload lại lên Google Drive.
- Nếu `cvReference` hoặc `cvUrl` là URL tải file trực tiếp, program sẽ thử copy thêm file `cv.*`.
- Nếu CV trong Mongo chỉ là nhãn như `CV`, `Port`, `Video live` hoặc URL trả về HTML, program chỉ lưu `cv-reference.txt`.
- Nếu sửa thông tin hợp đồng hoặc đổi ảnh CCCD trên website, lần chạy sau sẽ sync lại.
- Có thể đổi folder đích bằng `LOCAL_CONTRACT_SYNC_FOLDER_ID`.
- Nếu `gws` hết phiên hoặc đổi account, hãy chạy lại `gws auth login -s drive`.
