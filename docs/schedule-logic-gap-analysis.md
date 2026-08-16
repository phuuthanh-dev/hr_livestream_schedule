# Schedule Logic Gap Analysis

Ngày cập nhật: `2026-08-16`

## Mục tiêu

Tài liệu này đối chiếu logic xếp lịch giữa:

- `appscript/Schedule.gs`
- website API / MongoDB:
  - `lib/scheduleGeneration.ts`
  - `lib/scheduleEngine.ts`
  - `lib/scheduleStore.ts`
  - `lib/scheduleAssignment.ts`

Mục tiêu là xác định:

1. Website đang khác App Script ở đâu
2. Phần nào là khác biệt chủ đích
3. Phần nào là lệch logic chưa được port
4. Bước tiếp theo nên làm gì để website thay thế hoàn toàn App Script

## Kết luận ngắn

Hiện tại website chưa phải là bản port 1:1 của `Schedule.gs`.

Website đang là một scheduling engine mới, đơn giản hơn và clean hơn, nhưng thiếu một số lớp logic cũ trong App Script:

- conflict resolution theo nhóm studio
- support continuity / fairness / smoothing
- backup host / backup support generation theo candidate pool
- lock semantics dựa trên dữ liệu confirm ở sheet master
- xử lý data repair sau resolve
- session identity chuẩn thống nhất với `Live_Session_Master`

Ngược lại, website đã có một số hướng mới tốt hơn:

- MongoDB là source of truth vận hành
- regenerate có bảo vệ ca quá khứ / ca confirmed / manual override
- manual assignment rõ hơn
- API hóa tốt hơn để mở đường cho payroll / sync / audit

## Quyết định chốt cho phase thay thế App Script

### Keep trên website

- MongoDB / website là source of truth cuối cùng cho lịch
- regenerate theo `safe` và `refresh_unconfirmed`
- `manualOverride` là cơ chế bảo vệ chỉnh tay chuẩn
- training chỉ là tiêu chí ưu tiên, không phải hard filter
- `Both` được hiểu là Host có thể đăng ký `Home` hoặc được Admin đẩy lên `Studio`

### Port từ App Script sang website

- support planner theo block vận hành chuẩn
- fairness phân Support theo ngày / tuần
- smoothing để tránh block support bị xé lẻ
- conflict resolver cho slot có nhiều candidate cùng lúc
- backup host / backup support
- session repair utilities cho `sessionId`, `weekday`, `date`

### Drop khỏi website scheduler

- cast-ready legacy kiểu `isCastReadyHost(...)`
- sheet-first generation
- `Real_Live_Schedule` như một bước bắt buộc mới có lịch final
- các rule phụ thuộc trực tiếp vào cột confirm / tracking cũ trong sheet master

## Hai hệ logic hiện tại

### 1. App Script

Flow chính:

1. Đọc `LIVE STREAM/ SCHEDULE` ở file nguồn
2. Sync `Portfolio_Master` và `Support_Master`
3. Unpivot dữ liệu host / support từ sheet nguồn
4. Backfill `format` theo hồ sơ host
5. Align support trong shift
6. Resolve conflict vào `Live_Session_Master`
7. Post-process:
   - host daily limit
   - support fairness
   - support smoothing
   - backup host / support
   - repair `Session_ID`, date, weekday
8. Build `Real_Live_Schedule`

### 2. Website

Flow chính:

1. Đọc `schedule_people`
2. Đọc `schedule_availability_slots`
3. Đọc `schedule_sessions` hiện có trong tuần
4. Xác định protected sessions
5. Generate lại các slot còn lại
6. Publish thẳng vào `schedule_sessions`
7. Admin có thể:
   - assign tay host / support
   - rerun an toàn
   - refresh unconfirmed

## Các điểm gap lớn

### A. Input model

`Schedule.gs`

- sheet-first
- lấy dữ liệu đã “đổ sẵn” trong lưới schedule nguồn
- một slot có thể có nhiều host/support candidate trong cùng 1 dòng hoặc nhiều dòng

