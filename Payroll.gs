

// ===========================================================================
// HÀM PHỤ TRỢ CHUẨN HÓA CẤP ĐỘ SUPPORT VÀ SỐ TIỀN TỆ
// ===========================================================================

// 1. Hàm chuẩn hóa chuỗi Cấp độ Support (Ví dụ: "Level 2", "2", "Cấp 2" -> "Cấp 2")
function normalizeSuppLevel(lvlStr) {
  if (!lvlStr) return "Cấp 2";
  let str = lvlStr.toString().trim();
  if (str.startsWith("Cấp")) return str;
  let match = str.match(/\d+/);
  if (match) {
    return "Cấp " + match[0];
  }
  return "Cấp 2";
}

// 2. Hàm bóc tách làm sạch dữ liệu tiền tệ (Xóa ký tự $, ₫, dấu phẩy)
function parseCurrencyNumber(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  let cleanStr = val.toString().replace(/[^0-9.-]+/g, "");
  return parseFloat(cleanStr) || 0;
}

function normalizeRateCardText(value) {
  return (value || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function parsePercentRate(val) {
  if (val === "" || val === null || val === undefined) return 0;

  if (typeof val === "number") {
    if (!isFinite(val)) return 0;
    return Math.abs(val) > 1 ? val / 100 : val;
  }

  const raw = val.toString().trim();
  if (!raw) return 0;

  const numeric = parseCurrencyNumber(raw);
  if (!isFinite(numeric)) return 0;

  if (raw.includes("%") || Math.abs(numeric) > 1) {
    return numeric / 100;
  }

  return numeric;
}

function normalizeHostGrade(gradeStr) {
  const grade = (gradeStr || "").toString().trim().replace(/\s+/g, " ");
  if (!grade) return "Thử việc";

  const normalized = normalizeRateCardText(grade);
  if (normalized.includes("thu viec")) return "Thử việc";

  return grade.split(" ")[0].trim().toUpperCase();
}

function extractBaseSalaryConfig(baseSheet) {
  const rateCard = {
    HOST: {},
    SUPPORT: {},
    COMMISSION_TIERS: []
  };

  if (!baseSheet || baseSheet.getLastRow() <= 1) return rateCard;

  const baseData = baseSheet.getDataRange().getValues();
  let currentSection = "";

  for (let i = 0; i < baseData.length; i++) {
    const row = baseData[i];
    const colA = row[0];
    const normalizedColA = normalizeRateCardText(colA);

    if (!normalizedColA && !row[1] && !row[2] && !row[3] && !row[4]) continue;

    if (normalizedColA.includes("thang bang luong danh cho host")) {
      currentSection = "HOST";
      continue;
    }

    if (normalizedColA.includes("thang bang luong danh cho support")) {
      currentSection = "SUPPORT";
      continue;
    }

    if (normalizedColA.includes("doanh thu gmv")) {
      currentSection = "GMV";
      continue;
    }

    if (
      normalizedColA.includes("ma cap do") ||
      normalizedColA.includes("tieu chi kpi") ||
      normalizedColA.includes("nhiem vu") ||
      normalizedColA.includes("muc commission")
    ) {
      continue;
    }

    if (currentSection === "HOST") {
      const code = (colA || "").toString().trim();
      if (!code) continue;

      rateCard.HOST[normalizeHostGrade(code)] = {
        hourlyRate: parseCurrencyNumber(row[2]),
        commRate: parsePercentRate(row[3]),
        note: row[4] ? row[4].toString().trim() : ""
      };
      continue;
    }

    if (currentSection === "SUPPORT") {
      const code = (colA || "").toString().trim();
      if (!code) continue;

      const normalizedLevel = normalizeSuppLevel(code);
      rateCard.SUPPORT[normalizedLevel] = {
        hourlyRate: parseCurrencyNumber(row[2]),
        commRate: parsePercentRate(row[3]),
        note: row[4] ? row[4].toString().trim() : ""
      };
      continue;
    }

    if (currentSection === "GMV") {
      const threshold = parseCurrencyNumber(row[0]);
      const commRate = parsePercentRate(row[1] !== "" && row[1] !== null && row[1] !== undefined ? row[1] : row[3]);

      if (threshold > 0) {
        rateCard.COMMISSION_TIERS.push({ threshold, commRate });
      }
    }
  }

  rateCard.COMMISSION_TIERS.sort((a, b) => a.threshold - b.threshold);
  return rateCard;
}

function resolveTierCommissionRate(eligibleGMV, tiers) {
  if (!tiers || tiers.length === 0) return 0;

  let matchedRate = 0;
  for (let i = 0; i < tiers.length; i++) {
    if (eligibleGMV >= tiers[i].threshold) {
      matchedRate = tiers[i].commRate;
    }
  }

  return matchedRate;
}

function resolveHostCompensation(grade, eligibleGMV, rateCard) {
  const normalizedGrade = normalizeHostGrade(grade);
  const hostConfig = rateCard.HOST[normalizedGrade] || {
    hourlyRate: 0,
    commRate: 0,
    note: ""
  };

  const tierRate = resolveTierCommissionRate(eligibleGMV, rateCard.COMMISSION_TIERS);
  const noteText = normalizeRateCardText(hostConfig.note);
  const shouldUseTierRate =
    tierRate > 0 &&
    (
      hostConfig.commRate === 0 ||
      noteText.includes("doanh thu") ||
      noteText.includes("rank doanh thu")
    );

  return {
    hourlyRate: hostConfig.hourlyRate || 0,
    commRate: shouldUseTierRate ? tierRate : (hostConfig.commRate || 0)
  };
}
// ===========================================================================
// HÀM TÍNH LƯƠNG HOÀN CHỈNH: ÉP CỘT TRỐNG VỀ 0.00% CHUẨN XÁC
// ===========================================================================
function runFullPayrollEngine() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  const tkSheet   = ss.getSheetByName('TikTok_Sales_Import');
  const baseSheet = ss.getSheetByName('Base_Salary_Card');
  const pfSheet   = ss.getSheetByName('Portfolio_Master');
  const grSheet   = ss.getSheetByName('Grade_Review');
  const spSheet   = ss.getSheetByName('Support_Master');
  
  if (!tkSheet || tkSheet.getLastRow() <= 1) {
    SpreadsheetApp.getUi().alert("Tab 'TikTok_Sales_Import' chưa có dữ liệu ca live!");
    return;
  }

  let paySheet = ss.getSheetByName('Payroll_Sheet');
  if (!paySheet) {
    paySheet = ss.insertSheet('Payroll_Sheet');
  }

  // 1. ĐỌC CẤU HÌNH TỪ BASE_SALARY_CARD (TRỐNG = 0)
  const rateCard = extractBaseSalaryConfig(baseSheet);

  // 2. MAPPING DỮ LIỆU HOST
  let hostGradeMap = {};
  if (grSheet && grSheet.getLastRow() > 1) {
    const grData = grSheet.getDataRange().getValues();
    const grHeaders = grData[0].map(h => h ? h.toString().trim().toLowerCase() : "");
    let grGradeCol = grHeaders.findIndex(h => h.includes("grade hiện tại") || h.includes("grade"));
    if (grGradeCol === -1) grGradeCol = 3;

    for (let i = 1; i < grData.length; i++) {
      let id = grData[i][0] ? grData[i][0].toString().trim() : "";
      let grade = grData[i][grGradeCol] ? grData[i][grGradeCol].toString().trim() : "";
      if (id && grade && isNaN(grade)) {
        hostGradeMap[id] = grade;
      }
    }
  }

  let hostNameMap = {};
  let hostPfGradeMap = {};
  if (pfSheet && pfSheet.getLastRow() > 1) {
    const pfData = pfSheet.getDataRange().getValues();
    const pfHeaders = pfData[0].map(h => h ? h.toString().trim().toLowerCase() : "");
    let idCol   = pfHeaders.findIndex(h => h.includes("mã") || h.includes("id"));
    let nameCol = pfHeaders.findIndex(h => h.includes("tên") || h.includes("full_name"));
    let rankCol = pfHeaders.findIndex(h => h.includes("level") || h.includes("grade"));

    if (idCol === -1) idCol = 0;
    if (nameCol === -1) nameCol = 1;

    for (let i = 1; i < pfData.length; i++) {
      let id   = pfData[i][idCol] ? pfData[i][idCol].toString().trim() : "";
      let name = pfData[i][nameCol] ? pfData[i][nameCol].toString().trim() : id;
      let rank = (rankCol !== -1 && pfData[i][rankCol]) ? pfData[i][rankCol].toString().trim() : "Thử việc";

      if (id) {
        hostNameMap[id] = name;
        hostPfGradeMap[id] = rank;
      }
    }
  }

  let suppNameMap = {};
  let suppLevelMap = {};
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
      let sLvl  = spData[i][sLvlCol] ? spData[i][sLvlCol].toString().trim() : "Cấp 2";

      if (sId) {
        suppNameMap[sId] = sName;
        suppLevelMap[sId] = normalizeSuppLevel(sLvl);
      }
    }
  }

  // 3. TÍNH LƯƠNG TỪ TIKTOK_SALES_IMPORT
  const tkData = tkSheet.getDataRange().getValues();
  const tkHeaders = tkData[0].map(h => h ? h.toString().trim().toLowerCase() : "");

  let sessIdx   = tkHeaders.indexOf("session_id");
  let startIdx  = tkHeaders.indexOf("start_time");
  let endIdx    = tkHeaders.indexOf("end_time");
  let grossIdx  = tkHeaders.indexOf("gross_gmv");
  let retIdx    = tkHeaders.indexOf("returned_gmv");
  let hostIdx   = tkHeaders.indexOf("host_id");
  let suppIdx   = tkHeaders.indexOf("support_id");

  if (sessIdx === -1) sessIdx = 0;
  if (startIdx === -1) startIdx = 3;
  if (endIdx === -1) endIdx = 4;
  if (retIdx === -1) retIdx = 5;
  if (grossIdx === -1) grossIdx = 7;
  if (hostIdx === -1) hostIdx = 10;
  if (suppIdx === -1) suppIdx = 11;

  let payrollRows = [];

  for (let i = 1; i < tkData.length; i++) {
    let sessId     = tkData[i][sessIdx] ? tkData[i][sessIdx].toString().trim() : "";
    let rawHostIds = tkData[i][hostIdx] ? tkData[i][hostIdx].toString().trim() : "";
    let rawSuppIds = tkData[i][suppIdx] ? tkData[i][suppIdx].toString().trim() : "";

    if ((!rawHostIds || rawHostIds.toLowerCase().includes("trống")) && (!rawSuppIds || rawSuppIds.toLowerCase().includes("trống"))) {
      continue;
    }

    let startTimeVal = tkData[i][startIdx];
    let endTimeVal   = tkData[i][endIdx];
    let dateStr = "";
    let hoursWorked = 2.0;

    if (startTimeVal instanceof Date) {
      dateStr = Utilities.formatDate(startTimeVal, ss.getSpreadsheetTimeZone(), "dd/MM/yyyy");
      if (endTimeVal instanceof Date) {
        let diffMs = endTimeVal.getTime() - startTimeVal.getTime();
        hoursWorked = Math.max(0.5, Math.round((diffMs / (1000 * 60 * 60)) * 10) / 10);
      }
    } else if (startTimeVal) {
      dateStr = startTimeVal.toString().split(" ")[0];
    }

    let grossGMV = parseCurrencyNumber(tkData[i][grossIdx]);
    let returnedGMV = parseCurrencyNumber(tkData[i][retIdx]);
    let eligibleGMV = Math.max(0, grossGMV - returnedGMV);

    let hostIds = (rawHostIds && !rawHostIds.toLowerCase().includes("trống")) ? rawHostIds.split(',').map(s => s.trim()) : [];
    let suppIds = (rawSuppIds && !rawSuppIds.toLowerCase().includes("trống") && !rawSuppIds.toLowerCase().includes("no_support")) ? rawSuppIds.split(',').map(s => s.trim()) : [];

    let gmvPerHost = hostIds.length > 0 ? eligibleGMV / hostIds.length : eligibleGMV;

    // A. TÍNH LƯƠNG HOST
    for (let hostId of hostIds) {
      if (!hostId) continue;

      let fullName = hostNameMap[hostId] || hostId;
      let grade = hostGradeMap[hostId] || hostPfGradeMap[hostId] || "Thử việc";
      const hostComp = resolveHostCompensation(grade, gmvPerHost, rateCard);
      let hourlyRate = hostComp.hourlyRate;
      let commRate   = hostComp.commRate;

      let basePay    = hoursWorked * hourlyRate;
      let commPay    = gmvPerHost * commRate;
      let bonusPay   = 0;
      let totalPayout = basePay + commPay;

      let cleanSessId = sessId ? sessId : `SS-${i}-${hostId}`;

      payrollRows.push([
        cleanSessId, dateStr, hostId, fullName, "Host (Chính)", 
        grade, hoursWorked, hourlyRate, basePay, 
        gmvPerHost, commRate, commPay, 
        bonusPay, totalPayout
      ]);
    }

    // B. TÍNH LƯƠNG SUPPORT
    for (let sId of suppIds) {
      if (!sId) continue;

      let suppName  = suppNameMap[sId] || hostNameMap[sId] || sId;
      let suppGrade = suppLevelMap[sId] || "Cấp 2";

      let hourlyRate = 0;
      let commRate   = 0;

      if (rateCard.SUPPORT[suppGrade]) {
        hourlyRate = rateCard.SUPPORT[suppGrade].hourlyRate;
        commRate   = rateCard.SUPPORT[suppGrade].commRate;
      }

      let basePay    = hoursWorked * hourlyRate;
      let commPay    = eligibleGMV * commRate;
      let totalPayout = basePay + commPay;

      let cleanSessId = sessId ? sessId : `SS-${i}-${sId}`;

      payrollRows.push([
        cleanSessId, dateStr, sId, suppName, "Support", 
        suppGrade, hoursWorked, hourlyRate, basePay, 
        eligibleGMV, commRate, commPay, 
        0, totalPayout
      ]);
    }
  }

  // 4. GHI RA PAYROLL_SHEET
  const headers = [
    "Mã Ca Live (Session_ID)", "Ngày Live", "Mã Nhân Sự", "Họ Và Tên", "Vai Trò", 
    "Cấp Độ / Grade", "Số Giờ Live", "Lương Giờ/h", "Thành Tiền Lương Cứng", 
    "Doanh Thu Thuần (Eligible GMV)", "% Hoa Hồng", "Tiền Hoa Hồng", 
    "Thưởng Nóng GMV/CCU", "TỔNG TIỀN", "Thuế 10%", "TỔNG THỰC NHẬN (VNĐ)"
  ];

  function buildPayrollKey(row) {
    const sessionId = row[0] ? row[0].toString().trim() : "";
    const staffId = row[2] ? row[2].toString().trim() : "";
    return `${sessionId}__${staffId}`;
  }

  let existingPayrollMap = {};
  const existingLastRow = paySheet.getLastRow();
  if (existingLastRow > 1) {
    const existingData = paySheet.getRange(2, 1, existingLastRow - 1, headers.length).getValues();
    for (let i = 0; i < existingData.length; i++) {
      const key = buildPayrollKey(existingData[i]);
      if (key !== "__") {
        existingPayrollMap[key] = {
          rowNumber: i + 2,
          values: existingData[i]
        };
      }
    }
  }

  paySheet.getRange(1, 1, 1, headers.length).setValues([headers])
          .setFontWeight("bold").setFontColor("#ffffff").setBackground("#1f497d")
          .setHorizontalAlignment("center").setVerticalAlignment("middle");
  paySheet.setFrozenRows(1);

  if (payrollRows.length > 0) {
    const rowsToAppend = [];
    const rowsToUpdate = [];
    const activePayrollKeys = new Set();

    payrollRows = payrollRows.map(row => {
      const existingEntry = existingPayrollMap[buildPayrollKey(row)];
      if (existingEntry && existingEntry.values[6] !== "" && existingEntry.values[6] !== null) {
        row[6] = existingEntry.values[6]; // Giữ lại số giờ chỉnh tay
      }
      return row;
    });

    for (let i = 0; i < payrollRows.length; i++) {
      const row = payrollRows[i];
      const key = buildPayrollKey(row);
      activePayrollKeys.add(key);
      const existingEntry = existingPayrollMap[key];
      if (existingEntry) {
        rowsToUpdate.push({ rowNumber: existingEntry.rowNumber, values: row });
      } else {
        rowsToAppend.push(row);
      }
    }

    rowsToUpdate.forEach(item => {
      paySheet.getRange(item.rowNumber, 1, 1, item.values.length).setValues([item.values]);
    });

    if (rowsToAppend.length > 0) {
      const appendStartRow = Math.max(paySheet.getLastRow(), 1) + 1;
      paySheet.getRange(appendStartRow, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
    }

    const affectedRows = rowsToUpdate.map(item => item.rowNumber);
    const appendStartRow = rowsToAppend.length > 0 ? paySheet.getLastRow() - rowsToAppend.length + 1 : null;
    if (appendStartRow) {
      for (let r = appendStartRow; r < appendStartRow + rowsToAppend.length; r++) {
        affectedRows.push(r);
      }
    }

    affectedRows.forEach(rowNo => {
      paySheet.getRange(rowNo, 9).setFormula(`=G${rowNo}*H${rowNo}`);
      paySheet.getRange(rowNo, 12).setFormula(`=J${rowNo}*K${rowNo}`);
      paySheet.getRange(rowNo, 13).setFormula(`=0`);
      paySheet.getRange(rowNo, 14).setFormula(`=I${rowNo}+L${rowNo}`);
      paySheet.getRange(rowNo, 15).setFormula(`=N${rowNo}*10%`);
      paySheet.getRange(rowNo, 16).setFormula(`=N${rowNo}-O${rowNo}`);
    });

    const staleRows = Object.keys(existingPayrollMap)
      .filter(key => !activePayrollKeys.has(key))
      .map(key => existingPayrollMap[key].rowNumber)
      .sort((a, b) => b - a);

    staleRows.forEach(rowNumber => paySheet.deleteRow(rowNumber));

    const finalLastRow = paySheet.getLastRow();
    const numRows = Math.max(finalLastRow - 1, 0);
    if (numRows > 0) {
      paySheet.getRange(2, 7, numRows, 1).setNumberFormat("#,##0.0");
      paySheet.getRange(2, 8, numRows, 2).setNumberFormat("#,##0₫");
      paySheet.getRange(2, 10, numRows, 1).setNumberFormat("#,##0₫");
      paySheet.getRange(2, 11, numRows, 1).setNumberFormat("0.00%");
      paySheet.getRange(2, 12, numRows, 5).setNumberFormat("#,##0₫");
    }

    SpreadsheetApp.getUi().alert(`Hoàn tất! Đã đồng bộ chính xác Lương & % Hoa Hồng mới từ Base_Salary_Card.`);
  } else {
    SpreadsheetApp.getUi().alert("Không có ca live hợp lệ nào để tính lương!");
  }
}
