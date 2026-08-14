# Source Data

## Spreadsheet

- Master file: `HR_STREAMING_ MASTER FILE`
- Spreadsheet ID: `1x6nVWbe1v80Px4UVRYciOwFJYNdEF8f6LC4gKGbgclw`

## Required Tabs

- `Base_Salary_Card`
- `TikTok_Sales_Import`
- `Portfolio_Master`
- `Support_Master`

## Required Columns

### `TikTok_Sales_Import`

- `Session_ID`
- `TikTok_Live_ID`
- `Start_Time`
- `End_Time`
- `Returned_GMV`
- `Gross_GMV`
- `Host_ID`
- `Support_ID`
- `Note`

### `Portfolio_Master`

- `Streamer_ID`
- `Full_Name`
- `Entry_Grade`
- `Cash_Offer`

### `Support_Master`

- `Mã Support (Support_ID)`
- `Họ Và Tên`
- `Cấp Độ / Level`
- `Cash Offer`

## Current `Base_Salary_Card` Snapshot

### Host

- `Thử việc`: `70.000₫/h`, `5%`, note `Cố định`
- `C`: `100.000₫/h`, `7%`, note `Cố định`
- `B`: `120.000₫/h`, `12%`, note `Cố định`
- `A`: `200.000₫/h`, `18%`, note `Theo Doanh thu (Theo rank doanh thu)`
- `S`: `500.000₫/h`, `20%`, note `Theo Doanh thu (Theo rank doanh thu)`

### Support

- `Cấp 1`: `30.000₫/h`
- `Cấp 2`: `50.000₫/h`
- `Cấp 3`: `70.000₫/h`
- `Cấp 4`: `120.000₫/h`

### GMV Commission Tiers

- `5.000.000` → `5%`
- `10.000.000` → `7%`
- `20.000.000` → `12%`
- `35.000.000` → `18%`
- `50.000.000` → `20%`

## Notes

- `TikTok_Sales_Import` already stores Host/Support IDs after mapping.
- Some rows use `No_Support`; treat that as no support payout, not as a missing Support master row.
- `Gross_GMV` and `Returned_GMV` can appear in mixed formats such as `371.388 đ`, `$300.000`, or numeric strings. Always normalize first.