Website

- availability-first
- tự build demand từ slot rảnh
- không phụ thuộc vào sheet schedule nguồn

Ý nghĩa:

- App Script đang giải quyết bài toán `resolve các proposal đã có`
- Website đang giải quyết bài toán `generate proposal từ đầu`

Đây là khác biệt nền tảng.

### B. Host gating

`Schedule.gs`

- dùng `isCastReadyHost(...)`
- phụ thuộc `Portfolio_Master`
- vẫn còn logic di sản kiểu cast / readiness

Website

- hiện tại hard filter chỉ còn `active !== false`
- `trainingStatus` đã được đổi thành priority-only
- sort theo `level -> training priority -> weekly load -> cashOffer -> name`

Ý nghĩa:

- Website đã đi gần hơn yêu cầu mới
- Nhưng chưa có lớp “business readiness” nào tương đương nếu sau này vẫn cần check khác ngoài active

### C. Support grouping

Đây là khoảng cách lớn nhất.

`Schedule.gs`

- gom Support theo `SUPPORT_SHIFT_WINDOWS` cố định
- có fairness sau khi resolve
- có smoothing để tránh pattern A-B-A giữa 3 slot liên tiếp
- có overflow có kiểm soát trước khi bỏ trống

Website

- chỉ gom theo adjacency
- chặn khá sớm bởi `supportUsedDays`
- chưa có hậu xử lý fairness
- chưa có hậu xử lý smoothing

Ý nghĩa:

- nhiều case web vẫn còn Support rảnh nhưng không được chọn
- đây là nguyên nhân chính của các case cuối tuần hoặc block dài bị thiếu support

## Kế hoạch sửa engine web theo pha

### Phase 1: Chuẩn hóa support planner

- thay `partitionStudioRun()` bằng planner theo rule block chính thức
- tách `_6H` thành nhánh planner rõ ràng thay vì nhúng trong filter
- đổi `supportUsedDays` từ hard-stop sang scoring + overflow có kiểm soát

### Phase 2: Hậu xử lý fairness / smoothing

- port `balanceSupportAssignmentsOnFinalRows(...)`
- port `smoothSupportSplitAssignmentsOnFinalRows(...)`
- thêm log nguyên nhân khi một slot bị bỏ support

### Phase 3: Conflict resolver và backup

- thêm tầng resolver nếu một lane có nhiều host candidate
- thêm backup host / support theo candidate pool
- chuẩn hóa alert `manual review` trên UI admin

### Phase 4: Identity và repair

- chuẩn hóa `sessionId`
- thêm maintenance action rebuild `sessionId / weekday / date`
- tách audit log cho các lần rerun / refresh

`Schedule.gs`

- dùng `SUPPORT_SHIFT_WINDOWS` cố định:
  - `06:00 - 10:00`
  - `10:00 - 14:00`
  - `14:00 - 18:00`
  - `18:00 - 22:00`
- có fairness theo ngày
- có overflow logic
- có smoothing để tránh support bị xé lẻ

Website

- dùng slot adjacency
- weekday chia block `4h`
- weekend chia block `6h` hoặc `4h`
- chưa có fairness / smoothing tương đương App Script

Ý nghĩa:

- Đây là gap lớn nhất đang gây nhiều case “có support availability nhưng không ra support”
- Logic website và App Script đang không cùng mô hình

### D. Conflict resolution

`Schedule.gs`

- có `computeResolvedMasterRows(...)`
- gom group studio
- resolve host conflict
- resolve support conflict
- lock theo confirm
- nếu không auto resolve được thì đánh dấu `manualReviewGroups`

Website

- không có tầng conflict resolver tương đương
- coi availability là input sạch
- chỉ có protected session và manual override

Ý nghĩa:

- Nếu muốn website thay thế hoàn toàn sheet master flow, cần port ít nhất một phần conflict resolver

### E. Confirm / lock semantics

`Schedule.gs`

- lock theo giá trị confirm trong sheet
- row confirmed được xem là truth mạnh hơn candidate khác

