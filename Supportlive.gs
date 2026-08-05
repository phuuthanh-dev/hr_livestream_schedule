// ===========================================================================
// ĐỒNG BỘ CHÍNH XÁC DANH SÁCH SUPPORT, LEVEL VÀ SĐT TỪ BẢNG NGUỒN SANG MASTER
// ===========================================================================
function syncSupportMasterFromSource() {
  const SOURCE_SPREADSHEET_ID = '12WU5jM-KC9EngkA_xBS3U82KYnO-8RMwGwk9fwcGe3o';
  
  let sourceSs;
  try {
    sourceSs = SpreadsheetApp.openById(SOURCE_SPREADSHEET_ID);
  } catch (e) {
    safeAlert("Không thể kết nối File Nguồn. Kiểm tra lại ID hoặc quyền truy cập!");
    return;
  }

  // Mở tab 'Thông tin Support Live'
  const sourceSheet = sourceSs.getSheetByName('Thông tin Support Live');
  if (!sourceSheet) {
    safeAlert("Không tìm thấy tab 'Thông tin Support Live' trong file Đăng Ký Lịch!");
    return;
  }

  const destSs = SpreadsheetApp.getActiveSpreadsheet();
  let destSheet = destSs.getSheetByName('Support_Master');
  if (!destSheet) {
    destSheet = destSs.insertSheet('Support_Master');
  }

  const sourceData = sourceSheet.getDataRange().getValues();
  if (sourceData.length <= 1) {
    safeAlert("Tab 'Thông tin Support Live' chưa có dữ liệu!");
    return;
  }

  // 1. DÒ TỰ ĐỘNG VỊ TRÍ CÁC CỘT BÊN FILE NGUỒN
  const srcHeaders = sourceData[0].map(h => h ? h.toString().trim().toLowerCase() : "");

  // Dò cột Mã Support — match cụ thể, tránh match nhầm "mã thuế", "mã đơn"...
  let idIdx = srcHeaders.findIndex(h =>
    h.includes("mã support") ||
    h.includes("mã nhân viên") ||
    h === "mã" ||
    h === "support_id"
  );
  if (idIdx === -1) idIdx = srcHeaders.findIndex(h => h.includes("mã") && !h.includes("thuế") && !h.includes("đơn"));

  // Dò cột Tên — match cụ thể, tránh "tên tài khoản", "tên đăng nhập"...
  let nameIdx = srcHeaders.findIndex(h =>
    (h === "tên" || h === "họ và tên" || h === "full_name" || h === "full name") &&
    !h.includes("tài khoản") &&
    !h.includes("đăng nhập")
  );
  if (nameIdx === -1) nameIdx = srcHeaders.findIndex(h => h.includes("tên") && !h.includes("mã") && !h.includes("tài khoản") && !h.includes("đăng nhập"));

  // Dò cột SĐT
  let sdtIdx = srcHeaders.findIndex(h =>
    h.includes("sđt") ||
    h.includes("số điện thoại") ||
    h.includes("phone") ||
    h.includes("dien thoai")
  );

  // Dò cột Level
  let levelIdx = srcHeaders.findIndex(h =>
    h.includes("level") ||
    h.includes("cấp độ") ||
    h.includes("đánh giá")
  );

  let cashIdx = srcHeaders.findIndex(h => h.includes("cash offer (reality)"));
  let castIdx = srcHeaders.findIndex(h =>
    h.includes("deal cast lần i") ||
    h.includes("deal cast lan i") ||
    h.includes("đồng ý cast") ||
    h.includes("dong y cast")
  );
  let expIdx    = srcHeaders.findIndex(h => h.includes("kinh nghiệm"));

  // Dò cột CV — match cụ thể "link cv" hoặc "cv", tránh match "chuyên viên"
  let cvIdx = srcHeaders.findIndex(h =>
    h === "cv" ||
    h.includes("link cv") ||
    h.includes("cv link") ||
    h.includes("đường dẫn cv")
  );
  if (cvIdx === -1) cvIdx = srcHeaders.findIndex(h => h.includes("cv") && !h.includes("chuyên") && !h.includes("chủ"));

  // Dò cột Kết quả đánh giá
  let reviewIdx = srcHeaders.findIndex(h =>
    h.includes("kết quả đánh giá") ||
    h.includes("ket qua danh gia") ||
    h.includes("đánh giá") && !h.includes("level") && !h.includes("cấp độ")
  );

  let trainIdx = srcHeaders.findIndex(h => h.includes("training"));

  // Mặc định fallback nếu không tìm thấy tiêu đề
  if (idIdx === -1) idIdx = 0;
  if (nameIdx === -1) nameIdx = 1;
  if (cashIdx === -1) cashIdx = 2;
  if (expIdx === -1) expIdx = 3;
  if (cvIdx === -1) cvIdx = 4;
  if (trainIdx === -1) trainIdx = 5;

  let supportRows = [];
  let skippedRows = 0;
  let rowSourceIndexes = []; // Map: supportRows[i] ← sourceData row index i

  // Đọc RichText của cột CV từ nguồn (để giữ hyperlink)
  let srcCvRichTexts = null;
  if (cvIdx !== -1) {
    const srcCvRange = sourceSheet.getRange(2, cvIdx + 1, sourceData.length - 1, 1);
    srcCvRichTexts = srcCvRange.getRichTextValues();
  }

  for (let i = 1; i < sourceData.length; i++) {
    let suppId   = sourceData[i][idIdx] ? sourceData[i][idIdx].toString().trim() : "";
    let fullName = sourceData[i][nameIdx] ? sourceData[i][nameIdx].toString().trim() : "";

    if (!suppId || suppId.toLowerCase().includes("trống")) {
      skippedRows++;
      continue;
    }

    let sdtVal    = (sdtIdx !== -1 && sourceData[i][sdtIdx]) ? sourceData[i][sdtIdx].toString().trim() : "";
    let cashOffer = sourceData[i][cashIdx] ? sourceData[i][cashIdx].toString().trim() : "";
    let castDeal  = (castIdx !== -1 && sourceData[i][castIdx]) ? sourceData[i][castIdx].toString().trim() : "";
    let expVal    = sourceData[i][expIdx] ? sourceData[i][expIdx].toString().trim() : "";
    let cvText    = sourceData[i][cvIdx] ? sourceData[i][cvIdx].toString().trim() : "";
    let reviewVal = (reviewIdx !== -1 && sourceData[i][reviewIdx]) ? sourceData[i][reviewIdx].toString().trim() : "";

    // Training: kiểm tra cả boolean true lẫn text "có"/"true"/"đã training"
    let trainRaw  = (trainIdx !== -1 && sourceData[i][trainIdx]) ? sourceData[i][trainIdx] : false;
    let isTrained = "Chưa Training";
    if (trainRaw === true || String(trainRaw).toLowerCase().trim() === "true" ||
        String(trainRaw).toLowerCase().trim() === "có" ||
        String(trainRaw).toLowerCase().trim().includes("đã")) {
      isTrained = "Đã Training";
    }

    // 2. LẤY LEVEL TRỰC TIẾP TỪ CỘT MỚI THÊM
    let rawLevel = (levelIdx !== -1 && sourceData[i][levelIdx]) ? sourceData[i][levelIdx].toString().trim() : "";
    let levelVal = "";

    if (rawLevel) {
      // Chuẩn hóa chuỗi về dạng chuẩn "Cấp 1", "Cấp 2", "Cấp 3", "Cấp 4"
      if (rawLevel.startsWith("Cấp")) {
        levelVal = rawLevel;
      } else {
        let digits = rawLevel.match(/\d+/);
        levelVal = digits ? "Cấp " + digits[0] : rawLevel;
      }
    } else {
      // Fallback suy luận nếu ô Level bên nguồn để trống
      if (expVal.toLowerCase() === "không") {
        levelVal = "Cấp 1";
      } else if (cashOffer.includes("100k") || cashOffer.includes("80-100k")) {
        levelVal = "Cấp 3";
      } else {
        levelVal = "Cấp 2";
      }
    }

    supportRows.push([
      suppId,       // Cột 1: Mã Support (Support_ID)
      fullName,     // Cột 2: Tên THẬT
      sdtVal,       // Cột 3: SĐT
      levelVal,     // Cột 4: Level thực tế (Cấp 1, Cấp 2, Cấp 3, Cấp 4)
      cashOffer,    // Cột 5: Cash Offer
      castDeal,     // Cột 6: Đồng ý Cast
      expVal,       // Cột 7: Kinh nghiệm (Có/Không)
      isTrained,    // Cột 8: Trạng thái training
      cvText,       // Cột 9: CV (text placeholder, sẽ ghi RichText sau)
      reviewVal     // Cột 10: Kết quả đánh giá (từ nguồn)
    ]);
    rowSourceIndexes.push(i - 1); // i-1 vì srcCvRichTexts bắt đầu từ row 0 = sourceData row 1
  }

  // 3. KHỞI TẠO VÀ GHI DỮ LIỆU RA TAB SUPPORT_MASTER
  const headers = [
    "Mã Support (Support_ID)", 
    "Họ Và Tên", 
    "Phone",
    "Cấp Độ / Level", 
    "Cash Offer", 
    "Đồng ý Cast",
    "Kinh Nghiệm", 
    "Trạng Thái Training", 
    "Link CV",
    "Kết Quả Đánh Giá"
  ];

  destSheet.clear();
  
  const headerRange = destSheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers])
             .setFontWeight("bold").setFontColor("#ffffff").setBackground("#1f497d")
             .setHorizontalAlignment("center").setVerticalAlignment("middle");
  destSheet.setRowHeight(1, 35);
  destSheet.setFrozenRows(1);

  if (supportRows.length > 0) {
    destSheet.getRange(2, 1, supportRows.length, headers.length).setValues(supportRows);

    // Ghi lại CV bằng RichText để giữ hyperlink xanh
    if (cvIdx !== -1 && srcCvRichTexts) {
      for (let i = 0; i < supportRows.length; i++) {
        const srcRowIdx = rowSourceIndexes[i];
        if (srcCvRichTexts[srcRowIdx] && srcCvRichTexts[srcRowIdx][0]) {
          destSheet.getRange(i + 2, 9).setRichTextValue(srcCvRichTexts[srcRowIdx][0]);
        }
      }
    }

    // Định dạng độ rộng cột
    destSheet.setColumnWidth(1, 180); // Mã Support
    destSheet.setColumnWidth(2, 180); // Tên thật
    destSheet.setColumnWidth(3, 150); // Phone
    destSheet.setColumnWidth(4, 130); // Level/Cấp độ
    destSheet.setColumnWidth(5, 160); // Cash Offer
    destSheet.setColumnWidth(6, 150); // Đồng ý Cast
    destSheet.setColumnWidth(7, 130); // Kinh nghiệm
    destSheet.setColumnWidth(8, 160); // Training
    destSheet.setColumnWidth(9, 200); // Link CV
    destSheet.setColumnWidth(10, 180); // Kết quả đánh giá

    // Căn giữa dữ liệu
    destSheet.getRange(2, 1, supportRows.length, 1).setHorizontalAlignment("center");
    destSheet.getRange(2, 3, supportRows.length, 2).setHorizontalAlignment("center");
    destSheet.getRange(2, 6, supportRows.length, 3).setHorizontalAlignment("center");

    let alertMsg = `Đã đồng bộ thành công ${supportRows.length} hồ sơ Support (bao gồm Level + SĐT) sang Support_Master!`;
    if (skippedRows > 0) {
      alertMsg += `\nBỏ qua ${skippedRows} dòng không có mã Support.`;
    }
    safeAlert(alertMsg);
  } else {
    safeAlert("Không lấy được dữ liệu từ tab 'Thông tin Support Live'!");
  }
}
