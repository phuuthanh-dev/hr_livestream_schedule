# grade-review-sync

Program local gom kết quả chấm/review từ `livestream-host-grade-review` về sheet `Grade_Review` trong master spreadsheet `HR_STREAMING` (+ ưu/nhược điểm vào `Portfolio_Master`).

Mảnh cầu nối còn thiếu trong pipeline grade review theo transcript HR (ưu tiên #1: `grade-review-sync`).

## Lệnh

```bash
# từ project root hr_livestream_schedule — DRY-RUN mặc định
npm run sync:grade-review -- --metrics /path/to/metrics.json --out /tmp/grade-sync

# chỉ ghi thật khi đã duyệt plan
npm run sync:grade-review -- --metrics /path/to/metrics.json --apply
```

## Input

- `--metrics`: `metrics.json` do `livestream_host_grade_review` sinh ra
  (yêu cầu mỗi host có `hr_id` + `sessions_analyzed > 0`).

## Ghi gì / không ghi gì

Grade_Review (4 cột, **không đụng cột định lượng cũ**):

- `Điểm Review (Transcript)` — điểm rubric 0–100
- `Rank Review (Transcript)` — rank đề xuất S/A/B/C/Thử việc
- `Ưu Điểm` / `Nhược Điểm` — bullets từ engine (lí do up/downrank)
- Cột chưa có sẽ được thêm vào cuối header row (không insert/xoá cột cũ)

Portfolio_Master: append `Ưu điểm` / `Nhược điểm` với tag `[grade-review YYYY-MM-DD]`,
chỉ khi cột đã tồn tại (cùng policy writer `live-session-eval`).

## Policy an toàn

- Dry-run mặc định; `--apply` chỉ sau khi user duyệt `sync_plan.json`.
- Host chưa có dòng trong `Grade_Review` → **hold**, không tự append.
- Không ghi đè `Grade Đề Xuất` / `Hiệu Năng (GMV/Giờ)` / `Khuyến Nghị HR`
  (thuộc luồng định lượng `live-session-eval`).
- Chỉ ghi trong phạm vi cột/range nêu trên; không chạm sheet khác.
