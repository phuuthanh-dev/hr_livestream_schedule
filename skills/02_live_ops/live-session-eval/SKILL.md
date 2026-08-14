---
name: live-session-eval
description: Evaluate one livestream session from `TikTok_Sales_Import` and `Post_Live_Report`. Use when Codex needs a dry-run session score based on GMV per hour, dead-air signal, orders per minute, average-viewer signal, cart CTR, and discipline penalties; or when Codex needs a proposal for `Grade_Review` and short strengths/weaknesses for `Portfolio_Master`.
---

# Live Session Eval

## Overview

Use this skill to score one completed live session for `livestream_ops`.

The skill is dry-run-first and assumes the current master sheet structure, where `Grade_Review` is one row per person, not one row per session.

## Workflow

1. Load the target session and matching post-live row.

Run from the project root:

```bash
python3 skills/02_live_ops/live-session-eval/scripts/evaluate_live_session.py --session-id SS-06082026-20002200-HRLT08-HRSL01_6H
```

Use `--live-id` or `--row-number` when the user gives a TikTok live ID or a row instead of `Session_ID`.

2. Read the references before interpreting the score.

- Read [references/source-data.md](references/source-data.md) for current sheet structure and metric caveats.
- Read [references/rubric.md](references/rubric.md) for the provisional scoring model and tier mapping.

3. Confirm required evidence.

This skill expects both:

- `TikTok_Sales_Import`
- `Post_Live_Report`

If the post-live row is missing or too sparse, return `hold/no-write`.

4. Review the score output.

The evaluator script returns:

- session metrics
- component scores
- discipline penalties
- proposed tier
- `Grade_Review` proposal
- short `Portfolio_Master` strengths/weaknesses

5. Only write after explicit approval.

Use:

```bash
python3 skills/02_live_ops/live-session-eval/scripts/write_live_session_eval.py --session-id SS-06082026-20002200-HRLT08-HRSL01_6H --apply
```

Default behavior is dry-run. The writer proposes:

- `Grade_Review`: `Grade Đề Xuất`, `Hiệu Năng (GMV/Giờ)`, `Khuyến Nghị HR`
- `Portfolio_Master`: append short `Ưu điểm`, `Nhược điểm`

## Guardrails

- Use `Gross_GMV - Returned_GMV` for GMV-based metrics.
- Use actual TikTok start/end timestamps for duration.
- Prefer explicit average-viewer fields if the source tab later exposes them.
- If the current tab still lacks explicit viewer metrics, clearly mark the fallback estimate source.
- Treat dead air as a signal from `Connection_Status`, `Tech_Note`, `Next_Shift_Note`, and compliance markers. Do not invent dead-air minutes.
- Do not silently overwrite profile notes; the writer appends session-tagged notes.
- If `Grade_Review` does not already contain the host row, hold and explain instead of appending a malformed row.
