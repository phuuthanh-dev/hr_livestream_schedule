# Local Program: Host Offer Sync

## Mục tiêu

Local program này xử lý hạng mục 3:

- đọc tab `Thông tin Mẫu Live`
- lấy tín hiệu đánh giá từ `Đánh giá level` hoặc `Rating`
- tự đề xuất `Lương thỏa thuận`
- ghi vào cột H khi có `--apply`

Program này dành cho luồng deterministic sau khi HR đã có grade/rating cuối cùng.

## Phân vai với skill `hr-offer-eval`

- `host-offer-sync`:
  - dùng khi sheet đã có grade/rating rõ ràng
  - tự sync cột H theo rule cố định
  - phù hợp chạy theo lô
- `hr-offer-eval`:
  - dùng khi còn phải đọc evidence thô như test live 2 giờ, video profile, follow, lane phức tạp
  - dùng cho case personal-account, mixed, hoặc cần người duyệt

## Rule hiện tại

Program chỉ tự động xử lý `company-account`.

Mapping:

- `Thử việc` -> `70.000 + 5% GMV`
- `C` -> `100.000 + 7% GMV`
- `B` -> `120.000 + 12% GMV`
- `A` -> `200.000 + commission theo bậc GMV`
- `S` -> `500.000 + commission theo bậc GMV`

Nếu row là:

- `personal-account`
- `mixed`
- hoặc thiếu `Đánh giá level` / `Rating`

thì program trả về `hold`, không tự ghi cột H.

## Local config riêng của program

Program này tách riêng khỏi website.

Nó dùng:

- `local_programs/host_offer_sync/.env.local`
- `local_programs/host_offer_sync/.env.example`

### File `.env.local`

```bash
LOCAL_HOST_OFFER_SPREADSHEET_ID=12WU5jM-KC9EngkA_xBS3U82KYnO-8RMwGwk9fwcGe3o
LOCAL_HOST_OFFER_TAB=Thông tin Mẫu Live
LOCAL_HOST_OFFER_RANGE=Thông tin Mẫu Live!A1:Z1200
LOCAL_HOST_OFFER_BATCH_LIMIT=50
LOCAL_HOST_OFFER_STATE_PATH=./.state/last-run.json
```

### GWS CLI login

Program gọi trực tiếp `gws sheets ...`, không tự giữ thêm Google auth riêng.

Đăng nhập 1 lần trên máy local:

```bash
gws auth login -s sheets
```

Kiểm tra phiên:

```bash
gws auth status
```

## Cách chạy

### Dry run theo lô

Mặc định chỉ quét các dòng đang trống cột H:

```bash
npm run sync:offers:host
```

### Dry run 1 host cụ thể

```bash
npm run sync:offers:host -- --employee-id=HRLT25
```

### Dry run 1 row cụ thể

```bash
npm run sync:offers:host -- --row-number=18
```

### Quét cả các dòng đã có cột H

```bash
npm run sync:offers:host -- --include-filled --limit=20
```

### Ghi thật 1 host

```bash
npm run sync:offers:host -- --employee-id=HRLT25 --apply
```

### Ghi đè nếu cột H đang có giá trị khác

```bash
npm run sync:offers:host -- --employee-id=HRLT25 --apply --allow-overwrite
```

## State local

State mặc định:

- `local_programs/host_offer_sync/.state/last-run.json`

State chỉ dùng để lưu kết quả lần chạy gần nhất.

## Ghi chú vận hành

- Program không sửa cột I.
- Program không tự xử lý personal-account band.
- Row nào cần đọc test live/video profile thủ công thì chuyển sang skill `hr-offer-eval`.
- Chế độ mặc định là `dry-run`; chỉ ghi khi có `--apply`.
