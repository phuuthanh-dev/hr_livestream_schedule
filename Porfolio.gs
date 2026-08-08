const SOURCE_FILE_ID = '12WU5jM-KC9EngkA_xBS3U82KYnO-8RMwGwk9fwcGe3o'; 
const DEST_FILE_ID   = '1x6nVWbe1v80Px4UVRYciOwFJYNdEF8f6LC4gKGbgclw'; 

function setupPortfolioHeaders() {
  const destSs = SpreadsheetApp.openById(DEST_FILE_ID);
  const destSheet = destSs.getSheetByName('Portfolio_Master');
  
  if (!destSheet) {
    Logger.log("Không tìm thấy tab Portfolio_Master.");
    return;
  }

  // Bổ sung Entry_Grade và Live_Channel_Id vào danh sách các cột tiêu đề mở rộng
  const newHeaders = [
    "Experience", "Achievements", "Rating", "Entry_Grade", "Live_Account_Type", "Cash_Offer", "Training_Status", "Live_Channel_Id"
  ];
  
  const startCol = 29; 
  if (destSheet.getMaxColumns() >= startCol) {
    destSheet.getRange(1, startCol, 1, destSheet.getMaxColumns() - startCol + 1).clearContent().clearFormat();
  }

  destSheet.getRange(1, startCol, 1, newHeaders.length).setValues([newHeaders]);
  
  const headerRange = destSheet.getRange(1, startCol, 1, newHeaders.length);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#1f497d").setFontColor("#ffffff");
  
  // Data Validation cho Live_Account_Type
  const accountTypeCol = startCol + 4; 
  const ruleAcc = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Cá nhân', 'Công ty', 'Cả hai', 'Chưa xác định'], true)
    .build();
  destSheet.getRange(2, accountTypeCol, 1000, 1).setDataValidation(ruleAcc);
  
  // Data Validation cho Training_Status
  const trainingCol = startCol + 6; 
  const ruleTraining = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Có', 'Không', 'Đang training', 'Chưa xác định'], true)
    .build();
  destSheet.getRange(2, trainingCol, 1000, 1).setDataValidation(ruleTraining);
  
  Logger.log("Đã setup xong tiêu đề mở rộng (có Entry_Grade) trong Portfolio_Master!");
}

