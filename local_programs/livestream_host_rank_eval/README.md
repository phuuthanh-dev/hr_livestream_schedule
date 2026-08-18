# livestream-host-rank-eval

Program local đánh giá host livestream theo rank `Base_Salary_Card` (sheet master HR_STREAMING).
Thuộc dự án `hr_livestream_schedule` — đặt tại `local_programs/livestream_host_rank_eval/`.

## Lệnh

```bash
# từ project root hr_livestream_schedule
npm run eval:host-rank -- \
  --raw-dir  <raw transcript root: raw/<host>/<session_ca_live>/> \
  --roster   <roster.json: HR id + rank/lương/%HH hiện tại> \
  --out      <thư mục kết quả>
```

Lưu ý: `Duration` trong `summary.md` phải ghi bằng **giây** (ví dụ `- **Duration:** 7200 (120 phút)`).

## Input

- Mỗi session folder chứa `transcript.txt` (dòng `[MM:SS - MM:SS] text`), `summary.md`
  (Start/End/Duration/Viewers), `transcript.srt`, `transcript_plain.txt`.
- Chỉ phân tích folder có `ca_live` trong tên. Session có repeat_ratio > 0.5 bị loại
  (Whisper hallucination loop).

## Rubric (7 trục)

flow 25% · chốt đơn 20% · tư vấn 15% · tương tác 15% · deal/giá 10% · sản phẩm 10% · liền mạch 5%.
Ngưỡng mật độ keyword chuẩn hóa theo p90 của cohort (không dưới floor tuyệt đối).
Rank: S≥88 · A≥72 · B≥58 · C≥45 · còn lại Thử việc. Lương/%HH theo Base_Salary_Card.

## Output

`rank_report.md`, `rank_result.csv` (UTF-8 BOM cho Excel), `metrics.json`, `calibration.json`.

## Scope

Read-only trên raw dir; chỉ ghi trong `--out`. Không ghi sheet/Drive/DB.
Registry: `local-program-standard/references/program-registry.md` → `livestream-host-rank-eval`.
