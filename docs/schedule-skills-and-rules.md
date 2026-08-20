# Tài liệu skill xếp lịch trong program hiện tại

## 1. Mục tiêu của engine xếp lịch

Program hiện tại đang dùng website để:

- Nhận lịch rảnh theo tuần từ Host và Support Live.
- Tự động sinh ca live cho các ngày tương lai trong tuần.
- Ưu tiên giữ nguyên các ca đã xác nhận hoặc đã bị admin chỉnh tay.
- Đưa ra các ca `published` nếu đủ người, hoặc `open` nếu còn thiếu Host/Support.

Phần xếp lịch hiện nằm chủ yếu ở các file:

- `lib/scheduleEngine.ts`
- `lib/scheduleGeneration.ts`
- `lib/scheduleAssignment.ts`
- `lib/availabilityStore.ts`
- `lib/scheduleStore.ts`

## 2. Dữ liệu đầu vào mà engine đang dùng

Engine hiện tại không lấy logic từ Google Sheet để xếp lịch trực tiếp. Nó dùng dữ liệu đã lưu trong MongoDB:

### 2.1. Hồ sơ nhân sự

Mỗi nhân sự có các trường ảnh hưởng trực tiếp đến xếp lịch:

- `id`
- `name`
- `role`: `host` hoặc `support`
- `level`
- `workLocation`
- `cashOffer`
- `castStatus`
- `trainingStatus`
- `liveChannelId`
- `active`

### 2.2. Lịch rảnh theo tuần

Mỗi nhân sự gửi các slot rảnh theo tuần:

- `dateKey`
- `slot`
- `available`
- `locationPreference` cho Host

### 2.3. Các ca đã được bảo vệ

Khi chạy lại lịch, engine sẽ không đè lên các ca:

- đã xác nhận Host
- đã xác nhận Support
- đã bị admin chỉnh tay (`manualOverride`)
- hoặc thuộc ngày quá khứ / ngày hiện tại theo rule bảo vệ khi generate

## 3. Khung giờ đang dùng

Khung giờ mặc định hiện tại là:

- `00:00 - 02:00`
- `06:00 - 08:00`
- `08:00 - 10:00`
- `10:00 - 12:00`
- `12:00 - 14:00`
- `14:00 - 16:00`
- `16:00 - 18:00`
- `18:00 - 20:00`
- `20:00 - 22:00`
- `22:00 - 00:00`

Mỗi slot được xử lý như 1 đơn vị xếp lịch riêng. Các slot liền kề được dùng để ghép block Support.

## 4. Điều kiện để một nhân sự được tham gia xếp lịch

Engine chỉ coi nhân sự là đủ điều kiện nếu:

- `active !== false`
- `castStatus` là trạng thái dương tính, ví dụ: `Đồng ý`, `accepted`, `yes`
- `trainingStatus` là trạng thái đã qua training, ví dụ: `Rồi`, `Đã Training`, `completed`

Nếu không đạt 3 điều kiện trên thì người đó có trong danh sách nhân sự nhưng sẽ không được dùng để xếp ca tự động.

## 5. Logic xếp Host

### 5.1. Tạo nhu cầu ca

Engine tạo nhu cầu ca từ lịch rảnh Host và Support:

- Nếu Host gửi slot rảnh thì tạo demand theo lane `home` hoặc `studio`.
- Nếu chỉ có Support gửi slot rảnh thì vẫn tạo ca lane `studio`, nhưng ca đó có thể bị thiếu Host.

Điều này giúp admin vẫn thấy khoảng trống vận hành ngay cả khi chưa có Host.

### 5.2. Lane địa điểm

Program hiện chia ca theo 2 lane chính:

- `Home`
- `Studio`

Rule địa điểm của Host:

- `home` chỉ được xếp `Home`
- `studio` chỉ được xếp `Studio`
- `both` mặc định ưu tiên `Home`, trừ khi người gửi slot chọn `studio` hoặc admin ép sang `Studio`

### 5.3. Thứ tự ưu tiên chọn Host

Trong một demand, Host hợp lệ sẽ được sort theo thứ tự:

1. `level` cao hơn được ưu tiên trước
2. Ai đang có ít ca hơn trong tuần sẽ được ưu tiên
3. `cashOffer` thấp hơn được ưu tiên
4. Sau cùng mới tới tên / mã

Mapping level hiện tại:

- `S` = 5
- `A` = 4
- `B` = 3
- `C` = 2
- `Thử việc` / `trainee` = 1

