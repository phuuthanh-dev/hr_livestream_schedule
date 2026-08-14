# Offer Evaluation Rubric

This rubric is the default policy for `hr-offer-eval`.

It is intentionally conservative:

- it forces a dry-run first
- it prefers salary-band ranges over exact negotiated numbers
- it refuses to write when core evidence is missing

## Evidence requirements

Required:

- 2-hour test live result
- profile video or recruiter summary of the profile video
- candidate row from `Thông tin Mẫu Live`

If a required input is missing, return:

- `status: hold`
- `proposed_value: ""`
- a reason that the offer should not be written yet

## Weighted scoring model

Score each criterion `0-10`, then apply the weight.

| Criterion | Weight | Evidence focus |
|---|---:|---|
| Giữ mạch nói | 15 | continuity, filler control, clear transitions |
| Tương tác comment | 15 | reading comments, reacting naturally, inviting interaction |
| Chốt đơn | 20 | explicit closing, urgency, asking for action |
| Xử lý tình huống | 15 | objection handling, product confusion, flow recovery |
| Tung deal | 10 | timing, clarity, offer framing, FOMO without confusion |
| Chất giọng | 10 | clarity, pace, tone suitability |
| Ngoại hình | 5 | camera presence, grooming, visual suitability for live |
| Tự tin | 10 | posture, eye contact, energy, conviction |

Total: `100`.

## Score interpretation

| Total score | Default interpretation |
|---|---|
| `< 55` | hold / no write |
| `55 - 69` | lower-band candidate |
| `70 - 84` | pass / mid-band candidate |
| `>= 85` | strong candidate / upper-band candidate |

## Lane inference

### 1. Account mode

- `personal-account`
  - `Live tk cá nhân = TRUE`, or
  - `Lượt follow` is present and non-zero
- `company-account`
  - `Live tk công ty = TRUE`, or
  - `Live_Channel_Id` is present
- `mixed`
  - both personal and company signals are present
- `unknown`
  - neither lane is supported by the row

### 2. Employment model

- default `company-account` candidates to `freelance`
- switch to `full-time` only when the user explicitly states that the hire is full-time or in-house

## Offer-band mapping

### Company account -> freelance

Use this as the default path for 2-hour host test-live workflows.

- `< 55`
  - no write
- `55 - 79`
  - `200K – 300K VNĐ/giờ`
- `>= 80` and `Kinh nghiệm = Có`
  - `400K – 800K VNĐ/ giờ`
- `>= 80` and `Kinh nghiệm != Có`
  - keep dry-run at `200K – 300K VNĐ/giờ` unless the user explicitly wants to stretch into the higher band

### Company account -> full-time

Only use when the user explicitly confirms `full-time`.

- `< 55`
  - no write
- `55 - 74`
  - `9M – 13M VNĐ/tháng`
- `75 - 89`
  - `16M – 25M VNĐ/tháng`
- `>= 90` with explicit lead or management evidence
  - `28M – 40M VNĐ/tháng`

### Personal account

Follow count decides the primary band.

- `< 10K`
  - `200 – 500K VNĐ / phiên (hoặc đổi bằng sản phẩm)`
- `10K - 50K`
  - `2M – 4M VNĐ/phiên`
- `100K - 500K`
  - `7M – 20M VNĐ/phiên`
- `> 1M`
  - `Trên 30M – 80M VNĐ/phiên`

Special cases:

- `50K - 99,999`
  - return dry-run only with both `Micro` and `Macro` interpretations
- missing follow count for a personal-account candidate
  - return hold / no write
- score `< 65`
  - keep the candidate in the lower half of the inferred band and mark confidence down

## Dry-run response contract

Always include:

- `employee_id`
- `row_number`
- `target_cell`
- `current_value`
- `lane`
- `employment_model`
- `score_total`
- `recommended_band`
- `proposed_value`
- `confidence`
- `notes`

If the current value in column H is non-empty, explicitly call out that applying will overwrite an existing offer.