Website

- lock theo:
  - `isHostConfirmed`
  - `isSupportConfirmed`
  - `manualOverride`
- có thêm mode `refresh_unconfirmed` để bỏ lock của manual override chưa confirm

Ý nghĩa:

- Website có semantics vận hành rõ hơn
- Nhưng khác sheet, nên cần chốt “master lock logic” chỉ còn nằm ở Mongo

### F. Session identity

`Schedule.gs`

- `Session_ID` kiểu `SS-YYYYMMDD-SLOT-HOST-SUPPORT`
- build lại nhiều lần trong quá trình resolve

Website

- auto-generated session hiện vẫn có 2 nhóm:
  - `AUTO_...`
  - dữ liệu cũ / manual / imported từ sheet

Ý nghĩa:

- chưa có chuẩn identity thống nhất
- đây là nguồn gốc nhiều ca “lệch format”, “manual override lẫn auto”, “same slot nhưng cấu trúc khác”

### G. Backup assignments

`Schedule.gs`

- có backup host
- có backup support
- backup chọn từ candidate pool sau khi resolve row chính

Website

- backup host/support mới chỉ ở mức nhẹ
- không có hậu xử lý mạnh như App Script

### H. Repair / cleanup

`Schedule.gs`

- có hậu xử lý:
  - `rebuildScheduleSessionIdsInMaster_`
  - `rebuildLiveSessionMasterDatesAndWeekdays_`
  - normalize home assignment

Website

- chưa có một pipeline repair sâu tương đương
- mới có `refresh_unconfirmed`

## Chỗ nào nên giữ theo website

Nên giữ website là chuẩn cuối cho các phần sau:

- source of truth vận hành
- protected session logic
- admin manual assignment
- confirm state
- API-based publish flow
- payroll downstream

Lý do:

- phù hợp kiến trúc web API + MongoDB
- tách khỏi Google Sheet
- dễ audit và tự động hóa hơn

## Chỗ nào cần port từ App Script

Nên port có chọn lọc từ `Schedule.gs` sang website:

1. support continuity / smoothing
2. support fairness theo ngày
3. backup host / backup support generation
4. studio conflict resolver theo slot / group
5. canonical session identity

## Không nên port nguyên xi

Không nên bê nguyên các phần sau nếu đã chốt website làm master:

- sheet-first schedule generation
- cast-ready / cast-offer legacy
- dependency vào `Live_Session_Master` như source vận hành
- hậu xử lý sửa sheet để vá dữ liệu thay vì sửa model dữ liệu

## Phương án tiếp theo

### Giai đoạn 1: Freeze spec

Tạo rule matrix và chốt từng dòng:

- Giữ theo website
- Port từ App Script
- Bỏ hẳn

### Giai đoạn 2: Refactor engine website

Tách `lib/scheduleEngine.ts` thành các module:

- `scheduleDemandBuilder`
- `scheduleHostScoring`
- `scheduleSupportPlanner`
- `scheduleConflictResolver`
- `schedulePostProcessing`
- `schedulePublisher`

### Giai đoạn 3: Port logic support

Đây là ưu tiên cao nhất vì đang tạo nhiều gap thực tế:

- chọn block support weekday/weekend
- fairness theo ngày
- smoothing tránh split lẻ
- support `_6H` vs support thường

### Giai đoạn 4: Port logic conflict + backup

- resolve host/support conflict theo cùng slot / lane
- generate backup host/support

### Giai đoạn 5: Cleanup data model

- unify session ID
- đánh dấu rõ `engineOwned`
- migrate data cũ lệch format

## Kết luận vận hành

Nếu tiếp tục vá bug lẻ mà chưa chốt matrix logic, website sẽ còn lệch `Schedule.gs` rất lâu.

Bước đúng tiếp theo là:

1. chốt rule matrix
2. chọn website làm master tuyệt đối
3. port logic support + conflict quan trọng sang web
4. chỉ giữ App Script như reference / migration aid, không giữ vai trò chạy chính