function syncPortfolioMaster(options) {
  const sourceSs = SpreadsheetApp.openById(SOURCE_FILE_ID);
  const sourceSheet = sourceSs.getSheetByName('Thông tin Mẫu Live');
  
  const destSs = SpreadsheetApp.openById(DEST_FILE_ID);
  const destSheet = destSs.getSheetByName('Portfolio_Master');
  
  if (!sourceSheet || !destSheet) {
    Logger.log("Lỗi: Không tìm thấy tab dữ liệu ở file nguồn hoặc đích.");
    return {
      success: false,
      updatedCount: 0,
      deletedCount: 0,
      insertedCount: 0,
      message: "Không tìm thấy tab dữ liệu ở file nguồn hoặc đích."
    };
  }

  const sourceData = sourceSheet.getDataRange().getValues();
  let destData = destSheet.getDataRange().getValues();
  
  // ----------------------------------------------------
  // 1. TỰ ĐỘNG DÒ VỊ TRÍ CỘT BÊN FILE NGUỒN (SOURCE)
  // ----------------------------------------------------
  const srcHeaders = sourceData[0].map(h => h ? h.toString().trim().toLowerCase() : "");
  
  const srcIdx = {
    maNV:     srcHeaders.findIndex(h => h.includes("mã nhân viên") || h.includes("streamer_id")),
    ten:      srcHeaders.findIndex(h => h === "tên" || h.includes("full_name")),
    sdt:      srcHeaders.findIndex(h => h.includes("sđt") || h.includes("số điện thoại") || h.includes("phone") || h.includes("dien thoai")),
    level:    srcHeaders.findIndex(h => h.includes("đánh giá level") || h === "level" || h === "grade"), // Bổ sung tìm Level/Grade
    cash:     srcHeaders.findIndex(h => h.includes("lương thỏa thuận") || h.includes("Lương thỏa thuận")),
    castOk:   srcHeaders.findIndex(h => h.includes("Phản hồi về Lương thỏa thuận") || h.includes("phản hồi về lương thỏa thuận")),
    zaloOk:   srcHeaders.findIndex(h => h.includes("tham gia zalo") || h.includes("zalo")),
    exp:      srcHeaders.findIndex(h => h.includes("kinh nghiệm")),
    achieve:  srcHeaders.findIndex(h => h.includes("thành tích")),
    rating:   srcHeaders.findIndex(h => h.includes("rating")),
    liveNha:  srcHeaders.findIndex(h => h.includes("live tại nhà")),
    liveStd:  srcHeaders.findIndex(h => h.includes("live tại studio")),
    liveCN:   srcHeaders.findIndex(h => h.includes("live tk cá nhân")),
    liveCT:   srcHeaders.findIndex(h => h.includes("live tk công ty")),
    liveChannel: srcHeaders.findIndex(h =>
      h.includes("kênh live") ||
      h.includes("live channel") ||
      h.includes("live_channel") ||
      h.includes("live_channel_id")
    ),
    training: srcHeaders.findIndex(h => h.includes("training")),
    cv:       srcHeaders.findIndex(h => h === "cv" || h.includes("link cv") || h.includes("đường dẫn cv")),
    note:     srcHeaders.findIndex(h => h === "note" || h.includes("ghi chú"))
  };

  // LẤY TẬP HỢP TẤT CẢ MÃ NV VÀ TÊN ĐANG CÓ BÊN NGUỒN
  let sourceKeys = new Set();
  for (let i = 1; i < sourceData.length; i++) {
    let row = sourceData[i];
    let maNV = (srcIdx.maNV !== -1 && row[srcIdx.maNV]) ? row[srcIdx.maNV].toString().trim() : "";
    let ten  = (srcIdx.ten !== -1 && row[srcIdx.ten]) ? row[srcIdx.ten].toString().trim() : "";
    
    if (maNV) sourceKeys.add(maNV);
    else if (ten) sourceKeys.add("TÊN_" + ten);
  }

  // ----------------------------------------------------
  // 2. DÒ CỘT BÊN ĐÍCH & TỰ ĐỘNG KHỞI TẠO CỘT ENTRY_GRADE NẾU THIẾU
  // ----------------------------------------------------
  let destHeaders = destData[0].map(h => h ? h.toString().trim().toLowerCase() : "");
  
  let gradeColIdx = destHeaders.findIndex(h => h === "entry_grade" || h === "entry_level" || h === "grade");
  
  // Tự động thêm cột Entry_Grade nếu chưa tồn tại
  if (gradeColIdx === -1) {
    const newColPos = destSheet.getLastColumn() + 1;
    destSheet.getRange(1, newColPos).setValue("Entry_Grade").setFontWeight("bold").setBackground("#1f497d").setFontColor("#ffffff");
    
    // Cập nhật lại danh sách header sau khi chèn cột
    destData = destSheet.getDataRange().getValues();
    destHeaders = destData[0].map(h => h ? h.toString().trim().toLowerCase() : "");
    gradeColIdx = destHeaders.indexOf("entry_grade");
  }

  // Tự động thêm cột Phone ngay sau Full_Name nếu chưa tồn tại
  let phoneColIdx = destHeaders.findIndex(h => h === "phone" || h === "sđt" || h === "số điện thoại");
  if (phoneColIdx === -1) {
    // Tìm vị trí cột Full_Name để chèn ngay sau
    const fullNameColIdx = destHeaders.findIndex(h => h === "full_name" || h === "tên");
    const insertAfterCol = fullNameColIdx !== -1 ? fullNameColIdx + 1 : destSheet.getLastColumn();
    destSheet.insertColumnAfter(insertAfterCol);
    destSheet.getRange(1, insertAfterCol + 1).setValue("Phone").setFontWeight("bold").setBackground("#1f497d").setFontColor("#ffffff");
    destSheet.setColumnWidth(insertAfterCol + 1, 150);

    // Cập nhật lại header sau khi chèn cột
    destData = destSheet.getDataRange().getValues();
    destHeaders = destData[0].map(h => h ? h.toString().trim().toLowerCase() : "");
    phoneColIdx = destHeaders.findIndex(h => h === "phone" || h === "sđt");
  }

  // Tự động thêm 2 cột mới (Đồng ý Cast + Tham gia Zalo) ngay sau Entry_Grade
  let castOkColIdx = destHeaders.findIndex(h => h === "đồng ý cast" || h === "cast_ok");
  let zaloOkColIdx = destHeaders.findIndex(h => h === "tham gia zalo" || h === "zalo_ok");

  if (castOkColIdx === -1 || zaloOkColIdx === -1) {
    // Tìm vị trí cột Entry_Grade để chèn ngay sau
    const gradeInsertCol = gradeColIdx !== -1 ? gradeColIdx + 1 : destSheet.getLastColumn();

    if (castOkColIdx === -1 && zaloOkColIdx === -1) {
      // Chèn cả 2 cột cùng lúc sau Entry_Grade
      destSheet.insertColumnAfter(gradeInsertCol);
      destSheet.insertColumnAfter(gradeInsertCol);
      destSheet.getRange(1, gradeInsertCol + 1).setValue("Tham gia Zalo").setFontWeight("bold").setBackground("#1f497d").setFontColor("#ffffff");
      destSheet.setColumnWidth(gradeInsertCol + 1, 130);
      destSheet.getRange(1, gradeInsertCol + 2).setValue("Đồng ý Cast").setFontWeight("bold").setBackground("#1f497d").setFontColor("#ffffff");
      destSheet.setColumnWidth(gradeInsertCol + 2, 130);
    } else if (castOkColIdx === -1) {
      // Chỉ thiếu Đồng ý Cast
      destSheet.insertColumnAfter(gradeInsertCol);
      destSheet.getRange(1, gradeInsertCol + 1).setValue("Đồng ý Cast").setFontWeight("bold").setBackground("#1f497d").setFontColor("#ffffff");
      destSheet.setColumnWidth(gradeInsertCol + 1, 130);
    } else {
      // Chỉ thiếu Tham gia Zalo
      destSheet.insertColumnAfter(gradeInsertCol);
      destSheet.getRange(1, gradeInsertCol + 1).setValue("Tham gia Zalo").setFontWeight("bold").setBackground("#1f497d").setFontColor("#ffffff");
      destSheet.setColumnWidth(gradeInsertCol + 1, 130);
    }

    destData = destSheet.getDataRange().getValues();
    destHeaders = destData[0].map(h => h ? h.toString().trim().toLowerCase() : "");
    castOkColIdx = destHeaders.findIndex(h => h === "đồng ý cast");
    zaloOkColIdx = destHeaders.findIndex(h => h === "tham gia zalo");
  }

  // Đọc RichText của cột CV từ nguồn (để giữ hyperlink)
  let srcCvRichTexts = null;
  if (srcIdx.cv !== -1) {
    const srcCvRange = sourceSheet.getRange(2, srcIdx.cv + 1, sourceData.length - 1, 1);
    srcCvRichTexts = srcCvRange.getRichTextValues();
  }

  // Tự động thêm cột CV vào đích nếu chưa tồn tại (sau cột Phone)
  let cvColIdx = destHeaders.findIndex(h => h === "cv" || h === "link cv");
  if (cvColIdx === -1 && srcIdx.cv !== -1) {
    const phoneCol = destHeaders.findIndex(h => h === "phone" || h === "sđt");
    const insertAfter = phoneCol !== -1 ? phoneCol + 1 : 2;
    destSheet.insertColumnAfter(insertAfter);
    destSheet.getRange(1, insertAfter + 1).setValue("CV").setFontWeight("bold").setBackground("#1f497d").setFontColor("#ffffff");
    destSheet.setColumnWidth(insertAfter + 1, 200);

    destData = destSheet.getDataRange().getValues();
    destHeaders = destData[0].map(h => h ? h.toString().trim().toLowerCase() : "");
    cvColIdx = destHeaders.findIndex(h => h === "cv" || h === "link cv");
  }

  let liveChannelColIdx = destHeaders.findIndex(h => h === "live_channel_id" || h === "live_channel" || h === "kênh live");
  if (liveChannelColIdx === -1) {
    const newColPos = destSheet.getLastColumn() + 1;
    destSheet.getRange(1, newColPos).setValue("Live_Channel_Id").setFontWeight("bold").setBackground("#1f497d").setFontColor("#ffffff");

    destData = destSheet.getDataRange().getValues();
    destHeaders = destData[0].map(h => h ? h.toString().trim().toLowerCase() : "");
    liveChannelColIdx = destHeaders.findIndex(h => h === "live_channel_id" || h === "live_channel");
  }

  let notesIndex = destHeaders.findIndex(h => h === "notes" || h === "note" || h.includes("ghi chú"));
  if (notesIndex === -1) notesIndex = 27;

  const colIndex = {
    maNV:     destHeaders.findIndex(h => h === "streamer_id" || h.includes("mã")), 
    ten:      destHeaders.findIndex(h => h === "full_name" || h === "tên"),    
    phone:    phoneColIdx,
    location: destHeaders.findIndex(h => h === "allowed_location"), 
    note:     notesIndex,       
    exp:      destHeaders.findIndex(h => h === "experience"),   
    achieve:  destHeaders.findIndex(h => h === "achievements"),
    rating:   destHeaders.findIndex(h => h === "rating"),
    techFit:  destHeaders.findIndex(h => h.includes("tech_fit") || h.includes("ar_fit")), // Cột điểm 1-5 sao
    grade:    gradeColIdx, // Cột Entry_Grade đã chuẩn hóa
    castOk:   castOkColIdx,
    zaloOk:   zaloOkColIdx,
    accType:  destHeaders.findIndex(h => h === "live_account_type"), 
    cash:     destHeaders.findIndex(h => h === "cash_offer"),
    cv:       cvColIdx,
    training: destHeaders.findIndex(h => h === "training_status"),
    liveChannel: liveChannelColIdx
  };

  // ----------------------------------------------------
  // 3. XÓA BỚT CÁC DÒNG BÊN MASTER NẾU NGUỒN ĐÃ XÓA
  // ----------------------------------------------------
  let deletedCount = 0;
  for (let i = destData.length - 1; i >= 1; i--) {
    let streamerId = (colIndex.maNV > -1 && destData[i][colIndex.maNV]) ? destData[i][colIndex.maNV].toString().trim() : "";
    let tenNV      = (colIndex.ten > -1 && destData[i][colIndex.ten]) ? destData[i][colIndex.ten].toString().trim() : "";
    
    let keyToCheck = streamerId ? streamerId : (tenNV ? "TÊN_" + tenNV : "");
    
    if (keyToCheck && !sourceKeys.has(keyToCheck)) {
      destSheet.deleteRow(i + 1);
      deletedCount++;
    }
  }

  destData = destSheet.getDataRange().getValues();

  let existingStreamers = {};
  for (let i = 1; i < destData.length; i++) {
    let streamerId = colIndex.maNV > -1 ? destData[i][colIndex.maNV] : ""; 
    let tenNV      = colIndex.ten > -1 ? destData[i][colIndex.ten] : "";
    
    if (streamerId) {
      existingStreamers[streamerId.toString().trim()] = i + 1;
    } else if (tenNV) {
      existingStreamers["TÊN_" + tenNV.toString().trim()] = i + 1;
    }
  }

  let newRows = [];
  let updatedCount = 0;
  const totalDestCols = destSheet.getLastColumn(); 

  // ----------------------------------------------------
  // 4. CẬP NHẬT HOẶC THÊM MỚI TỪ NGUỒN SANG ĐÍCH
  // ----------------------------------------------------
  for (let i = 1; i < sourceData.length; i++) {
    let row = sourceData[i];
    
    let maNV = (srcIdx.maNV !== -1 && row[srcIdx.maNV]) ? row[srcIdx.maNV].toString().trim() : "";
    let ten  = (srcIdx.ten !== -1 && row[srcIdx.ten]) ? row[srcIdx.ten].toString().trim() : "";
    
    if (!maNV && !ten) continue;
    
    let lookupKey = maNV ? maNV : "TÊN_" + ten;
    
    let sdtVal = (srcIdx.sdt !== -1 && row[srcIdx.sdt]) ? row[srcIdx.sdt].toString().trim() : "";
    let rawLevel      = (srcIdx.level !== -1 && row[srcIdx.level]) ? row[srcIdx.level].toString().trim() : "";
    let entryGradeVal = rawLevel ? rawLevel : "Thử việc"; // Mặc định Thử việc nếu rỗng
    
    let cashOffer  = (srcIdx.cash !== -1) ? row[srcIdx.cash] : "";
    let castOkVal  = (srcIdx.castOk !== -1 && row[srcIdx.castOk]) ? row[srcIdx.castOk].toString().trim() : "";
    let zaloOkVal  = (srcIdx.zaloOk !== -1 && row[srcIdx.zaloOk]) ? row[srcIdx.zaloOk].toString().trim() : "";
    // Chuẩn hóa checkbox/boolean cho Tham gia Zalo — trống/false/Không = "Chưa"
    if (zaloOkVal === "true" || zaloOkVal === "TRUE" || zaloOkVal.toLowerCase() === "có") zaloOkVal = "Có";
    else zaloOkVal = "Chưa";
    let kinhNghiem = (srcIdx.exp !== -1) ? row[srcIdx.exp] : "";
    let thanhTich  = (srcIdx.achieve !== -1) ? row[srcIdx.achieve] : "";
    let rating     = (srcIdx.rating !== -1) ? row[srcIdx.rating] : "";
    let noteNguon  = (srcIdx.note !== -1) ? row[srcIdx.note] : "";
    let liveChannelVal = (srcIdx.liveChannel !== -1 && row[srcIdx.liveChannel]) ? row[srcIdx.liveChannel].toString().trim() : "";
    
    let liveNha = (srcIdx.liveNha !== -1 && row[srcIdx.liveNha]) ? row[srcIdx.liveNha].toString().trim().toLowerCase() : "";
    let liveStd = (srcIdx.liveStd !== -1 && row[srcIdx.liveStd]) ? row[srcIdx.liveStd].toString().trim().toLowerCase() : "";
    
    let allowedLocation = "Unknown";
    let hasHome = (liveNha !== "" && liveNha !== "false"); 
    let hasStudio = (liveStd !== "" && liveStd !== "false");
    if (hasHome && hasStudio) allowedLocation = "Both";
    else if (hasStudio) allowedLocation = "Studio";
    else if (hasHome) allowedLocation = "Home";

    let liveCaNhan = (srcIdx.liveCN !== -1) ? row[srcIdx.liveCN] : false;
    let liveCongTy = (srcIdx.liveCT !== -1) ? row[srcIdx.liveCT] : false;
    let isPersonal = (liveCaNhan === true || String(liveCaNhan).toLowerCase() === "true");
    let isCompany  = (liveCongTy === true || String(liveCongTy).toLowerCase() === "true");
    
    let accountTypeVal = "Chưa xác định";
    if (isPersonal && isCompany) accountTypeVal = "Cả hai";
    else if (isPersonal) accountTypeVal = "Cá nhân";
    else if (isCompany) accountTypeVal = "Công ty";

    let trainingRaw = (srcIdx.training !== -1 && row[srcIdx.training]) ? row[srcIdx.training].toString().trim().toLowerCase() : "";
    let trainingVal = "Chưa";
    if (trainingRaw === "true" || trainingRaw === "có") trainingVal = "Rồi";
    else if (trainingRaw === "false" || trainingRaw === "không") trainingVal = "Chưa";
    else if (trainingRaw.includes("đang")) trainingVal = "Đang training";

    if (existingStreamers.hasOwnProperty(lookupKey)) {
      let rowIndex = existingStreamers[lookupKey];
      
      if (colIndex.ten > -1) destSheet.getRange(rowIndex, colIndex.ten + 1).setValue(ten);         
      if (colIndex.phone > -1) destSheet.getRange(rowIndex, colIndex.phone + 1).setValue(sdtVal);
      if (colIndex.location > -1) destSheet.getRange(rowIndex, colIndex.location + 1).setValue(allowedLocation);
      if (colIndex.note > -1) destSheet.getRange(rowIndex, colIndex.note + 1).setValue(noteNguon); 
      if (colIndex.exp > -1) destSheet.getRange(rowIndex, colIndex.exp + 1).setValue(kinhNghiem); 
      if (colIndex.achieve > -1) destSheet.getRange(rowIndex, colIndex.achieve + 1).setValue(thanhTich);  
      if (colIndex.rating > -1) destSheet.getRange(rowIndex, colIndex.rating + 1).setValue(rating);     
      
      // MAP ĐÚNG VÀO CỘT ENTRY_GRADE
      if (colIndex.grade > -1) destSheet.getRange(rowIndex, colIndex.grade + 1).setValue(entryGradeVal);
      if (colIndex.castOk > -1) destSheet.getRange(rowIndex, colIndex.castOk + 1).setValue(castOkVal);
      if (colIndex.zaloOk > -1) destSheet.getRange(rowIndex, colIndex.zaloOk + 1).setValue(zaloOkVal);

      // RESET LẠI CỘT TECH_FIT VỀ MẶC ĐỊNH 3 SAO NẾU ĐANG BỊ DÍNH LEVEL CŨ
      if (colIndex.techFit > -1) {
        let currentTech = destSheet.getRange(rowIndex, colIndex.techFit + 1).getValue().toString().trim().toLowerCase();
        if (["thử việc", "c", "b", "a", "s"].includes(currentTech)) {
          destSheet.getRange(rowIndex, colIndex.techFit + 1).setValue(3);
        }
      }

      if (colIndex.accType > -1) destSheet.getRange(rowIndex, colIndex.accType + 1).setValue(accountTypeVal);
      if (colIndex.cash > -1) destSheet.getRange(rowIndex, colIndex.cash + 1).setValue(cashOffer);
      if (colIndex.training > -1) destSheet.getRange(rowIndex, colIndex.training + 1).setValue(trainingVal);
      if (colIndex.liveChannel > -1) destSheet.getRange(rowIndex, colIndex.liveChannel + 1).setValue(liveChannelVal);
      // CV: dùng RichText để giữ hyperlink
      if (colIndex.cv > -1 && srcCvRichTexts && srcCvRichTexts[i - 1]) {
        destSheet.getRange(rowIndex, colIndex.cv + 1).setRichTextValue(srcCvRichTexts[i - 1][0]);
      }
      
      updatedCount++;
    } else {
      let newRow = new Array(totalDestCols).fill(""); 
      
      if (colIndex.maNV > -1) newRow[colIndex.maNV] = maNV;  
      if (colIndex.ten > -1) newRow[colIndex.ten] = ten;   
      if (colIndex.phone > -1) newRow[colIndex.phone] = sdtVal;
      if (colIndex.location > -1) newRow[colIndex.location] = allowedLocation;
      if (colIndex.note > -1) newRow[colIndex.note] = noteNguon;  
      if (colIndex.exp > -1) newRow[colIndex.exp] = kinhNghiem; 
      if (colIndex.achieve > -1) newRow[colIndex.achieve] = thanhTich;  
      if (colIndex.rating > -1) newRow[colIndex.rating] = rating;     
      if (colIndex.grade > -1) newRow[colIndex.grade] = entryGradeVal; // ĐÃ GHI ĐÚNG ENTRY_GRADE
      if (colIndex.castOk > -1) newRow[colIndex.castOk] = castOkVal;
      if (colIndex.zaloOk > -1) newRow[colIndex.zaloOk] = zaloOkVal;
      if (colIndex.accType > -1) newRow[colIndex.accType] = accountTypeVal;
      if (colIndex.cash > -1) newRow[colIndex.cash] = cashOffer;
      if (colIndex.training > -1) newRow[colIndex.training] = trainingVal;
      if (colIndex.liveChannel > -1) newRow[colIndex.liveChannel] = liveChannelVal;
      
      newRows.push(newRow);
    }
  }
  
  if (newRows.length > 0) {
    const lastRow = destSheet.getLastRow();
    destSheet.getRange(lastRow + 1, 1, newRows.length, totalDestCols).setValues(newRows);
    // CV: set RichText cho dòng mới thêm
    if (colIndex.cv > -1 && srcCvRichTexts) {
      const newStartRow = lastRow + 1;
      let appendIdx = 0;
      for (let i = 1; i < sourceData.length; i++) {
        let maNV = (srcIdx.maNV !== -1 && sourceData[i][srcIdx.maNV]) ? sourceData[i][srcIdx.maNV].toString().trim() : "";
        let ten  = (srcIdx.ten !== -1 && sourceData[i][srcIdx.ten]) ? sourceData[i][srcIdx.ten].toString().trim() : "";
        if (!maNV && !ten) continue;
        let lk = maNV ? maNV : "TÊN_" + ten;
        if (!existingStreamers.hasOwnProperty(lk)) {
          destSheet.getRange(newStartRow + appendIdx, colIndex.cv + 1).setRichTextValue(srcCvRichTexts[i - 1][0]);
          appendIdx++;
        }
      }
    }
  }
  
  const summary = {
    success: true,
    updatedCount,
    deletedCount,
    insertedCount: newRows.length,
    message: `Đã xóa ${deletedCount} dòng thừa, cập nhật ${updatedCount} hồ sơ và thêm mới ${newRows.length} hồ sơ.`
  };
  Logger.log(`Hoàn tất! ${summary.message}`);
  return summary;
}
