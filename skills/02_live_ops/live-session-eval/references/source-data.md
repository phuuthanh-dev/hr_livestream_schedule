# Source Data

## Spreadsheet

- Master file: `HR_STREAMING_ MASTER FILE`
- Spreadsheet ID: `1x6nVWbe1v80Px4UVRYciOwFJYNdEF8f6LC4gKGbgclw`

## Required Tabs

- `TikTok_Sales_Import`
- `Post_Live_Report`
- `Portfolio_Master`
- `Grade_Review`

## Key Columns

### `TikTok_Sales_Import`

- `Session_ID`
- `TikTok_Live_ID`
- `Start_Time`
- `End_Time`
- `Gross_GMV`
- `Returned_GMV`
- `Gross_Orders`
- `Host_ID`
- `Support_ID`
- `Product_Impressions`
- `Product_Clicks`
- `Impressions`
- `CTR`

## `Post_Live_Report`

- `Session_ID`
- `Streamer_ID`
- `Support_ID`
- `Connection_Status`
- `Orders_Observed`
- `Revenue_Observed`
- `Script_Execution_15`
- `Teamwork_Handover_5`
- `Sample_Care_5`
- `Tech_Note`
- `Next_Shift_Note`
- `Compliance_Flag_1_0`

## Current Constraints

1. `Grade_Review` is currently one row per person, not one row per session.
2. `Portfolio_Master` already stores long-form `Ưu điểm` and `Nhược điểm`.
3. `TikTok_Sales_Import` currently does not expose a clear explicit `avg viewers` column in the sample data that was checked on August 14, 2026.
4. `TikTok_Sales_Import` also does not expose direct numeric dead-air minutes in the checked sample.

## Fallback Rules

- Average-viewer signal may be estimated from `Impressions / live_minutes` only when no explicit viewer metric exists.
- Dead-air signal may only come from:
  - `Connection_Status`
  - `Tech_Note`
  - `Next_Shift_Note`
  - `Compliance_Flag_1_0`

When either fallback is used, the evaluator must mark confidence as reduced.