### 5.4. Giới hạn Host

Hiện tại Host bị giới hạn:

- tối đa `2 ca / ngày`
- không được trùng cùng `date + slot`

Nếu vượt giới hạn thì slot đó sẽ không nhận Host dù người đó có lịch rảnh.

### 5.5. Backup Host

Sau khi chọn Host chính:

- người đứng thứ 2 sẽ được ghi vào `backupHostId`, `backupHostName`
- nếu không có backup, ca sẽ có warning `BACKUP_HOST`

## 6. Logic xếp Support Live

### 6.1. Support chỉ gắn cho ca Studio

Support chỉ được xếp cho lane `Studio`.

Nếu ca là `Home`:

- không cần Support
- nếu admin chuyển ca về `Home`, Support sẽ bị gỡ ra

### 6.2. Ghép block Support

Engine không gán Support từng slot rời rạc ngay lập tức. Nó gom các ca Studio liền nhau theo từng ngày thành các run liên tiếp, sau đó chia block:

- Ngày thường: block `4 giờ` tương ứng `2 slot`
- Cuối tuần: ưu tiên block `6 giờ` tương ứng `3 slot` nếu run lẻ phù hợp

Rule cụ thể:

- Ngày thường: một run 4 slot sẽ tách thành `2 + 2`
- Cuối tuần:
  - nếu có 2 slot liền nhau thì là block 4 giờ
  - nếu có 3 slot liền nhau thì là block 6 giờ
  - nếu có 5 slot liền nhau thì tách `3 + 2`

### 6.3. Điều kiện chọn Support

Support phải:

- đủ điều kiện hoạt động như phần trên
- có lịch rảnh đầy đủ cho toàn bộ block
- chưa bị dùng ở ngày đó
- chưa bị chiếm ở các slot trong block

Ngoài ra:

- block 6 giờ cuối tuần chỉ nhận Support có mã kết thúc bằng `_6H`
- block 4 giờ sẽ loại Support `_6H` trong cuối tuần

Điều này nghĩa là `_6H` đang được xem như loại nhân sự chuyên ca 6 giờ cuối tuần.

### 6.4. Thứ tự ưu tiên chọn Support

Support hợp lệ được sort theo:

1. `cashOffer` thấp hơn được ưu tiên
2. Nếu block có Host rank cao (`A` hoặc `S`) thì Support level cao hơn được ưu tiên
3. Ai có ít ca hơn trong tuần được ưu tiên
4. Sau cùng mới đến tên / mã

### 6.5. Giới hạn Support

Hiện tại Support bị giới hạn:

- một Support chỉ được dùng `1 block / ngày`
- không được dùng trùng slot

Nếu không đủ Support cho trọn block:

- ca vẫn tồn tại
- trạng thái giữ `open`
- warning sẽ là:
  - `OPEN_SUPPORT`
  - `OPEN_SUPPORT_6H`
  - hoặc `SUPPORT_SINGLETON`

### 6.6. Backup Support

Người đứng thứ 2 trong danh sách candidate sẽ được giữ làm backup:

- `backupSupportId`
- `backupSupportName`

Ngoài ra hệ thống còn lưu:

- `supportCandidatePool`

để admin biết danh sách Support đã được xét trong block đó.

## 7. Trạng thái ca sau khi xếp

Sau khi chạy engine:

- `published`: có Host và nếu là Studio thì có cả Support
- `open`: thiếu Host hoặc thiếu Support

Các cờ quan trọng:

- `supportRequired`
- `missingSupport`
- `isSupportOnly`
- `canConfirmHost`
- `canConfirmSupport`
- `warningLevel`
- `warnings`

Một ca có thể tồn tại ở trạng thái:

- chỉ có Host
- chỉ có Support
- thiếu cả hai

để admin nhìn được khoảng trống thực tế.

## 8. Rule giữ nguyên ca cũ khi generate lại

Khi admin bấm chạy lại lịch tuần, program hiện:

1. lấy lịch rảnh tuần
2. lấy roster nhân sự
3. lấy các ca đã có trong tuần
4. đánh dấu các ca protected
5. chỉ generate lại phần chưa protected
6. publish trực tiếp vào MongoDB

Các ca protected gồm:

- ca đã confirm Host
- ca đã confirm Support
- ca `manualOverride`
- ca quá khứ / hiện tại không cho regenerate đè

Ý nghĩa vận hành:

