// ===========================================================================
// HÀM GRADE_REVIEW: SYNC GRADE TỪ PORTFOLIO & SUPPORT_MASTER CHO CẢ 2 KHỐI
// ===========================================================================
function runGradeReviewEngine() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  const pfSheet = ss.getSheetByName('Portfolio_Master');
  const spSheet = ss.getSheetByName('Support_Master');
  const tkSheet = ss.getSheetByName('TikTok_Sales_Import');
  
  let grSheet = ss.getSheetByName('Grade_Review');
  if (!grSheet) {
    grSheet = ss.insertSheet('Grade_Review');
  }

  let personMap = {};
  let personList = [];

  function addPersonId(id) {
    if (id && !personList.includes(id)) {
      personList.push(id);
    }
  }

  // 1. SYNC GRADE & HỌ TÊN CỦA HOST TỪ PORTFOLIO_MASTER
  if (pfSheet && pfSheet.getLastRow() > 1) {
    const pfData = pfSheet.getDataRange().getValues();
    const pfHeaders = pfData[0].map(h => h ? h.toString().trim().toLowerCase() : "");

    let idCol   = pfHeaders.findIndex(h => h.includes("mã") || h.includes("id"));
    let nameCol = pfHeaders.findIndex(h => h.includes("tên") || h.includes("full_name"));
    let rankCol = pfHeaders.findIndex(h => h.includes("level") || h.includes("grade") || h.includes("đánh giá"));

    if (idCol === -1) idCol = 0;
    if (nameCol === -1) nameCol = 1;

    for (let i = 1; i < pfData.length; i++) {
      let id   = pfData[i][idCol] ? pfData[i][idCol].toString().trim() : "";
      let name = pfData[i][nameCol] ? pfData[i][nameCol].toString().trim() : id;
      let currentGrade = (rankCol !== -1 && pfData[i][rankCol]) ? pfData[i][rankCol].toString().trim() : "Thử việc";

      if (id && !id.toLowerCase().includes("trống")) {
        personMap[id] = {
          id: id,
          name: name,
          role: "Host (Chính)",
          currentGrade: currentGrade,
          totalSessions: 0,
          totalHours: 0,
          totalGMV: 0
        };
        addPersonId(id);
      }
    }
  }

  // 2. SYNC GRADE & HỌ TÊN CỦA SUPPORT TỪ SUPPORT_MASTER
  if (spSheet && spSheet.getLastRow() > 1) {
    const spData = spSheet.getDataRange().getValues();
    const spHeaders = spData[0].map(h => h ? h.toString().trim().toLowerCase() : "");

    let sIdCol   = spHeaders.findIndex(h => h.includes("mã") || h.includes("id"));
    let sNameCol = spHeaders.findIndex(h => h.includes("tên"));
    let sLvlCol  = spHeaders.findIndex(h => h.includes("cấp độ") || h.includes("level"));

    if (sIdCol === -1) sIdCol = 0;
    if (sNameCol === -1) sNameCol = 1;
    if (sLvlCol === -1) sLvlCol = 2;

    for (let i = 1; i < spData.length; i++) {
      let sId   = spData[i][sIdCol] ? spData[i][sIdCol].toString().trim() : "";
      let sName = spData[i][sNameCol] ? spData[i][sNameCol].toString().trim() : sId;
      let sLvl  = (sLvlCol !== -1 && spData[i][sLvlCol]) ? spData[i][sLvlCol].toString().trim() : "Cấp 2";

      if (sId && !sId.toLowerCase().includes("trống")) {
        // Chuẩn hóa dạng "Cấp X"
        if (!sLvl.startsWith("Cấp")) {
          let m = sLvl.match(/\d+/);
          sLvl = m ? "Cấp " + m[0] : "Cấp 2";
        }

        personMap[sId] = {
          id: sId,
          name: sName,
          role: "Support",
          currentGrade: sLvl,
          totalSessions: 0,
          totalHours: 0,
          totalGMV: 0
        };
        addPersonId(sId);
      }
    }
  }

  // 3. TÍNH TOÁN HIỆU NĂNG THỰC TẾ TỪ TIKTOK_SALES_IMPORT
  if (tkSheet && tkSheet.getLastRow() > 1) {
    const tkData = tkSheet.getDataRange().getValues();
    const tkHeaders = tkData[0].map(h => h ? h.toString().trim().toLowerCase() : "");

    let startIdx = tkHeaders.indexOf("start_time");
    let endIdx   = tkHeaders.indexOf("end_time");
    let grossIdx = tkHeaders.indexOf("gross_gmv");
    let retIdx   = tkHeaders.indexOf("returned_gmv");
    let hostIdx  = tkHeaders.indexOf("host_id");
    let suppIdx  = tkHeaders.indexOf("support_id");

    if (startIdx === -1) startIdx = 3;
    if (endIdx === -1) endIdx = 4;
    if (retIdx === -1) retIdx = 5;
    if (grossIdx === -1) grossIdx = 7;
    if (hostIdx === -1) hostIdx = 10;
    if (suppIdx === -1) suppIdx = 11;

    for (let i = 1; i < tkData.length; i++) {
      let rawHostIds = tkData[i][hostIdx] ? tkData[i][hostIdx].toString().trim() : "";
      let rawSuppIds = tkData[i][suppIdx] ? tkData[i][suppIdx].toString().trim() : "";

      let startTimeVal = tkData[i][startIdx];
      let endTimeVal   = tkData[i][endIdx];
      let hoursWorked  = 2.0;

      if (startTimeVal instanceof Date && endTimeVal instanceof Date) {
        let diffMs = endTimeVal.getTime() - startTimeVal.getTime();
        hoursWorked = Math.max(0.5, Math.round((diffMs / (1000 * 60 * 60)) * 10) / 10);
      }

      let grossGMV = parseCurrencyNumber(tkData[i][grossIdx]);
      let returnedGMV = parseCurrencyNumber(tkData[i][retIdx]);
      let eligibleGMV = Math.max(0, grossGMV - returnedGMV);

      let hostIds = (rawHostIds && !rawHostIds.toLowerCase().includes("trống")) ? rawHostIds.split(',').map(s => s.trim()) : [];
      let suppIds = (rawSuppIds && !rawSuppIds.toLowerCase().includes("trống") && !rawSuppIds.toLowerCase().includes("no_support")) ? rawSuppIds.split(',').map(s => s.trim()) : [];

      let gmvPerHost = hostIds.length > 0 ? eligibleGMV / hostIds.length : eligibleGMV;

      // Tích lũy cho Host
      for (let hId of hostIds) {
        if (!hId) continue;
        if (!personMap[hId]) {
          personMap[hId] = { id: hId, name: hId, role: "Host (Chính)", currentGrade: "Thử việc", totalSessions: 0, totalHours: 0, totalGMV: 0 };
          addPersonId(hId);
        }
        personMap[hId].totalSessions += 1;
        personMap[hId].totalHours += hoursWorked;
        personMap[hId].totalGMV += gmvPerHost;
      }

      // Tích lũy cho Support
      for (let sId of suppIds) {
        if (!sId) continue;
        if (!personMap[sId]) {
          personMap[sId] = { id: sId, name: sId, role: "Support", currentGrade: "Cấp 2", totalSessions: 0, totalHours: 0, totalGMV: 0 };
          addPersonId(sId);
        }
        personMap[sId].totalSessions += 1;
        personMap[sId].totalHours += hoursWorked;
        personMap[sId].totalGMV += eligibleGMV;
      }
    }
  }

  // 4. ĐÁNH GIÁ VÀ TẠO KHUYẾN NGHỊ NÂNG / HẠ GRADE
  let reviewRows = [];

  for (let id of personList) {
    let item = personMap[id];
    let avgGMVPerHour = item.totalHours > 0 ? Math.round(item.totalGMV / item.totalHours) : 0;
    let proposedGrade = "";

    if (item.role === "Host (Chính)") {
      // Đề xuất Grade cho Host
      if (avgGMVPerHour >= 20000000) proposedGrade = "S";
      else if (avgGMVPerHour >= 10000000) proposedGrade = "A";
      else if (avgGMVPerHour >= 3000000) proposedGrade = "B";
      else if (avgGMVPerHour >= 1000000) proposedGrade = "C";
      else proposedGrade = "Thử việc";
    } else {
      // Đề xuất Grade cho Support
      if (avgGMVPerHour >= 10000000 || item.totalSessions >= 30) proposedGrade = "Cấp 3";
      else if (avgGMVPerHour >= 3000000 || item.totalSessions >= 10) proposedGrade = "Cấp 2";
      else proposedGrade = "Cấp 1";
    }

    // So sánh Grade gốc vs Grade Đề xuất
    let actionRecommendation = "Giữ hạng ➡️";
    let curWeight = getGradeWeight(item.currentGrade);
    let propWeight = getGradeWeight(proposedGrade);

    if (propWeight > curWeight) {
      actionRecommendation = "Đề xuất Tăng hạng ⬆️";
    } else if (propWeight < curWeight) {
      actionRecommendation = "Cảnh báo / Giảm hạng ⬇️";
    }

    reviewRows.push([
      item.id,                 // Cột 1: Mã Nhân Sự
      item.name,               // Cột 2: Họ Và Tên
      item.role,               // Cột 3: Vai Trò
      item.currentGrade,       // Cột 4: Grade Gốc (Sync từ Portfolio/Support_Master)
      item.totalSessions,      // Cột 5: Tổng Số Ca Live
      item.totalHours,         // Cột 6: Tổng Số Giờ Live
      item.totalGMV,           // Cột 7: Tổng GMV Tích Lũy
      proposedGrade,           // Cột 8: Grade Đề Xuất System
      avgGMVPerHour,           // Cột 9: Hiệu Năng (GMV/Giờ)
      actionRecommendation     // Cột 10: Khuyến Nghị HR
    ]);
  }

  // 5. GHI KẾT QUẢ RA TAB GRADE_REVIEW
  const headers = [
    "Mã Nhân Sự (ID)", 
    "Họ Và Tên", 
    "Vai Trò", 
    "Grade Hiện Tại (Sync)", 
    "Số Ca Live", 
    "Tổng Giờ Live", 
    "Tổng GMV Tích Lũy (VNĐ)", 
    "Grade Đề Xuất", 
    "Hiệu Năng (GMV/Giờ)", 
    "Khuyến Nghị HR"
  ];

  grSheet.clear();
  
  const headerRange = grSheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers])
             .setFontWeight("bold").setFontColor("#ffffff").setBackground("#1f497d")
             .setHorizontalAlignment("center").setVerticalAlignment("middle");
  grSheet.setRowHeight(1, 35);
  grSheet.setFrozenRows(1);

  if (reviewRows.length > 0) {
    grSheet.getRange(2, 1, reviewRows.length, reviewRows[0].length).setValues(reviewRows);

    const numRows = reviewRows.length;
    grSheet.getRange(2, 6, numRows, 1).setNumberFormat("#,##0.0");
    grSheet.getRange(2, 7, numRows, 1).setNumberFormat("#,##0₫");
    grSheet.getRange(2, 9, numRows, 1).setNumberFormat("#,##0₫");

    grSheet.getRange(2, 1, numRows, 1).setHorizontalAlignment("center");
    grSheet.getRange(2, 3, numRows, 2).setHorizontalAlignment("center");
    grSheet.getRange(2, 8, numRows, 1).setHorizontalAlignment("center");
    grSheet.getRange(2, 10, numRows, 1).setHorizontalAlignment("center");

    SpreadsheetApp.getUi().alert(`Thành công! Đã đồng bộ Grade cho cả Host và Support. Tổng cộng ${reviewRows.length} hồ sơ đã được đánh giá.`);
  } else {
    SpreadsheetApp.getUi().alert("Không tìm thấy dữ liệu nhân sự!");
  }
}

// Trọng số tính Grade tăng/giảm cho cả 2 khối
function getGradeWeight(gradeStr) {
  if (!gradeStr) return 1;
  let g = gradeStr.toString().trim().toUpperCase();
  if (g.includes("S") || g.includes("CẤP 4")) return 5;
  if (g.includes("A") || g.includes("CẤP 3")) return 4;
  if (g.includes("B") || g.includes("CẤP 2")) return 3;
  if (g.includes("C") || g.includes("CẤP 1")) return 2;
  return 1; // Thử việc
}

function parseCurrencyNumber(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  let cleanStr = val.toString().replace(/[^0-9.-]+/g, "");
  return parseFloat(cleanStr) || 0;
}
