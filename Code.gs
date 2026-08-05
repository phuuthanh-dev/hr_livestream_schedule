const SOURCE_FOLDER_ID = '1UL9AqGk8uIsE9s2keV5M1xnourwDjPUz'; 
const PROCESSED_FOLDER_ID = '1HAoSX5GChY7WYqYNS4nji0IXime6Q_L_'; 
const SCHEDULE_FILE_ID = '12WU5jM-KC9EngkA_xBS3U82KYnO-8RMwGwk9fwcGe3o'; 
const APP_TZ = 'Asia/Saigon';
const DEFAULT_SCHEDULE_LOCATION_FOR_BOTH = 'Home';

function safeAlert(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    Logger.log(message);
  }
}

function getAppTimeZone() {
  return APP_TZ;
}

function buildValidatedDate(year, month, day, hour, minute) {
  const safeHour = Number.isFinite(hour) ? hour : 0;
  const safeMinute = Number.isFinite(minute) ? minute : 0;
  const date = new Date(year, month - 1, day, safeHour, safeMinute, 0, 0);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== safeHour ||
    date.getMinutes() !== safeMinute
  ) {
    return null;
  }

  return date;
}

function parseFlexibleDateValue(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    return new Date(value.getTime());
  }

  const raw = value.toString().trim();
  if (!raw) return null;

  const normalized = raw.replace(/\u200b/g, '').replace(/\./g, '/').replace(/\s+/g, ' ');

  let match = normalized.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[T\s]+(\d{1,2})(?::(\d{2}))?)?/);
  if (match) {
    return buildValidatedDate(
      parseInt(match[1], 10),
      parseInt(match[2], 10),
      parseInt(match[3], 10),
      parseInt(match[4] || '0', 10),
      parseInt(match[5] || '0', 10)
    );
  }

  match = normalized.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:[T\s]+(\d{1,2})(?::(\d{2}))?)?/);
  if (match) {
    const first = parseInt(match[1], 10);
    const second = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    const hour = parseInt(match[4] || '0', 10);
    const minute = parseInt(match[5] || '0', 10);
    const candidates = [];

    if (first > 12 && second <= 12) {
      candidates.push({ day: first, month: second });
    } else if (second > 12 && first <= 12) {
      candidates.push({ day: second, month: first });
    } else {
      // Ưu tiên dd/MM/yyyy vì toàn bộ file vận hành đang dùng chuẩn này.
      candidates.push({ day: first, month: second });
      if (first !== second) {
        candidates.push({ day: second, month: first });
      }
    }

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const parsed = buildValidatedDate(year, candidate.month, candidate.day, hour, minute);
      if (parsed) return parsed;
    }

    return null;
  }

  const directDate = new Date(raw);
  if (!isNaN(directDate.getTime())) {
    return directDate;
  }

  return null;
}

function formatAppDateValue(value) {
  const parsed = parseFlexibleDateValue(value);
  if (!parsed) {
    return value ? value.toString().trim() : '';
  }

  return Utilities.formatDate(parsed, getAppTimeZone(), 'dd/MM/yyyy');
}

function getAppDateParts(value) {
  const parsed = parseFlexibleDateValue(value);
  if (!parsed) return null;

  return {
    dateStr: Utilities.formatDate(parsed, getAppTimeZone(), 'dd/MM/yyyy'),
    minutes: parseInt(Utilities.formatDate(parsed, getAppTimeZone(), 'H'), 10) * 60 +
             parseInt(Utilities.formatDate(parsed, getAppTimeZone(), 'm'), 10)
  };
}

function getDefaultScheduleLocation(allowedLocation, currentFormat) {
  const safeAllowed = allowedLocation ? allowedLocation.toString().trim() : '';
  if (!safeAllowed) return '';
  const safeCurrent = currentFormat ? currentFormat.toString().trim() : '';

  const normalizedAllowed = safeAllowed.toLowerCase();
  const normalizedCurrent = safeCurrent.toLowerCase();

  if (normalizedAllowed === 'both') {
    return safeCurrent || DEFAULT_SCHEDULE_LOCATION_FOR_BOTH;
  }

  if (normalizedAllowed === 'home') return 'Home';
  if (normalizedAllowed === 'studio') {
    if (safeCurrent && normalizedCurrent !== 'home') return safeCurrent;
    return 'Studio';
  }

  return safeAllowed;
}

