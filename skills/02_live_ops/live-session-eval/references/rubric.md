# Rubric

## Status

This is a provisional session-scoring model built from the current master sheet fields that were available on August 14, 2026.

The model is suitable for dry-run proposals. If HR later adds explicit `avg viewers` or `dead air` columns, update this rubric and the helper script before treating it as final.

## Weighted Score

Total before penalties: `100`

- `GMV/giờ`: `30`
- `Chốt đơn/phút`: `20`
- `Dead-air signal`: `15`
- `Mắt xem trung bình / viewer signal`: `15`
- `CTR giỏ hàng`: `10`
- `Kỷ luật vận hành / post-live execution`: `10`

## Discipline Penalty

Subtract up to `15` points for discipline issues:

- `Compliance_Flag_1_0 = 1`
- bad or unstable `Connection_Status`
- notes mentioning `mất sóng`, `dead air`, `lag`, `đứng hình`, `mất tiếng`, `trễ`, `không tuân thủ`

## Tier Mapping

- `>= 85`: `S`
- `>= 70`: `A`
- `>= 55`: `B`
- `>= 40`: `C`
- `< 40`: `Thử việc`

## Recommendation Mapping

Compare proposed tier with current grade in `Portfolio_Master`:

- higher than current → `Đề xuất Tăng hạng ⬆️`
- equal → `Giữ hạng ➡️`
- lower → `Cảnh báo / Giảm hạng ⬇️`

## Metric Thresholds

### `GMV/giờ` score band

- `>= 20.000.000`: `30`
- `>= 10.000.000`: `24`
- `>= 3.000.000`: `18`
- `>= 1.000.000`: `12`
- `> 0`: `6`
- else `0`

### `Chốt đơn/phút`

- `>= 0.12`: `20`
- `>= 0.08`: `16`
- `>= 0.04`: `12`
- `>= 0.02`: `8`
- `> 0`: `4`
- else `0`

### `Viewer signal`

- `>= 300`: `15`
- `>= 200`: `12`
- `>= 100`: `9`
- `>= 50`: `6`
- `> 0`: `3`
- else `0`

### `CTR giỏ hàng`

- `>= 8%`: `10`
- `>= 5%`: `8`
- `>= 3%`: `6`
- `>= 1.5%`: `4`
- `> 0`: `2`
- else `0`

### `Dead-air signal`

- no issue found in post-live evidence: `15`
- moderate issue keywords or unstable connection: `8`
- severe outage / dead-air evidence: `0`

### `Kỷ luật vận hành / post-live execution`

Scale:

- `Script_Execution_15` contributes `0-5`
- `Teamwork_Handover_5` contributes `0-2.5`
- `Sample_Care_5` contributes `0-2.5`

## Confidence

- `high`: post-live row matched exactly and no fallback metrics needed
- `medium`: one fallback metric used
- `low`: post-live row weak, or both dead-air and viewer metrics relied on fallback or text inference
