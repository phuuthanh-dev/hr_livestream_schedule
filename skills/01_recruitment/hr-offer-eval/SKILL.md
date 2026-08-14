---
name: hr-offer-eval
description: Evaluate host candidates for the `Lương thỏa thuận` column in `Thông tin Mẫu Live` using 2-hour test live results, profile videos, experience, account type, and follow count. Use when Codex needs to score speaking flow, comment handling, closing, situation handling, deal execution, voice, appearance, and confidence; map the result to a dry-run salary-offer range from `Lương + commission`; or write column H only after explicit user approval.
---

# HR Offer Eval

## Overview

Use this skill to turn host audition evidence into a controlled proposal for column `H` (`Lương thỏa thuận`) in the Google Sheet `Thông tin Mẫu Live`.

Keep the workflow evidence-first and dry-run-first. Do not write to the sheet until the user explicitly approves the band or value to write.

## Workflow

1. Load the candidate row from the source sheet.

Run from the project root:

```bash
python3 skills/01_recruitment/hr-offer-eval/scripts/lookup_offer_candidate.py --employee-id HRLT01
```

Use `--row-number` instead of `--employee-id` when the user points to a sheet row directly.

2. Read the operating rules and offer bands.

- Read [references/source-data.md](references/source-data.md) for the sheet tabs, relevant columns, and salary-band snapshot.
- Read [references/rubric.md](references/rubric.md) for the default scoring rubric and mapping logic.

3. Gather required evidence.

Required inputs:

- 2-hour test live result
- profile video or recruiter summary of the profile video
- row context from `Thông tin Mẫu Live`

Useful row fields:

- `Kinh nghiệm`
- `Live tk cá nhân`
- `Live tk công ty`
- `Lượt follow`
- current `Lương thỏa thuận`
- `Rating`, `Đánh giá level`, `Note`

If either the 2-hour test live result or the profile video signal is missing, return `hold/no-write` and explain the missing evidence.

4. Normalize the commercial lane before scoring.

Use these defaults:

- If `Live tk cá nhân = TRUE` or `Lượt follow` is present, treat the candidate as `personal-account`.
- Else if `Live tk công ty = TRUE` or `Live_Channel_Id` is present, treat the candidate as `company-account`.
- If both personal and company signals are present, return two candidate lanes in dry-run and do not write.
- Because `Thông tin Mẫu Live` does not expose a dedicated `Full-time/Freelance` column, default `company-account` host test-live evaluations to `freelance` unless the user explicitly says the hire is `full-time`.

5. Score the candidate.

Score every rubric criterion from `0-10`, cite short evidence for each, and convert to a weighted total out of `100`.

Do not hide uncertainty:

- If evidence is weak, lower confidence.
- If follow count is required for a personal-account lane and the row does not contain it, return `hold/no-write`.

6. Produce a dry-run proposal.

Return:

- candidate identity
- sheet row number
- target cell in column H
- current value in column H
- normalized lane
- weighted score
- recommended band
- proposed write value
- confidence
- overwrite risk if column H is already populated

Preferred dry-run shape:

```json
{
  "status": "dry-run",
  "employee_id": "HRLT01",
  "row_number": 2,
  "target_cell": "H2",
  "current_value": "100.000 + 7% GMV",
  "lane": "company-account/freelance",
  "score_total": 78,
  "recommended_band": "HOST LIVE > COMPANY ACCOUNT > Freelance > Host phổ thông (<1 năm)",
  "proposed_value": "200K – 300K VNĐ/giờ",
  "confidence": "medium",
  "notes": [
    "Defaulted employment model to freelance because the source sheet has no explicit employment-type column.",
    "Column H already has a value; require explicit approval before overwrite."
  ]
}
```

7. Apply only after explicit approval.

Use:

```bash
python3 skills/01_recruitment/hr-offer-eval/scripts/write_salary_proposal.py --employee-id HRLT01 --value '200K – 300K VNĐ/giờ' --apply
```

Rules:

- `write_salary_proposal.py` is dry-run by default.
- Never add `--apply` unless the user explicitly approves the exact value or range to write.
- If column H already contains a value, surface the current value before applying.

## Guardrails

- Treat `Lương + commission` as the salary-band source of truth for this skill unless the user explicitly overrides it.
- Do not invent a personal-account band when `Lượt follow` is missing.
- Do not collapse a mixed company/personal candidate into one lane without explicit user direction.
- Do not overwrite column H silently.
- Prefer writing a range from the salary-band table. If the user wants a single negotiated number instead, wait for the user to choose the floor, midpoint, or ceiling first.