- admin có thể chạy lại lịch nhiều lần trong tuần
- phần đã chốt với nhân sự sẽ được giữ nguyên

## 9. Rule xác nhận ca

### 9.1. Ai được confirm

- Admin có thể confirm
- Nhân viên chỉ được confirm đúng vai trò của mình
- Nhân viên chỉ được confirm đúng ca đang gán cho chính mã nhân viên đó

### 9.2. Hạn chế thời gian

Nhân viên không được đổi xác nhận cho ca của ngày đã qua.

### 9.3. Tác động của chỉnh tay

Nếu admin đổi Host, đổi Support hoặc đổi địa điểm:

- ca được đánh dấu `manualOverride`
- confirmation liên quan sẽ bị reset về `Chưa xác nhận`
- backup cũ bị xóa
- candidate pool Support bị xóa nếu cần

## 10. Hành vi chỉnh tay của admin

Admin hiện có thể chỉnh tay:

- đổi Host
- đổi Support
- đổi `Home` / `Studio`

Rule quan trọng:

- nếu gắn Support vào ca của Host `both`, ca sẽ bị đẩy sang `Studio`
- nếu chuyển ca về `Home`, Support sẽ bị gỡ
- nếu Host chỉ làm `Home` thì không thể ép Support vào ca đó
- nếu Host chỉ làm `Home` hoặc chỉ làm `Studio`, admin không thể gán sai địa điểm hồ sơ

## 11. Cách hiểu “skill xếp lịch” trong program hiện tại

Nếu diễn đạt theo nghiệp vụ, program hiện đang ngầm dùng các “skill” sau để xếp lịch:

### 11.1. Skill của Host

- Rank theo `level`
- Khả năng làm `Home` / `Studio`
- Mức sẵn sàng qua `castStatus`
- Mức hoàn tất training qua `trainingStatus`
- Chi phí tham chiếu qua `cashOffer`

### 11.2. Skill của Support

- Level support
- Loại ca thường hay ca `_6H`
- Mức sẵn sàng qua `castStatus`
- Mức hoàn tất training qua `trainingStatus`
- Chi phí tham chiếu qua `cashOffer`

Lưu ý quan trọng:

- Program hiện **chưa có ma trận skill chi tiết theo ngành hàng / format live / độ khó phiên live**.
- “Skill” hiện mới đang được suy luận gián tiếp từ `level`, `_6H`, `cashOffer`, training và cast status.

## 12. Những gì program hiện chưa làm trong xếp lịch

Các hạng mục chưa thấy tồn tại trong engine hiện tại:

- chưa đọc `rating` để quyết định xếp lịch
- chưa đọc `cash_offer` theo engine riêng ngoài phần sort ưu tiên
- chưa có rule xếp theo account TikTok cá nhân / công ty
- chưa có rule xếp theo script, campaign, ngành hàng, category sản phẩm
- chưa có rule matching skill host với skill support
- chưa có rule chấm điểm hiệu suất từ báo cáo livestream để quay lại ảnh hưởng xếp lịch tuần sau
- chưa có rule ưu tiên theo `Portfolio_Master` hoặc `Live_Session_Master_Web`
- chưa có bước approve nhiều tầng trước khi publish

## 13. Đề xuất mở rộng nếu muốn “xếp lịch theo skill thật”

Nếu cần nâng cấp tiếp, nên tách logic xếp lịch thành 4 lớp:

1. `Điều kiện tối thiểu`
   Bao gồm active, cast, training, địa điểm, loại ca `_6H`.

2. `Skill score`
   Bao gồm rating, grade review, checklist training, kinh nghiệm ngành hàng, live account type.

3. `Business rule`
   Bao gồm ưu tiên account công ty / cá nhân, campaign, khung giờ vàng, host chính / backup.

4. `Cost rule`
   Bao gồm cash offer, lương thỏa thuận, hiệu suất lịch sử, payroll efficiency.

## 14. Kết luận ngắn

Program hiện tại đang là một engine xếp lịch theo:

- lịch rảnh tuần
- địa điểm live
- điều kiện active / cast / training
- level
- cash offer
- block rule 4h / 6h của Support
- bảo vệ các ca đã confirm hoặc chỉnh tay

Nó đã đủ để vận hành lịch tuần cơ bản, nhưng chưa phải engine xếp lịch theo skill sâu. Nếu muốn nâng lên mức “skill-based scheduling”, bước tiếp theo là chuẩn hóa score cho Host và Support rồi đưa score đó vào bộ sort chính.