function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Vận hành Livestream 🚀')
    .addSubMenu(
      ui.createMenu('Đồng bộ dữ liệu')
        .addItem('Đồng bộ danh sách Host', 'syncPortfolioMaster')
        .addItem('Đồng bộ danh sách Support', 'syncSupportMasterFromSource')
        .addItem('Đồng bộ lịch live', 'syncAndUnpivotSchedule')
        .addItem('Cập nhật Địa điểm + Kênh live', 'autoFillLocationToSchedule')
        .addItem('Resolve conflict lịch', 'resolveScheduleConflicts')
        .addItem('Tạo real schedule', 'buildRealScheduleFromMaster')
    )
    .addSubMenu(
      ui.createMenu('Dữ liệu TikTok')
        .addItem('Nhập dữ liệu doanh số TikTok', 'importTikTokSalesData')
    )
    .addSubMenu(
      ui.createMenu('Đánh giá và lương')
        .addItem('Chạy đánh giá nhân sự', 'runGradeReviewEngine')
        .addItem('Tính lương', 'runFullPayrollEngine')
    )
    .addToUi();
}

function importTikTokSalesData() {
  const masterSs = SpreadsheetApp.getActiveSpreadsheet();
  const targetSheet = masterSs.getSheetByName('TikTok_Sales_Import');
  const scriptTz = getAppTimeZone();
  
  if (!targetSheet) {
    Logger.log("Lỗi: Không tìm thấy tab TikTok_Sales_Import");
    return;
  }

  // --- BƯỚC 1: ĐỌC DỮ LIỆU TỪ FILE LỊCH LIVE ---
  let scheduleData = [];
  let scheduleIndexes = {
    date: 2,
    time: 3,
    host: 4,
    support: 7,
    channel: 8,
    status: 10,
    sessionId: 13,
    conflictRowStatus: -1
  };
  const scheduleSheet = masterSs.getSheetByName('Live_Session_Master');
  if (!scheduleSheet) {
    Logger.log("Lỗi: Không tìm thấy tab Live_Session_Master. Hãy chạy syncAndUnpivotSchedule() trước.");
    return;
  }
  scheduleData = scheduleSheet.getDataRange().getValues();

  if (scheduleData.length > 0) {
    const scheduleHeaders = scheduleData[0].map(h => normalizeText(h));
    const detectedDateIdx = scheduleHeaders.findIndex(h => h.includes('ngày'));
    const detectedTimeIdx = scheduleHeaders.findIndex(h => h.includes('khung giờ') || h.includes('slot'));
    const detectedHostIdx = scheduleHeaders.findIndex(h => h.includes('mã') && !h.includes('support'));
    const detectedSupportIdx = scheduleHeaders.findIndex(h => h.includes('support'));
    const detectedChannelIdx = scheduleHeaders.findIndex(h => h.includes('kênh') || h.includes('tài khoản'));
    const detectedStatusIdx = scheduleHeaders.findIndex(h => h.includes('trạng thái') || h.includes('status'));
    const detectedSessionIdx = scheduleHeaders.findIndex(h => h.includes('session_id'));
    const detectedConflictRowStatusIdx = scheduleHeaders.findIndex(h => h.includes('conflict_row_status'));

    if (detectedDateIdx !== -1) scheduleIndexes.date = detectedDateIdx;
    if (detectedTimeIdx !== -1) scheduleIndexes.time = detectedTimeIdx;
    if (detectedHostIdx !== -1) scheduleIndexes.host = detectedHostIdx;
    if (detectedSupportIdx !== -1) scheduleIndexes.support = detectedSupportIdx;
    if (detectedChannelIdx !== -1) scheduleIndexes.channel = detectedChannelIdx;
    if (detectedStatusIdx !== -1) scheduleIndexes.status = detectedStatusIdx;
    if (detectedSessionIdx !== -1) scheduleIndexes.sessionId = detectedSessionIdx;
    if (detectedConflictRowStatusIdx !== -1) scheduleIndexes.conflictRowStatus = detectedConflictRowStatusIdx;
  }

  function toDateParts(value) {
    return getAppDateParts(value);
  }

  function parseScheduleSlot(slotValue) {
    if (!slotValue) return null;

    if (slotValue instanceof Date && !isNaN(slotValue)) {
      const startMinutes = parseInt(Utilities.formatDate(slotValue, scriptTz, 'H'), 10) * 60 +
                           parseInt(Utilities.formatDate(slotValue, scriptTz, 'm'), 10);
      return { startMinutes, endMinutes: startMinutes + 120 };
    }

    const raw = slotValue.toString().trim();
    if (!raw) return null;

    const times = raw.match(/\d{1,2}:\d{2}/g);
    if (times && times.length >= 2) {
      const [startHour, startMinute] = times[0].split(':').map(Number);
      const [endHour, endMinute] = times[1].split(':').map(Number);
      let startMinutes = startHour * 60 + startMinute;
      let endMinutes = endHour * 60 + endMinute;
      if (endMinutes <= startMinutes) endMinutes += 24 * 60;
      return { startMinutes, endMinutes };
    }

    const singleHour = raw.match(/^\d{1,2}$/);
    if (singleHour) {
      const startMinutes = parseInt(singleHour[0], 10) * 60;
      return { startMinutes, endMinutes: startMinutes + 120 };
    }

    return null;
  }

  function normalizeText(value) {
    return (value || '').toString().trim().toLowerCase();
  }

  function normalizeChannelKey(value) {
    return normalizeText(value).replace(/[^a-z0-9]/g, '');
  }

  function uniqueJoined(values, fallbackValue) {
    const cleaned = values
      .map(v => (v || '').toString().trim())
      .filter(v => v && !['trống', 'unknown', 'no_host', 'no_support'].includes(v.toLowerCase()));

    return cleaned.length ? [...new Set(cleaned)].join(', ') : fallbackValue;
  }

  function isFilledSupport(value) {
    const normalized = normalizeText(value);
    return normalized && !['trống', 'unknown', 'no_support'].includes(normalized);
  }

  function getStatusPriority(statusValue) {
    const status = normalizeText(statusValue);
    if (!status) return 0;
    if (
      status.includes('hoàn thành') ||
      status.includes('hoan thanh') ||
      status.includes('đã live') ||
      status.includes('da live') ||
      status.includes('done') ||
      status.includes('completed')
    ) {
      return 3;
    }
    if (
      status.includes('đang live') ||
      status.includes('dang live') ||
      status.includes('đã lên lịch') ||
      status.includes('da len lich') ||
      status.includes('confirmed') ||
      status.includes('xac nhan')
    ) {
      return 2;
    }
    return 1;
  }

  function getConflictRowPriority(conflictRowStatusValue) {
    const value = normalizeText(conflictRowStatusValue);
    if (value === 'winner' || value === 'no conflict') return 3;
    if (!value) return 1;
    if (value === 'manual review') return 0;
    if (value === 'loser') return -1;
    return 1;
  }

  function chooseBestScheduleMatch(matches) {
    if (!matches.length) {
      return { sessionId: "", hostId: "Unknown", supportId: "No_Support" };
    }

    matches.sort((a, b) => {
      const conflictDiff = getConflictRowPriority(b.conflictRowStatus) - getConflictRowPriority(a.conflictRowStatus);
      if (conflictDiff !== 0) return conflictDiff;

      const statusDiff = getStatusPriority(b.status) - getStatusPriority(a.status);
      if (statusDiff !== 0) return statusDiff;

      const supportDiff = Number(isFilledSupport(b.supportId)) - Number(isFilledSupport(a.supportId));
      if (supportDiff !== 0) return supportDiff;

      return 0;
    });

    const best = matches[0];
    return {
      sessionId: best.sessionId || "",
      hostId: best.hostId || "Unknown",
      supportId: best.supportId || "No_Support"
    };
  }

  function findHostAndSupport(liveDateObj, accountId) {
    if (!liveDateObj || scheduleData.length < 2) {
      return { sessionId: "", hostId: "Unknown", supportId: "Unknown" };
    }

    const liveParts = toDateParts(liveDateObj);
    if (!liveParts) return { sessionId: "", hostId: "Unknown", supportId: "Unknown" };
    const normalizedAccountId = normalizeChannelKey(accountId);

    const matchedRows = [];

    for (let i = 1; i < scheduleData.length; i++) {
      let row = scheduleData[i];
      let schedDate = row[scheduleIndexes.date];
      let schedTime = row[scheduleIndexes.time];
      let liveChannel = row[scheduleIndexes.channel];
      
      if (!schedDate || !schedTime) continue;
      if (normalizedAccountId && normalizeChannelKey(liveChannel) !== normalizedAccountId) continue;

      const schedDateParts = toDateParts(schedDate);
      const schedSlot = parseScheduleSlot(schedTime);
      if (!schedDateParts || !schedSlot) continue;

      let liveMinutes = liveParts.minutes;
      if (schedSlot.endMinutes > 24 * 60 && liveMinutes < schedSlot.startMinutes) {
        liveMinutes += 24 * 60;
      }

      if (
        schedDateParts.dateStr === liveParts.dateStr &&
        liveMinutes >= schedSlot.startMinutes &&
        liveMinutes <= schedSlot.endMinutes
      ) {
        matchedRows.push({
          sessionId: row[scheduleIndexes.sessionId] || "",
          hostId: row[scheduleIndexes.host] || "No_Host",
          supportId: row[scheduleIndexes.support] || "No_Support",
          status: row[scheduleIndexes.status] || "",
          conflictRowStatus: scheduleIndexes.conflictRowStatus !== -1 ? (row[scheduleIndexes.conflictRowStatus] || "") : ""
        });
      }
    }

    return chooseBestScheduleMatch(matchedRows);
  }

  // --- BƯỚC 2: ĐỌC REPORT TIKTOK VÀ MAPPING ---
  const sourceFolder = DriveApp.getFolderById(SOURCE_FOLDER_ID);
  let processedFolder = null;
  if (PROCESSED_FOLDER_ID) {
    try { processedFolder = DriveApp.getFolderById(PROCESSED_FOLDER_ID); } catch(e) {}
  }
  
  const files = sourceFolder.searchFiles("title contains 'Transaction_Analysis_Live_List' and trashed = false");
  let importedRows = 0;

  while (files.hasNext()) {
    const file = files.next();
    
    if (file.getName().includes('.EMPTY.txt')) {
       if (processedFolder) file.moveTo(processedFolder);
       continue;
    }
    
    try {
      const reportSs = SpreadsheetApp.openById(file.getId());
      const reportSheet = reportSs.getSheets()[0];
      const data = reportSheet.getDataRange().getValues();
      
      if (data.length > 2) {
        let rowsToImport = [];
        
        for (let i = 2; i < data.length; i++) {
          const row = data[i];
          const liveID = row[1];
          if (!liveID || liveID.toString().length < 10) continue; 
          
          const cleanCurrency = (val) => parseFloat((val||"").toString().replace(/[₫,.\s]/g, '').trim()) || 0;
          const cleanNumber = (val) => parseFloat((val||"").toString().replace(/,/g, '').trim()) || 0;

          const liveTitle = row[0];
          const liveStart = row[2];        
          const endTime = row[3];
          const creatorName = row[4]; 
          
          const matchingStaff = findHostAndSupport(liveStart, creatorName);
          const mappedSessionId = matchingStaff.sessionId;
          const hostID = matchingStaff.hostId;
          const supportID = matchingStaff.supportId;
          
          const shortLiveId = liveID.toString().slice(-8); 
          const sessionID = mappedSessionId || `SS-${shortLiveId}-${hostID}`;

          const grossGMV = cleanCurrency(row[6]);      
          const itemsSold = cleanNumber(row[7]);
          const returnedGMV = cleanCurrency(row[8]);   
          const grossOrders = cleanNumber(row[9]);      
          const aov = cleanCurrency(row[10]);
          
          const avgViewTime = row[11];
          const likes = cleanNumber(row[12]);
          const comments = cleanNumber(row[13]);
          const shares = cleanNumber(row[14]);
          
          const productImp = cleanNumber(row[15]);
          const productClicks = cleanNumber(row[16]);
          const impressions = cleanNumber(row[17]);
          const showGPM = cleanCurrency(row[18]);
          
          const engagement = cleanNumber(row[21]);
          const ctr = row[22]; 
          const tapRate = row[24];
          const estCommission = cleanCurrency(row[25]);

          // --- ĐÃ XOÁ BỎ CÁC CỘT TRỐNG DƯ THỪA, CHỪA LẠI GMV VÀ ORDERS ---
          const newRow = [
            sessionID,        // A: Session_ID
            liveID,           // B: TikTok_Live_ID
            creatorName,      // C: Account_ID 
            liveStart,        // D: Start_Time 
            endTime,          // E: End_Time 
            returnedGMV,      // F: Returned_GMV
            grossOrders,      // G: Gross_Orders
            grossGMV,         // H: Gross_GMV
            file.getName(),   // I: Source_Period 
            "Auto Mapped",    // J: Note
            hostID,           // K: Host_ID
            supportID,        // L: Support_ID
            liveTitle,        // M: Live_Title
            itemsSold,        // N: Items_Sold
            aov,              // O: AOV
            avgViewTime,      // P: Avg_View_Duration
            likes,            // Q: Likes
            comments,         // R: Comments
            shares,           // S: Shares
            productImp,       // T: Product_Impressions
            productClicks,    // U: Product_Clicks
            impressions,      // V: Impressions
            showGPM,          // W: Show_GPM
            engagement,       // X: Engagement
            ctr,              // Y: CTR
            tapRate,          // Z: Tap_Through_Rate
            estCommission     // AA: Estimated_Commission
          ];
          
          rowsToImport.push(newRow);
        }
        
        if (rowsToImport.length > 0) {
          const lastRow = Math.max(targetSheet.getLastRow(), 1);
          targetSheet.getRange(lastRow + 1, 1, rowsToImport.length, rowsToImport[0].length).setValues(rowsToImport);
          importedRows += rowsToImport.length;
        }
      }
      
      if (processedFolder) file.moveTo(processedFolder);
      
    } catch (e) {
      Logger.log("Lỗi xử lý file " + file.getName() + ": " + e.message);
    }
  }
  
  Logger.log("Hoàn tất! Đã map thành công " + importedRows + " dòng.");
}

function setupHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('TikTok_Sales_Import');
  
  if (!sheet) {
    sheet = ss.insertSheet('TikTok_Sales_Import');
  }
  
  // Đã rút gọn tiêu đề, xóa bỏ các cột không có dữ liệu
  const headers = [
    "Session_ID", "TikTok_Live_ID", "Account_ID", "Start_Time", "End_Time", 
    "Returned_GMV", "Gross_Orders", "Gross_GMV", "Source_Period", "Note", 
    "Host_ID", "Support_ID", "Live_Title", "Items_Sold", "AOV", "Avg_View_Duration", 
    "Likes", "Comments", "Shares", "Product_Impressions", "Product_Clicks", 
    "Impressions", "Show_GPM", "Engagement", "CTR", "Tap_Through_Rate", "Estimated_Commission"
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#f3f3f3");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
  
  Logger.log("Đã cập nhật lại toàn bộ tiêu đề.");
}
