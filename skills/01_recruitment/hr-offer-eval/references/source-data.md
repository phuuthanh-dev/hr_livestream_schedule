# Source Data

Updated: 2026-08-14

## Primary sources

- Logic doc:
  - `https://docs.google.com/document/d/1_gt3zx0UclYx-9uesP3FLf6NtoB-QZzgjyqHdMZ1_m8/edit`
- Source spreadsheet:
  - `https://docs.google.com/spreadsheets/d/12WU5jM-KC9EngkA_xBS3U82KYnO-8RMwGwk9fwcGe3o/edit`

## Relevant tabs in the source spreadsheet

- `Thông tin Mẫu Live`
- `Lương + commission`
- `Collect lịch live chính`
- `Collect lịch sp live`

Only the first two tabs are required for `hr-offer-eval`.

## `Thông tin Mẫu Live` columns used by this skill

Header snapshot from row 1:

| Column | Header |
|---|---|
| A | `STT` |
| B | `Mã HĐ` |
| C | `Mã nhân viên` |
| D | `Họ và tên đầy đủ` |
| E | `Tên gọi khác` |
| F | `SĐT` |
| G | `Lương mong muốn` |
| H | `Lương thỏa thuận` |
| I | `Phản hồi về Lương thỏa thuận` |
| J | `Tham gia zalo` |
| K | `Kinh nghiệm` |
| L | `Đánh giá level` |
| M | `Thành Tích` |
| N | `CV` |
| O | `Link` |
| P | `Live tk cá nhân` |
| Q | `Live tk công ty` |
| R | `Link Tiktok` |
| S | `Lượt follow` |
| T | `Rating` |
| U | `Live tại nhà` |
| V | `Live tại Studio` |
| W | `Đã tham gia training` |
| X | `Note` |
| Y | `Live_Channel_Id` |
| Z | `Gmail` |

## `Lương + commission` salary-band snapshot

These are the bands extracted on 2026-08-14. If the user asks for the latest bands, re-read the live sheet before finalizing.

### Host live -> company account

| Employment model | Segment | Reference band |
|---|---|---|
| Full-time | Mới / Chưa kinh nghiệm | `9M – 13M VNĐ/tháng` |
| Full-time | Có kinh nghiệm | `16M – 25M VNĐ/tháng` |
| Full-time | Cấp quản lý / Lead Host | `28M – 40M VNĐ/tháng` |
| Freelance | Host phổ thông (<1 năm) | `200K – 300K VNĐ/giờ` |
| Freelance | Host chuyên nghiệp | `400K – 800K VNĐ/ giờ` |
| Freelance | KOL / KOC "mượn mặt" | `3M – 10M VNĐ/phiên` |

### Host live -> personal account

| Follow bucket | Reference band |
|---|---|
| Nano KOC (`< 10K`) | `200 – 500K VNĐ / phiên (hoặc đổi bằng sản phẩm)` |
| Micro KOC (`10K – 50K`) | `2M – 4M VNĐ/phiên` |
| Macro KOL (`100K – 500K`) | `7M – 20M VNĐ/phiên` |
| Top Creator (`> 1M`) | `Trên 30M – 80M VNĐ/phiên` |

Gap note:

- The reference table does not define a dedicated `50K – 99,999` band.
- When the candidate falls in this gap, return a dry-run only and show both the upper `Micro` and lower `Macro` interpretations unless the user chooses one.

## Operational assumptions for this skill

1. `Column H` is the write target.
   - Header: `Lương thỏa thuận`
2. `Column I` is a response/feedback column.
   - Header: `Phản hồi về Lương thỏa thuận`
3. The source sheet does not expose a dedicated `Full-time/Freelance` field.
   - Default company-account 2-hour audition evaluations to `freelance`.
   - Only use `full-time` salary bands when the user explicitly says the candidate is a full-time or in-house hire.
4. `Live tk cá nhân` plus `Lượt follow` is the strongest signal for personal-account bands.
5. The automation doc explicitly treats lower `Cash_Offer / Lương thỏa thuận` as a scheduling tie-breaker.
   - That makes consistency in column H operationally important.
