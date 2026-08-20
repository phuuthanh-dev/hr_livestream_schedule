# Schedule Rule Matrix

Ngày cập nhật: `2026-08-16`

## Cách đọc

- `App Script`: logic đang có trong `appscript/Schedule.gs`
- `Website`: logic đang có trong `lib/scheduleGeneration.ts`, `lib/scheduleEngine.ts`, `lib/scheduleStore.ts`
- `Khuyến nghị`: hướng nên chốt

## Matrix

| Nhóm | Rule | App Script hiện tại | Website hiện tại | Gap | Khuyến nghị |
|---|---|---|---|---|---|
| Input | Source chính để tạo lịch | `LIVE STREAM/ SCHEDULE` sheet | `schedule_people` + `schedule_availability_slots` | Rất lớn | Chốt `Website/MongoDB` làm master |
| Input | Candidate host/support đến từ đâu | đọc từ row sheet và candidate pool | build từ availability | Lớn | Giữ website |
| Host | Active filter | ngầm qua master + map | `active !== false` | Nhỏ | Giữ website |
| Host | Training | không phải trọng tâm hard filter trong schedule sheet flow | đã đổi thành priority-only | Đã gần spec mới | Giữ website |
| Host | Cast-ready / legacy readiness | có `isCastReadyHost(...)` | không dùng | Lớn | Bỏ dần khỏi website schedule |
| Host | Ưu tiên level | có candidate score | sort theo `level` | Trung bình | Giữ website nhưng cần document hóa |
| Host | Ưu tiên training | không rõ tách riêng | có training priority | Khác nhẹ | Giữ website |
| Host | Ưu tiên cash offer | có trong score | có trong sort | Tương đồng | Giữ website |
| Host | Max ca/ngày | App Script có `HOST_MAX_SLOTS_PER_DAY = 2` | website max `2 ca/ngày` | Tương đồng | Giữ website |
| Host | Fallback sau khi đụng limit | có `hostLimitRelaxedFilled` | chưa có fallback hậu xử lý tương đương | Trung bình | Port sang web nếu nghiệp vụ cần |
| Support | Model block | `SUPPORT_SHIFT_WINDOWS` cố định `06-10`, `10-14`, `14-18`, `18-22` | block từ adjacency slot | Rất lớn | Cần chốt lại một mô hình duy nhất |
| Support | Weekday 4h block | Có, theo shift window | Có, theo adjacency | Gần đúng nhưng khác implementation | Port / hợp nhất |
| Support | Weekend 6h block | Có logic đặc thù qua shift + fairness | Có `partitionStudioRun()` | Khác đáng kể | Cần port lại rõ ràng |
| Support | `_6H` handling | có nhưng gắn với window logic | có nhưng đang tạo nhiều edge case | Lớn | Refactor web support planner |
| Support | 1 support nhiều block/ngày | App Script có fairness + overflow có kiểm soát | website chặn theo `supportUsedDays` rất sớm | Lớn | Port fairness/overflow từ App Script |
| Support | Fairness theo ngày | Có `balanceSupportAssignmentsOnFinalRows` | chưa có | Lớn | Port sang web |
| Support | Smooth continuity | Có `smoothSupportSplitAssignmentsOnFinalRows` | chưa có | Lớn | Port sang web |
| Support | Backup support | Có chọn backup sau resolve | web còn nhẹ | Trung bình | Port sang web |
| Conflict | Group studio cùng slot | Có | chưa có | Lớn | Port sang web |
| Conflict | Resolve nhiều host cùng slot | Có scoring + manual review | chưa có tầng dedicated | Lớn | Port sang web |
| Conflict | Resolve nhiều support cùng slot | Có scoring + manual review | chưa có tầng dedicated | Lớn | Port sang web |
| Conflict | Manual review groups | Có | chưa có | Trung bình | Có thể giữ như admin alert trên web |
| Confirm | Confirm lock | lock theo giá trị confirm trong master sheet | lock theo boolean Mongo | Khác model | Chốt lock theo Mongo |
| Confirm | Confirm conflict resolution precedence | Có | một phần qua protected session | Trung bình | Port khi làm conflict resolver |
| Manual | Manual override | implicit trong sheet edits/resolve | explicit `manualOverride` | Website tốt hơn | Giữ website |
| Rerun | Safe rerun | App Script resolve + rewrite | website có `safe` | Tương đương một phần | Giữ website |
| Rerun | Force refresh chưa confirm | không rõ tách API | website có `refresh_unconfirmed` | Website tốt hơn | Giữ website |
| Identity | Session ID | `SS-YYYYMMDD-SLOT-HOST-SUPPORT` | `AUTO_...` + legacy mixed | Lớn | Chuẩn hóa về 1 format |
| Repair | Rebuild date/weekday | có | chưa có pipeline riêng | Trung bình | Add maintenance tools trên web |
| Repair | Rebuild Session_ID | có | chưa có migration đầy đủ | Lớn | Làm migration web-side |
| Output | Master final schedule | `Live_Session_Master_Web` + `Real_Live_Schedule` | `schedule_sessions` | Khác kiến trúc | Chốt `schedule_sessions` là final |
| Downstream | Payroll dependency | sheet-driven | Mongo-driven | Khác | Giữ website/Mongo |

## Phần nên làm trước

### Ưu tiên 1

- Support block planner
- Support fairness
- Support smoothing

Đây là vùng tạo ra nhiều case “có support availability nhưng không ra support”.

### Ưu tiên 2

- Conflict resolver theo slot/group studio
- Backup host/support generation

### Ưu tiên 3

- Session ID normalization
- Maintenance / repair tools

## Quyết định kiến trúc nên chốt

### Nên giữ

- `schedule_sessions` là final schedule
- Mongo confirm flags là nguồn khóa duy nhất
- admin actions qua API
- rerun / refresh trên web

### Nên bỏ dần

- sheet-first generation
- cast-ready legacy trong scheduler
- `Real_Live_Schedule` như bước bắt buộc để có lịch final

### Nên port

- fairness / smoothing / conflict / backup

## Hành động tiếp theo đề xuất

1. Freeze matrix này với trạng thái:
   - `keep`
   - `port`
   - `drop`
2. Refactor website engine thành nhiều module nhỏ
3. Port support planner từ `Schedule.gs`
4. Port conflict resolver
5. Chạy data migration cho `sessionId` và ca legacy
