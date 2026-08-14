---
name: livestream-payroll-rules
description: Apply the livestream session payroll rules for Host and Support using `Base_Salary_Card`, `TikTok_Sales_Import`, `Portfolio_Master`, and `Support_Master`. Use when Codex needs to calculate one live session's payroll from actual TikTok hours, validated IDs, reconciled GMV only, Host hourly pay plus commission, Support hourly pay with zero commission, or PIT net pay in dry-run form.
---

# Livestream Payroll Rules

## Overview

Use this skill for session-level payroll checks in `HR_STREAMING_ MASTER FILE`.

This skill implements proposal `livestream-payroll-rules-20260807-25bd76a7ff` inside the project skill tree under `S5 / 05_payroll`.

## Workflow

1. Load the target session from `TikTok_Sales_Import`.

Run from the project root:

```bash
python3 skills/05_payroll/livestream-payroll-rules/scripts/calc_livestream_payroll.py --session-id SS-06082026-20002200-HRLT08-HRSL01_6H
```

Use `--live-id` or `--row-number` when the user gives a TikTok live ID or a sheet row instead of `Session_ID`.

2. Read the bundled references before interpreting the output.

- Read [references/source-data.md](references/source-data.md) for tabs, columns, and the current `Base_Salary_Card` snapshot.
- Read [references/payroll-policy.md](references/payroll-policy.md) for the exact compensation rules and validation gates.

3. Validate the session before quoting payroll.

The script blocks or flags these cases:

- Host ID not found in `Portfolio_Master`
- Support ID not found in `Support_Master`
- multiple Host IDs or multiple Support IDs in one row
- invalid or missing live timestamps
- missing grade/level with no rate-card match

4. Use only reconciled GMV.

The skill always calculates:

- `eligible_gmv = max(0, gross_gmv - returned_gmv)`
- hours from actual `Start_Time` and `End_Time`
- Host pay as `hours × hourly_rate + commission`
- Support pay as `hours × hourly_rate`
- net pay as `gross_pay - 10% PIT`

5. Return dry-run output first.

Preferred result shape:

```json
{
  "status": "dry-run",
  "session_id": "SS-06082026-20002200-HRLT08-HRSL01_6H",
  "eligible_gmv": 165000,
  "live_hours": 3.02,
  "host": {
    "employee_id": "HRLT08",
    "grade": "Thử việc",
    "hourly_rate": 70000,
    "commission_rate": 0.05,
    "base_pay": 211167,
    "commission_pay": 8250,
    "gross_pay": 219417,
    "pit": 21942,
    "net_pay": 197475
  },
  "support": {
    "employee_id": "HRSL01_6H",
    "grade": "Cấp 1",
    "hourly_rate": 30000,
    "commission_rate": 0,
    "base_pay": 90500,
    "commission_pay": 0,
    "gross_pay": 90500,
    "pit": 9050,
    "net_pay": 81450
  }
}
```

6. Treat the output as a proposal unless the user explicitly asks to post it elsewhere.

This skill currently computes and validates payroll only. It does not write to a payout sheet by itself.

## Guardrails

- `Base_Salary_Card` is the source of truth for hourly rate and commission logic.
- `A` and `S` Host grades use the 5 GMV thresholds when the note indicates `Theo Doanh thu`.
- `Thử việc`, `C`, and `B` Host grades use fixed commission from the card.
- Support `Cấp 1` to `Cấp 4` always use `0%` commission.
- Do not use scheduled slot duration when actual TikTok timestamps exist.
- Do not use gross GMV before returns.
- If a row is ambiguous, return `hold/no-write` instead of guessing.
