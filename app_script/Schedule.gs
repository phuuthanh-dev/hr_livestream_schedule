// ===========================================================================
// SỬA LỖI ĐỒNG BỘ: CHỐNG TRÙNG CA SUPPORT VÀ CHỐNG PHÂN THÂN NHÂN SỰ
// ===========================================================================
const LIVE_SESSION_BASE_HEADERS = [
  "STT",
  "Thứ",
  "Ngày",
  "Khung giờ",
  "Mã nhân sự",
  "Tên Host",
  "Hình thức",
  "Mã Nhân sự Support live",
  "Tên Support live",
  "Live_Channel_Id",
  "Kịch Bản",
  "Session_ID"
];

const LIVE_SESSION_BASE_COLUMN_COUNT = LIVE_SESSION_BASE_HEADERS.length;
const LIVE_SESSION_SUPPORT_ID_INDEX = LIVE_SESSION_BASE_HEADERS.indexOf("Mã Nhân sự Support live");
const LIVE_SESSION_SUPPORT_NAME_INDEX = LIVE_SESSION_BASE_HEADERS.indexOf("Tên Support live");
const LIVE_SESSION_CHANNEL_INDEX = LIVE_SESSION_BASE_HEADERS.indexOf("Live_Channel_Id");
const LIVE_SESSION_SESSION_INDEX = LIVE_SESSION_BASE_HEADERS.indexOf("Session_ID");
const LIVE_SESSION_TRACKING_HEADERS = [
  "Host_Live_Confirm",
  "Support_Live_Confirm",
  "Backup_Host_ID",
  "Backup_Host_Name",
  "Backup_Support_ID",
  "Backup_Support_Name"
];
const LIVE_SESSION_INTERNAL_HEADERS = [
  "Support_Candidate_Pool"
];
const LIVE_SESSION_SUPPORT_POOL_HEADER = LIVE_SESSION_INTERNAL_HEADERS[0];
const LIVE_SESSION_SUPPORT_POOL_INDEX = LIVE_SESSION_BASE_COLUMN_COUNT + LIVE_SESSION_TRACKING_HEADERS.length;
const REMOVED_LIVE_SESSION_HEADERS = [
  "Checklist Kỹ thuật (Remote)",
  "SCM_Ready",
  "Trạng thái",
  "Ghi chú/Kết quả sơ bộ trong quá trình live",
  "Ops_Ready"
];
const SUPPORT_SHIFT_WINDOWS = [
  { startMinutes: 6 * 60, endMinutes: 10 * 60, label: "06:00 - 10:00" },
  { startMinutes: 10 * 60, endMinutes: 14 * 60, label: "10:00 - 14:00" },
  { startMinutes: 14 * 60, endMinutes: 18 * 60, label: "14:00 - 18:00" },
  { startMinutes: 18 * 60, endMinutes: 22 * 60, label: "18:00 - 22:00" }
];

function showScheduleSyncAlert_(message, options) {
  if (options && options.suppressAlert) {
    Logger.log(message);
    return { success: false, message: message };
  }

  safeAlert(message);
  return { success: false, message: message };
}

function syncScheduleMasterData_() {
  const summary = {
    portfolio: null,
    support: null
  };

  if (typeof syncPortfolioMaster === 'function') {
    summary.portfolio = syncPortfolioMaster({ showAlert: false });
  }

  if (typeof syncSupportMasterFromSource === 'function') {
    summary.support = syncSupportMasterFromSource({ showAlert: false });
  }

  SpreadsheetApp.flush();
  return summary;
}

function syncAndUnpivotSchedule(options) {
  const config = Object.assign({ futureOnly: true }, options || {});
  const todayLabel = formatAppDateValue(new Date());
  const targetDateLabel = getScheduleTargetDateLabel(config);
  const scopeLabel = getScheduleScopeLabel(config);
  let masterSyncSummary = null;
  let sourceRefreshSummary = null;

  try {
    masterSyncSummary = syncScheduleMasterData_();
  } catch (error) {
    return showScheduleSyncAlert_(`Không thể đồng bộ Portfolio_Master / Support_Master trước khi chạy schedule: ${error.message}`, config);
  }

  try {
    sourceRefreshSummary = refreshSourceLiveStreamSchedule_({
      skipLock: Boolean(config.externalLockHeld)
    });
  } catch (error) {
    return showScheduleSyncAlert_(`Không thể làm mới schedule ở file nguồn: ${error.message}`, config);
  }
  
  let sourceSs;
  try {
    sourceSs = SpreadsheetApp.openById(SOURCE_SCHEDULE_SPREADSHEET_ID);
  } catch (e) {
    return showScheduleSyncAlert_("Không thể kết nối File Nguồn. Kiểm tra lại ID!", config);
  }
  
  const sourceSheet = sourceSs.getSheetByName('LIVE STREAM/ SCHEDULE');
  if (!sourceSheet) {
    return showScheduleSyncAlert_("Không tìm thấy tab 'LIVE STREAM/ SCHEDULE'!", config);
  }
  
  const destSs = SpreadsheetApp.getActiveSpreadsheet();
  let destSheet = destSs.getSheetByName('Live_Session_Master');
  if (!destSheet) {
    destSheet = destSs.insertSheet('Live_Session_Master');
  }

  const sourceData = sourceSheet.getDataRange().getValues();
  if (sourceData.length <= 1) {
    return showScheduleSyncAlert_("Tab 'LIVE STREAM/ SCHEDULE' chưa có dữ liệu!", config);
  }

  const portfolioMap = buildPortfolioConflictMap(destSs);
  const supportMap = buildSupportConflictMap(destSs);
  const existingScheduleLookup = buildScheduleExistingRowLookup(destSheet);

  // 1. DÒ CỘT CHUẨN XÁC TỪ FILE NGUỒN
  const srcHeaders = sourceData[0].map(h => normalizeScheduleTrackingText(h));

  let sttIdx     = srcHeaders.findIndex(h => h.includes("stt"));
  let thuIdx     = srcHeaders.findIndex(h => h.includes("thu"));
  let ngayIdx    = srcHeaders.findIndex(h => h.includes("ngay"));
  let slotIdx    = srcHeaders.findIndex(h => h.includes("khung gio") || h.includes("slot"));
  let idIdx      = srcHeaders.findIndex(h =>
    (h.includes("ma") || h.includes("id")) &&
    !h.includes("support") &&
    !h.includes("confirm") &&
    !h.includes("backup")
  );
  let nameIdx    = srcHeaders.findIndex(h => h.includes("ten") || h.includes("full_name"));
  let suppIdx    = srcHeaders.findIndex(h =>
    h.includes("support") &&
    !h.includes("confirm") &&
    !h.includes("backup")
  );
  let kenhIdx    = srcHeaders.findIndex(h => h.includes("kenh") || h.includes("tai khoan"));
  let kichBanIdx = srcHeaders.findIndex(h => h.includes("kich ban"));
  if (sttIdx === -1) sttIdx = 0;
  if (thuIdx === -1) thuIdx = 1;
  if (ngayIdx === -1) ngayIdx = 2;
  if (slotIdx === -1) slotIdx = 3;
  if (idIdx === -1) idIdx = 4;
  if (nameIdx === -1) nameIdx = 5;
  if (suppIdx === -1) suppIdx = 7;

  let normalizedItems = [];
  let skippedByCast = 0;

  // 2. DUYỆT TỪNG CA LIVE VÀ GIỮ NGUYÊN CANDIDATE SUPPORT CHO BƯỚC CHỌN 4 TIẾNG
  for (let i = 1; i < sourceData.length; i++) {
    let rawHostIds   = sourceData[i][idIdx] ? sourceData[i][idIdx].toString().trim() : "";
    let rawHostNames = sourceData[i][nameIdx] ? sourceData[i][nameIdx].toString().trim() : "";
    let rawSuppIds   = (suppIdx !== -1 && sourceData[i][suppIdx]) ? sourceData[i][suppIdx].toString().trim() : "";
    let thuVal  = sourceData[i][thuIdx] || "";
    let ngayVal = sourceData[i][ngayIdx] || "";
    let slotVal = sourceData[i][slotIdx] || "";
    // Hình thức không còn đọc từ file nguồn; luôn backfill theo Portfolio_Master.Allowed_Location.
    let kenhVal    = (kenhIdx !== -1) ? sourceData[i][kenhIdx] : "";
    let kichBanVal = (kichBanIdx !== -1) ? sourceData[i][kichBanIdx] : "";

    // Chuẩn hóa mọi kiểu nhập ngày về cùng một định dạng dd/MM/yyyy.
    let dateStr = formatAppDateValue(ngayVal);
    const hasScheduleContext = Boolean(
      (thuVal && thuVal.toString().trim()) ||
      dateStr ||
      (slotVal && slotVal.toString().trim()) ||
      (kenhVal && kenhVal.toString().trim()) ||
      (kichBanVal && kichBanVal.toString().trim())
    );

    if (!hasScheduleContext && (!rawHostIds || rawHostIds.toLowerCase().includes("trống")) && (!rawSuppIds || rawSuppIds.toLowerCase().includes("trống"))) {
      continue;
    }

    // Tách mảng danh sách Host & Support
    let hostIdList   = (rawHostIds && !rawHostIds.toLowerCase().includes("trống")) ? rawHostIds.split(',').map(s => s.trim()) : [];
    let hostNameList = (rawHostNames && !rawHostNames.toLowerCase().includes("trống")) ? rawHostNames.split(',').map(s => s.trim()) : [];
    let suppIdList   = (rawSuppIds && !rawSuppIds.toLowerCase().includes("trống") && !rawSuppIds.toLowerCase().includes("no_support")) ? rawSuppIds.split(',').map(s => s.trim()) : [];

    const supportCandidateIds = normalizeScheduleCandidatePool(suppIdList);
    const hasMeaningfulHostInput = hostIdList.some(hostId => isMeaningfulScheduleValue(hostId));
    const hasMeaningfulSupportInput = supportCandidateIds.length > 0;

    if (!hasMeaningfulHostInput && !hasMeaningfulSupportInput) {
      continue;
    }

    const eligibleHosts = hostIdList
      .map((hostId, index) => ({
        hostId: hostId ? hostId.toString().trim() : "",
        hostName: hostNameList[index] || hostId || "",
        sourceIndex: index
      }))
      .filter(item => {
        if (!isMeaningfulScheduleValue(item.hostId)) {
          return false;
        }

        if (!isCastReadyHost(item.hostId, portfolioMap)) {
          skippedByCast++;
          return false;
        }

        return true;
      });

    if (eligibleHosts.length === 0) {
      if (!hasMeaningfulHostInput && hasMeaningfulSupportInput && hasScheduleContext) {
        const normalizedSupportId = suppIdList.length > 0 && isMeaningfulScheduleValue(suppIdList[0]) ? suppIdList[0] : "";
        const normalizedSupportName = normalizedSupportId && supportMap[normalizedSupportId]
          ? supportMap[normalizedSupportId].name || normalizedSupportId
          : "";

        normalizedItems.push({
        rowNumber: normalizedItems.length + 2,
        slotKey: `${dateStr}__${slotVal}`,
        supportShiftKey: buildScheduleSupportShiftKey(dateStr, slotVal),
        slotValue: slotVal,
        pairIndex: 0,
        hostId: "",
        hostName: "",
        supportId: normalizedSupportId,
        supportName: normalizedSupportName,
        supportCandidateIds,
          formatValue: "",
          values: [
            0,
            thuVal,
            dateStr,
            slotVal,
            "",
            "",
            "",
            normalizedSupportId,
            normalizedSupportName,
            kenhVal,
            kichBanVal,
            buildScheduleSessionId(dateStr, slotVal, "", normalizedSupportId),
            "",
            ""
          ]
        });
      }
      continue;
    }

    for (let k = 0; k < eligibleHosts.length; k++) {
      const hostEntry = eligibleHosts[k];
      let singleHostId = hostEntry.hostId;
      let singleHostName = hostEntry.hostName || singleHostId;
      const supportShiftKey = buildScheduleSupportShiftKey(dateStr, slotVal);

      // Nếu thiếu support ở đúng index của host hợp lệ thì coi như không có cặp support hợp lệ.
      let candidateSuppId = suppIdList[hostEntry.sourceIndex] ? suppIdList[hostEntry.sourceIndex] : "No_Support";
      let finalSuppId = candidateSuppId;

      const hostKey = buildScheduleHostIdentityKey(dateStr, slotVal, singleHostId);
      const existingEntry = existingScheduleLookup[hostKey] || {};
      const effectiveFormat = getPreferredScheduleFormatForHost(
        singleHostId,
        existingEntry.format || "",
        portfolioMap
      );
      const normalizedSupportId = isMeaningfulScheduleValue(finalSuppId) ? finalSuppId : "";
      const normalizedSupportName = normalizedSupportId && supportMap[normalizedSupportId]
        ? supportMap[normalizedSupportId].name || normalizedSupportId
        : "";
      const sessionId = buildScheduleSessionId(dateStr, slotVal, singleHostId, normalizedSupportId);

      normalizedItems.push({
        rowNumber: normalizedItems.length + 2,
        slotKey: `${dateStr}__${slotVal}`,
        supportShiftKey,
        slotValue: slotVal,
        pairIndex: hostEntry.sourceIndex,
        hostId: singleHostId,
        hostName: singleHostName,
        supportId: normalizedSupportId,
        supportName: normalizedSupportName,
        supportCandidateIds,
        formatValue: effectiveFormat,
        values: [
          0,               // Cột 1: STT
          thuVal,          // Cột 2: Thứ
          dateStr,         // Cột 3: Ngày
          slotVal,         // Cột 4: Khung giờ
          singleHostId,    // Cột 5: Mã Host
          singleHostName,  // Cột 6: Tên Host
          effectiveFormat, // Cột 7: Hình thức
          normalizedSupportId, // Cột 8: Mã Support
          normalizedSupportName, // Cột 9: Tên Support
          kenhVal,         // Cột 10: Live_Channel_Id
          kichBanVal,      // Cột 11: Kịch Bản
          sessionId,       // Cột 12: Session_ID
          "",
          ""
        ]
      });
    }
  }

  applyHomeSupportRuleToScheduleItems(normalizedItems, portfolioMap);
  alignSupportAssignmentsWithinShift(normalizedItems, supportMap);
  alignSupportOnlyRowsWithinShift(normalizedItems, supportMap);
  const normalizedRowEntries = normalizedItems
    .filter(item => shouldKeepMasterScheduleRow(item.formatValue, item.supportId))
    .map((item, index) => {
      const row = item.values.slice();
      row[0] = index + 1;
      row[6] = item.formatValue || "";
      row[LIVE_SESSION_SUPPORT_ID_INDEX] = item.supportId || "";
      row[LIVE_SESSION_SUPPORT_NAME_INDEX] = item.supportName || "";
      row[LIVE_SESSION_SESSION_INDEX] = buildScheduleSessionId(row[2], row[3], item.hostId, item.supportId);
      if (!item.supportId) {
        row[LIVE_SESSION_BASE_COLUMN_COUNT + 1] = "";
      }
      return {
        row,
        supportCandidatePool: serializeScheduleCandidatePool(
          (item.supportCandidateIds || []).concat(item.supportId ? [item.supportId] : [])
        )
      };
    });
  const normalizedRows = normalizedRowEntries.map(entry => entry.row);
  const scopedNormalizedRowEntries = normalizedRowEntries.filter(entry => isScheduleDateInScope(entry.row[2], config));
  const scopedNormalizedRows = scopedNormalizedRowEntries.map(entry => entry.row);

  function buildRowKey(row) {
    const hostKey = buildScheduleHostIdentityKey(row[2], row[3], row[4]);
    if (hostKey) {
      return hostKey;
    }

    const sessionId = row[LIVE_SESSION_SESSION_INDEX] ? row[LIVE_SESSION_SESSION_INDEX].toString().trim() : "";
    const hostId = row[4] ? row[4].toString().trim() : "";
    return `${sessionId}__${hostId}`;
  }

  // 3. KHỞI TẠO VÀ GHI DỮ LIỆU CHUẨN RA LIVE_SESSION_MASTER
  const destHeaders = LIVE_SESSION_BASE_HEADERS.slice();

  removeColumnsByHeaders(destSheet, REMOVED_LIVE_SESSION_HEADERS);

  destSheet.getRange(1, 1, 1, destHeaders.length)
           .setValues([destHeaders])
           .setFontWeight("bold")
           .setBackground("#1f497d")
           .setFontColor("#ffffff");
  destSheet.setFrozenRows(1);
  const trackingHeaderMap = ensureRealScheduleTrackingColumns(destSheet);

  // Định dạng độ rộng cột
  destSheet.setColumnWidth(1, 60);  // STT
  destSheet.setColumnWidth(3, 110); // Ngày
  destSheet.setColumnWidth(4, 140); // Khung giờ
  destSheet.setColumnWidth(5, 120); // Mã Host
  destSheet.setColumnWidth(6, 180); // Tên Host
  destSheet.setColumnWidth(8, 140); // Mã Support
  destSheet.setColumnWidth(9, 170); // Tên Support
  destSheet.setColumnWidth(12, 200); // Session_ID

  const existingLastRow = destSheet.getLastRow();
  const existingData = existingLastRow > 1
    ? destSheet.getRange(2, 1, existingLastRow - 1, destHeaders.length).getValues()
    : [];
  const existingScopedRows = existingData.filter(row => isScheduleDateInScope(row[2], config));

  if (scopedNormalizedRows.length === 0 && existingScopedRows.length === 0) {
    if (targetDateLabel) {
      return showScheduleSyncAlert_(`Không có ca live ngày ${targetDateLabel} để sync.`, config);
    }

    return showScheduleSyncAlert_(
      `Không có ca live trong phạm vi ${scopeLabel} để sync. Dữ liệu ngoài phạm vi này được giữ nguyên.`,
      config
    );
  }

  if (normalizedRows.length <= 0 && existingData.length === 0) {
    return showScheduleSyncAlert_("Không có dữ liệu ca live hợp lệ để sync sang Live_Session_Master.", config);
  }

  if (scopedNormalizedRows.length === 0 && existingScopedRows.length === 0) {
    if (targetDateLabel) {
      return showScheduleSyncAlert_(`Không có ca live ngày ${targetDateLabel} để sync.`, config);
    }

    return showScheduleSyncAlert_(
      `Không có ca live ngày >= ${todayLabel} để sync. Dữ liệu ngày < ${todayLabel} được giữ nguyên.`,
      config
    );
  }

  const existingRowMap = {};
  const existingRowDataMap = {};
  for (let i = 0; i < existingData.length; i++) {
    if (!isScheduleDateInScope(existingData[i][2], config)) continue;
    const key = buildRowKey(existingData[i]);
    if (key !== "__") {
      existingRowMap[key] = i + 2;
      existingRowDataMap[key] = existingData[i];
    }
  }

  const incomingKeySet = new Set();
  const appendRows = [];
  let updatedCount = 0;
  let removedCount = 0;

  for (let i = 0; i < scopedNormalizedRows.length; i++) {
    const row = scopedNormalizedRows[i];
    row[0] = i + 1;
    const sheetRow = row.slice(0, LIVE_SESSION_BASE_COLUMN_COUNT);

    const key = buildRowKey(sheetRow);
    incomingKeySet.add(key);

    if (existingRowMap[key]) {
      const existingRow = existingRowDataMap[key];

      if (existingRow) {
        if (!sheetRow[6] && existingRow[6]) sheetRow[6] = existingRow[6]; // Hình thức
        if (existingRow[LIVE_SESSION_CHANNEL_INDEX]) sheetRow[LIVE_SESSION_CHANNEL_INDEX] = existingRow[LIVE_SESSION_CHANNEL_INDEX]; // Live_Channel_Id
      }

      destSheet.getRange(existingRowMap[key], 1, 1, destHeaders.length).setValues([sheetRow]);
      if (shouldResetSupportTracking(existingRow, sheetRow)) {
        clearSupportTrackingForRow(destSheet, existingRowMap[key], trackingHeaderMap);
      }
      updatedCount++;
    } else {
      appendRows.push({
        values: sheetRow
      });
    }
  }

  if (appendRows.length > 0) {
    const appendStartRow = destSheet.getLastRow() + 1;
    destSheet.getRange(appendStartRow, 1, appendRows.length, destHeaders.length)
      .setValues(appendRows.map(item => item.values));
  }

  const finalLastRow = destSheet.getLastRow();
  if (finalLastRow > 1) {
    const finalData = destSheet.getRange(2, 1, finalLastRow - 1, destHeaders.length).getValues();
    const rowsToDelete = [];

    for (let i = finalData.length - 1; i >= 0; i--) {
      const key = buildRowKey(finalData[i]);
      if (isScheduleDateInScope(finalData[i][2], config) && !incomingKeySet.has(key)) {
        rowsToDelete.push(i + 2);
      }
    }

    for (let i = 0; i < rowsToDelete.length; i++) {
      destSheet.deleteRow(rowsToDelete[i]);
    }
    removedCount = rowsToDelete.length;
  }

  const refreshedLastRow = destSheet.getLastRow();
  if (refreshedLastRow > 1) {
    const refreshedData = destSheet.getRange(2, 1, refreshedLastRow - 1, destHeaders.length).getValues();
    const supportPoolByRowKey = {};
    scopedNormalizedRowEntries.forEach(entry => {
      const rowKey = buildRowKey(entry.row);
      if (!rowKey) return;
      supportPoolByRowKey[rowKey] = entry.supportCandidatePool || "";
    });

    for (let i = 0; i < refreshedData.length; i++) {
      if (refreshedData[i][0] !== i + 1) {
        destSheet.getRange(i + 2, 1).setValue(i + 1);
      }
    }

    destSheet.getRange(2, 1, refreshedLastRow - 1, 1).setHorizontalAlignment("center");
    destSheet.getRange(2, 2, refreshedLastRow - 1, 3).setHorizontalAlignment("center");
    destSheet.getRange(2, 5, refreshedLastRow - 1, 1).setHorizontalAlignment("center");
    destSheet.getRange(2, 8, refreshedLastRow - 1, 1).setHorizontalAlignment("center");

    if (trackingHeaderMap[LIVE_SESSION_SUPPORT_POOL_HEADER] !== undefined) {
      const supportPoolCol = trackingHeaderMap[LIVE_SESSION_SUPPORT_POOL_HEADER] + 1;
      const currentSupportPoolValues = destSheet.getRange(2, supportPoolCol, refreshedData.length, 1).getValues();
      const supportPoolValues = refreshedData.map((row, index) => [
        isScheduleDateInScope(row[2], config)
          ? (supportPoolByRowKey[buildRowKey(row)] || "")
          : (currentSupportPoolValues[index][0] || "")
      ]);
      destSheet.getRange(
        2,
        supportPoolCol,
        supportPoolValues.length,
        1
      ).setValues(supportPoolValues);
    }
  }

  const hasScopedRowsRemaining = refreshedLastRow > 1 &&
    destSheet.getRange(2, 3, refreshedLastRow - 1, 1).getValues().some(row => isScheduleDateInScope(row[0], config));
  const conflictResult = hasScopedRowsRemaining
    ? resolveScheduleConflicts(false, targetDateLabel ? { skipPostAutoFill: true, targetDate: targetDateLabel } : { skipPostAutoFill: true, futureOnly: true })
    : null;
  const locationResult = hasScopedRowsRemaining
    ? autoFillLocationToSchedule(false, targetDateLabel ? { targetDate: targetDateLabel } : { futureOnly: true })
    : null;
  const alertLines = [
    targetDateLabel
      ? `Đã đồng bộ lịch live cho ngày ${targetDateLabel}: cập nhật ${updatedCount} dòng, thêm ${appendRows.length} dòng mới, xoá ${removedCount} dòng.`
      : `Đã đồng bộ lịch live cho các ngày ${scopeLabel}: cập nhật ${updatedCount} dòng, thêm ${appendRows.length} dòng mới, xoá ${removedCount} dòng.`
  ];

  if (masterSyncSummary) {
    const masterSummaryParts = [];
    if (masterSyncSummary.portfolio) {
      masterSummaryParts.push(masterSyncSummary.portfolio.success
        ? `Portfolio_Master: cập nhật ${masterSyncSummary.portfolio.updatedCount || 0}, thêm ${masterSyncSummary.portfolio.insertedCount || 0}, xoá ${masterSyncSummary.portfolio.deletedCount || 0}`
        : `Portfolio_Master: ${masterSyncSummary.portfolio.message || "không sync được"}`);
    }
    if (masterSyncSummary.support) {
      masterSummaryParts.push(masterSyncSummary.support.success
        ? `Support_Master: ${masterSyncSummary.support.syncedRows || 0} hồ sơ, bỏ qua ${masterSyncSummary.support.skippedRows || 0}`
        : `Support_Master: ${masterSyncSummary.support.message || "không sync được"}`);
    }
    if (masterSummaryParts.length > 0) {
      alertLines.push(`Master sync: ${masterSummaryParts.join("; ")}.`);
    }
  }

  if (sourceRefreshSummary) {
    alertLines.push(`Nguồn: dọn ${sourceRefreshSummary.cleanedHostCells} ô host, ${sourceRefreshSummary.cleanedSupportCells} ô support, build ${sourceRefreshSummary.aggregateRows} dòng ở LIVE STREAM/ SCHEDULE.`);
  }
  if (hasScopedRowsRemaining) {
    alertLines.push(`Đã tự cập nhật Location + Kênh live cho phạm vi ${scopeLabel}.`);
  }
  if (skippedByCast > 0) {
    alertLines.push(`Loại ${skippedByCast} host chưa Đồng ý Cast khỏi proposal trước khi xếp priority.`);
  }
  if (conflictResult) {
    alertLines.push(`Resolve conflict cho phạm vi ${scopeLabel}: giữ ${conflictResult.finalRows} row final, ${conflictResult.autoResolvedGroups} nhóm auto-resolve, ${conflictResult.manualReviewGroups} nhóm chưa auto quyết.`);
    if (conflictResult.sessionRepairSummary && conflictResult.sessionRepairSummary.updatedRows > 0) {
      alertLines.push(`Session_ID: đã chuẩn hóa ${conflictResult.sessionRepairSummary.updatedRows} dòng trong phạm vi ${scopeLabel}.`);
    }
  }
  if (locationResult && locationResult.lookupSummary && locationResult.lookupSummary.totalIssues > 0) {
    alertLines.push("");
    alertLines.push(formatLookupAlertMessage(locationResult.lookupSummary));
  }

  const alertMessage = alertLines.join("\n");
  showScheduleSyncAlert_(alertMessage, config);
  return {
    success: true,
    message: alertMessage,
    scopeLabel: scopeLabel,
    targetDate: targetDateLabel,
    updatedCount: updatedCount,
    appendedCount: appendRows.length,
    removedCount: removedCount,
    skippedByCast: skippedByCast,
    masterSyncSummary: masterSyncSummary,
    sourceRefreshSummary: sourceRefreshSummary,
    conflictResult: conflictResult,
    locationResult: locationResult
  };
}

function syncAndUnpivotScheduleForDate(targetDate) {
  const targetDateLabel = formatAppDateValue(targetDate);
  if (!getScheduleDateComparisonKey(targetDateLabel)) {
    SpreadsheetApp.getUi().alert("Ngày không hợp lệ. Hãy nhập theo định dạng dd/MM/yyyy, ví dụ 07/08/2026.");
    return;
  }

  syncAndUnpivotSchedule({ targetDate: targetDateLabel });
}

function syncAndUnpivotScheduleByDatePrompt() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    "Đồng bộ lịch live theo ngày",
    "Nhập ngày cần sync theo định dạng dd/MM/yyyy. Ví dụ: 07/08/2026",
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  syncAndUnpivotScheduleForDate(response.getResponseText());
}

function repairLiveSessionMasterSessionIds() {
  return rebuildScheduleSessionIdsInMaster_({ futureOnly: false }, true);
}

function repairFutureLiveSessionMasterSessionIds() {
  return rebuildScheduleSessionIdsInMaster_({ futureOnly: true }, true);
}

function rebuildScheduleSessionIdsInMaster_(options, showAlert) {
  const config = options || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Live_Session_Master');

  if (!sheet || sheet.getLastRow() <= 1) {
    if (showAlert !== false) {
      SpreadsheetApp.getUi().alert("Tab 'Live_Session_Master' chưa có dữ liệu để sửa Session_ID.");
    }
    return { scannedRows: 0, updatedRows: 0, clearedRows: 0, skippedRows: 0 };
  }

  const data = sheet.getDataRange().getValues();
  const headerMap = buildSheetHeaderMap(data[0] || []);
  const idx = getScheduleConflictIndexes(headerMap);

  if (
    idx.date === undefined ||
    idx.time === undefined ||
    idx.hostId === undefined ||
    idx.supportId === undefined ||
    idx.sessionId === undefined
  ) {
    throw new Error("Thiếu cột Ngày / Khung giờ / Mã nhân sự / Mã Nhân sự Support live / Session_ID.");
  }

  const nextSessionValues = [];
  let updatedRows = 0;
  let clearedRows = 0;
  let skippedRows = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowDate = row[idx.date];
    const rowSlot = idx.time !== undefined && row[idx.time] ? row[idx.time].toString().trim() : "";
    const hostId = idx.hostId !== undefined && row[idx.hostId] ? row[idx.hostId].toString().trim() : "";
    const supportId = idx.supportId !== undefined && row[idx.supportId] ? row[idx.supportId].toString().trim() : "";
    const currentSessionId = idx.sessionId !== undefined && row[idx.sessionId] ? row[idx.sessionId].toString().trim() : "";
    const hasScheduleContext = Boolean(formatAppDateValue(rowDate) || rowSlot || hostId || supportId);

    let nextSessionId = currentSessionId;
    if (isScheduleDateInScope(rowDate, config)) {
      nextSessionId = hasScheduleContext
        ? buildScheduleSessionId(rowDate, rowSlot, hostId, supportId)
        : "";
    } else {
      skippedRows++;
    }

    if (nextSessionId !== currentSessionId) {
      updatedRows++;
      if (!nextSessionId && currentSessionId) {
        clearedRows++;
      }
    }

    nextSessionValues.push([nextSessionId]);
  }

  if (nextSessionValues.length > 0) {
    sheet.getRange(2, idx.sessionId + 1, nextSessionValues.length, 1).setValues(nextSessionValues);
  }

  const summary = {
    scannedRows: data.length - 1,
    updatedRows,
    clearedRows,
    skippedRows
  };

  if (showAlert !== false) {
    const scopeLabel = getScheduleScopeLabel(config);
    SpreadsheetApp.getUi().alert(
      `Đã rebuild Session_ID cho phạm vi ${scopeLabel}.\n` +
      `Scanned rows: ${summary.scannedRows}\n` +
      `Updated rows: ${summary.updatedRows}\n` +
      `Cleared rows: ${summary.clearedRows}\n` +
      `Skipped rows: ${summary.skippedRows}`
    );
  }

  return summary;
}

function normalizeScheduleTrackingText(value) {
  return (value || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[đ]/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function isMeaningfulScheduleValue(value) {
  const normalized = normalizeScheduleTrackingText(value);
  return Boolean(normalized) &&
    !["trong", "no_support", "nohost", "unknown", "n/a"].includes(normalized);
}

function getScheduleDateComparisonKey(value) {
  const parsed = parseFlexibleDateValue(value);
  return parsed
    ? Utilities.formatDate(parsed, getAppTimeZone(), "yyyyMMdd")
    : "";
}

function getScheduleTodayComparisonKey() {
  return Utilities.formatDate(new Date(), getAppTimeZone(), "yyyyMMdd");
}

function isScheduleDateOnOrAfterToday(value) {
  const dateKey = getScheduleDateComparisonKey(value);
  return Boolean(dateKey) && dateKey >= getScheduleTodayComparisonKey();
}

function isScheduleDateAfterToday(value) {
  return isScheduleDateOnOrAfterToday(value);
}

function getScheduleTargetDateLabel(options) {
  const targetDate = options && options.targetDate ? formatAppDateValue(options.targetDate) : "";
  return getScheduleDateComparisonKey(targetDate) ? targetDate : "";
}

function isScheduleDateInScope(value, options) {
  const targetDateLabel = getScheduleTargetDateLabel(options);
  if (targetDateLabel) {
    return getScheduleDateComparisonKey(value) === getScheduleDateComparisonKey(targetDateLabel);
  }

  if (options && options.futureOnly) {
    return isScheduleDateOnOrAfterToday(value);
  }

  return true;
}

function getScheduleScopeLabel(options) {
  const targetDateLabel = getScheduleTargetDateLabel(options);
  if (targetDateLabel) {
    return targetDateLabel;
  }

  if (options && options.futureOnly) {
    return `>= ${formatAppDateValue(new Date())}`;
  }

  return "all dates";
}

function normalizeScheduleCandidatePool(values) {
  const deduped = [];
  const seen = {};

  (values || []).forEach(value => {
    if (!isMeaningfulScheduleValue(value)) return;
    const candidateId = value.toString().trim();
    const candidateKey = normalizeScheduleTrackingText(candidateId);
    if (!candidateId || seen[candidateKey]) return;
    seen[candidateKey] = true;
    deduped.push(candidateId);
  });

  return deduped;
}

function parseScheduleCandidatePool(value) {
  if (Array.isArray(value)) {
    return normalizeScheduleCandidatePool(value);
  }

  if (!value) return [];
  return normalizeScheduleCandidatePool(value.toString().split(',').map(item => item.trim()));
}

function serializeScheduleCandidatePool(values) {
  return normalizeScheduleCandidatePool(values).join(", ");
}

function isConfirmedScheduleValue(value) {
  const normalized = normalizeScheduleTrackingText(value);
  return [
    "da xac nhan",
    "xac nhan",
    "confirmed",
    "confirm",
    "yes",
    "true",
    "ok",
    "1",
    "done"
  ].includes(normalized);
}

function ensureRealScheduleTrackingColumns(scheduleSheet) {
  const sheet = scheduleSheet || SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Live_Session_Master');
  if (!sheet) return {};

  const currentHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), LIVE_SESSION_BASE_COLUMN_COUNT)).getValues()[0];
  LIVE_SESSION_TRACKING_HEADERS.concat(LIVE_SESSION_INTERNAL_HEADERS).forEach(header => {
    if (currentHeaders.indexOf(header) === -1) {
      const newCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, newCol)
        .setValue(header)
        .setFontWeight("bold")
        .setBackground("#1f497d")
        .setFontColor("#ffffff")
        .setHorizontalAlignment("center");
      sheet.setColumnWidth(newCol, header === LIVE_SESSION_SUPPORT_POOL_HEADER ? 220 : (header.includes("Name") ? 170 : (header.includes("Backup") ? 140 : 130)));
    }
  });

  const refreshedHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const hostConfirmCol = refreshedHeaders.indexOf("Host_Live_Confirm") + 1;
  const supportConfirmCol = refreshedHeaders.indexOf("Support_Live_Confirm") + 1;
  const supportPoolCol = refreshedHeaders.indexOf(LIVE_SESSION_SUPPORT_POOL_HEADER) + 1;
  const lastRow = Math.max(sheet.getLastRow(), 2);

  if (hostConfirmCol > 0) {
    const confirmRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(["Đã xác nhận", "Chưa xác nhận"], true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, hostConfirmCol, lastRow - 1, 1).setDataValidation(confirmRule);
  }

  if (supportConfirmCol > 0) {
    const confirmRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(["Đã xác nhận", "Chưa xác nhận"], true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, supportConfirmCol, lastRow - 1, 1).setDataValidation(confirmRule);
  }

  if (supportPoolCol > 0) {
    sheet.hideColumns(supportPoolCol);
  }

  const headerMap = {};
  refreshedHeaders.forEach((header, index) => {
    headerMap[header] = index;
  });

  return headerMap;
}

function getNormalizedScheduleSupportId(value) {
  return isMeaningfulScheduleValue(value) ? value.toString().trim() : "";
}

function shouldResetSupportTracking(existingRow, nextRow) {
  if (!existingRow || !nextRow) return false;

  const existingSupportId = getNormalizedScheduleSupportId(existingRow[LIVE_SESSION_SUPPORT_ID_INDEX]);
  const nextSupportId = getNormalizedScheduleSupportId(nextRow[LIVE_SESSION_SUPPORT_ID_INDEX]);
  const nextFormatValue = nextRow[6] || "";
  const supportRequired = !isHomeFormatValue(nextFormatValue);

  if (!supportRequired) {
    return Boolean(existingSupportId);
  }

  return existingSupportId !== nextSupportId;
}

function clearSupportTrackingForRow(sheet, rowNumber, headerMap) {
  if (!sheet || !rowNumber || !headerMap) return;

  [
    "Support_Live_Confirm",
    "Backup_Support_ID",
    "Backup_Support_Name"
  ].forEach(header => {
    const colIndex = headerMap[header];
    if (colIndex !== undefined) {
      sheet.getRange(rowNumber, colIndex + 1).clearContent();
    }
  });
}

function removeColumnsByHeaders(sheet, headersToRemove) {
  if (!sheet || sheet.getLastColumn() === 0 || !headersToRemove || headersToRemove.length === 0) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const columnsToDelete = [];

  headers.forEach((header, index) => {
    if (headersToRemove.indexOf(header) !== -1) {
      columnsToDelete.push(index + 1);
    }
  });

  columnsToDelete
    .sort((a, b) => b - a)
    .forEach(col => sheet.deleteColumn(col));
}

function trimTrailingGeneratedColumns(sheet, expectedColumnCount) {
  if (!sheet || sheet.getLastColumn() <= expectedColumnCount) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (let col = headers.length; col > expectedColumnCount; col--) {
    const headerValue = headers[col - 1] ? headers[col - 1].toString().trim() : "";
    if (!headerValue || /^Column\s+\d+$/i.test(headerValue)) {
      sheet.deleteColumn(col);
    }
  }
}

function removeConflictTrackingColumns(scheduleSheet) {
  const sheet = scheduleSheet || SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Live_Session_Master');
  removeColumnsByHeaders(sheet, [
    "Conflict_Group_Key",
    "Host_Auto_Status",
    "Host_Auto_Score",
    "Support_Auto_Status",
    "Support_Auto_Score",
    "Conflict_Row_Status",
    "Auto_Assign_Reason"
  ]);
}

function buildMasterIdSet(sheet, headerMatchers) {
  const idSet = new Set();
  if (!sheet || sheet.getLastRow() <= 1) return idSet;

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => normalizeScheduleTrackingText(h));
  let idCol = -1;

  for (let i = 0; i < headers.length; i++) {
    if (headerMatchers.some(matcher => headers[i].includes(matcher))) {
      idCol = i;
      break;
    }
  }

  if (idCol === -1) idCol = 0;

  for (let i = 1; i < data.length; i++) {
    const value = data[i][idCol];
    if (!isMeaningfulScheduleValue(value)) continue;
    idSet.add(value.toString().trim());
  }

  return idSet;
}

function isStudioFormatValue(formatValue) {
  const normalized = normalizeScheduleTrackingText(formatValue);
  return normalized.indexOf("studio") !== -1 && normalized !== "home";
}

function isHomeFormatValue(formatValue) {
  return normalizeScheduleTrackingText(formatValue) === "home";
}

function shouldKeepMasterScheduleRow(formatValue, supportId) {
  return true;
}

function buildScheduleSessionId(dateValue, slotValue, hostId, supportId) {
  const dateStr = formatAppDateValue(dateValue);
  const cleanDateCode = dateStr ? dateStr.replace(/\//g, '') : 'NODATE';
  const cleanSlotCode = slotValue ? slotValue.toString().replace(/[^0-9]/g, '') : 'NOSLOT';
  const hostCode = isMeaningfulScheduleValue(hostId) ? hostId.toString().trim() : 'NOHOST';
  const supportCode = isMeaningfulScheduleValue(supportId) ? supportId.toString().trim() : 'NO_SUPPORT';
  return `SS-${cleanDateCode}-${cleanSlotCode}-${hostCode}-${supportCode}`;
}

function SESSION_ID_FX(dateValue, slotValue, hostId, supportId) {
  return buildScheduleSessionIdFxValue_(dateValue, slotValue, hostId, supportId);
}

function buildScheduleSessionIdFxValue_(dateValue, slotValue, hostId, supportId) {
  const matrices = [dateValue, slotValue, hostId, supportId].map(normalizeScheduleFxMatrix_);
  const rowCount = Math.max.apply(null, matrices.map(getScheduleFxMatrixRowCount_));
  const colCount = Math.max.apply(null, matrices.map(getScheduleFxMatrixColCount_));

  const isBroadcastable = matrices.every(matrix =>
    isScheduleFxMatrixBroadcastable_(matrix, rowCount, colCount)
  );
  if (!isBroadcastable) {
    return [["#ERROR: Range size mismatch"]];
  }

  if (rowCount === 1 && colCount === 1) {
    return buildScheduleSessionIdFxCell_(
      getScheduleFxMatrixValue_(matrices[0], 0, 0),
      getScheduleFxMatrixValue_(matrices[1], 0, 0),
      getScheduleFxMatrixValue_(matrices[2], 0, 0),
      getScheduleFxMatrixValue_(matrices[3], 0, 0)
    );
  }

  const output = [];
  for (let row = 0; row < rowCount; row++) {
    const resultRow = [];
    for (let col = 0; col < colCount; col++) {
      resultRow.push(
        buildScheduleSessionIdFxCell_(
          getScheduleFxMatrixValue_(matrices[0], row, col),
          getScheduleFxMatrixValue_(matrices[1], row, col),
          getScheduleFxMatrixValue_(matrices[2], row, col),
          getScheduleFxMatrixValue_(matrices[3], row, col)
        )
      );
    }
    output.push(resultRow);
  }

  return output;
}

function buildScheduleSessionIdFxCell_(dateValue, slotValue, hostId, supportId) {
  const hasContext = Boolean(
    formatAppDateValue(dateValue) ||
    (slotValue && slotValue.toString().trim()) ||
    (hostId && hostId.toString().trim()) ||
    (supportId && supportId.toString().trim())
  );
  if (!hasContext) return "";

  return buildScheduleSessionId(dateValue, slotValue, hostId, supportId);
}

function normalizeScheduleFxMatrix_(value) {
  if (!Array.isArray(value)) return [[value]];
  if (value.length === 0) return [[""]];
  if (Array.isArray(value[0])) return value;
  return value.map(item => [item]);
}

function getScheduleFxMatrixRowCount_(matrix) {
  return matrix && matrix.length ? matrix.length : 1;
}

function getScheduleFxMatrixColCount_(matrix) {
  if (!matrix || !matrix.length) return 1;
  return Array.isArray(matrix[0]) ? matrix[0].length : 1;
}

function isScheduleFxMatrixBroadcastable_(matrix, rowCount, colCount) {
  const rows = getScheduleFxMatrixRowCount_(matrix);
  const cols = getScheduleFxMatrixColCount_(matrix);
  return (rows === 1 || rows === rowCount) && (cols === 1 || cols === colCount);
}

function getScheduleFxMatrixValue_(matrix, rowIndex, colIndex) {
  const rows = getScheduleFxMatrixRowCount_(matrix);
  const cols = getScheduleFxMatrixColCount_(matrix);
  const targetRow = rows === 1 ? 0 : rowIndex;
  const targetCol = cols === 1 ? 0 : colIndex;
  const row = Array.isArray(matrix[targetRow]) ? matrix[targetRow] : [matrix[targetRow]];
  return row[targetCol];
}

function buildScheduleHostIdentityKey(dateValue, slotValue, hostId) {
  const dateStr = formatAppDateValue(dateValue);
  const slot = slotValue ? slotValue.toString().trim() : "";
  const host = hostId ? hostId.toString().trim() : "";
  if (!dateStr || !slot || !host) return "";
  return `${dateStr}__${slot}__${host}`;
}

function buildScheduleExistingRowLookup(sheet) {
  const result = {};
  if (!sheet || sheet.getLastRow() <= 1 || sheet.getLastColumn() <= 0) return result;

  const data = sheet.getDataRange().getValues();
  const headerMap = buildSheetHeaderMap(data[0] || []);
  const dateIdx = headerMap["Ngày"];
  const timeIdx = headerMap["Khung giờ"];
  const hostIdx = headerMap["Mã nhân sự"];
  const formatIdx = headerMap["Hình thức"];
  const channelIdx = headerMap["Live_Channel_Id"];

  if (dateIdx === undefined || timeIdx === undefined || hostIdx === undefined) {
    return result;
  }

  for (let i = 1; i < data.length; i++) {
    const key = buildScheduleHostIdentityKey(
      data[i][dateIdx],
      data[i][timeIdx],
      data[i][hostIdx]
    );
    if (!key) continue;

    result[key] = {
      format: formatIdx !== undefined ? data[i][formatIdx] || "" : "",
      channel: channelIdx !== undefined ? data[i][channelIdx] || "" : ""
    };
  }

  return result;
}

function getPreferredScheduleFormatForHost(hostId, currentFormat, portfolioMap) {
  const safeCurrent = currentFormat ? currentFormat.toString().trim() : "";
  const meta = portfolioMap && hostId ? portfolioMap[hostId] : null;
  const allowedLocation = meta && meta.allowedLocation ? meta.allowedLocation : "";

  if (typeof getDefaultScheduleLocation === 'function') {
    const preferred = getDefaultScheduleLocation(allowedLocation, safeCurrent);
    return preferred || safeCurrent || allowedLocation || "";
  }

  return safeCurrent || allowedLocation || "";
}

function parseScheduleCashOfferValue(value) {
  if (value === "" || value === null || value === undefined) return Number.MAX_SAFE_INTEGER;
  if (typeof value === "number" && isFinite(value)) return value;

  const raw = value.toString().trim().toLowerCase();
  if (!raw) return Number.MAX_SAFE_INTEGER;

  const normalized = raw
    .replace(/[,]/g, "")
    .replace(/\s+/g, " ")
    .replace(/tri[eệ]u/g, "tr")
    .replace(/ngh[iì]n/g, "k")
    .replace(/ng[aà]n/g, "k")
    .replace(/đ|d/g, "");

  const matches = normalized.match(/\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return Number.MAX_SAFE_INTEGER;

  let multiplier = 1;
  if (normalized.includes("ty")) multiplier = 1000000000;
  else if (normalized.includes("tr")) multiplier = 1000000;
  else if (normalized.includes("k")) multiplier = 1000;

  const numbers = matches.map(Number).filter(num => isFinite(num));
  if (!numbers.length) return Number.MAX_SAFE_INTEGER;

  if (numbers.length >= 2 && /-|–|~|to/.test(normalized)) {
    return ((numbers[0] + numbers[1]) / 2) * multiplier;
  }

  return numbers[0] * multiplier;
}

function getHostDisplayNameById(hostId, portfolioMap) {
  if (!isMeaningfulScheduleValue(hostId)) return "";
  const meta = portfolioMap && portfolioMap[hostId] ? portfolioMap[hostId] : null;
  return meta && meta.name ? meta.name : hostId;
}

function getSupportDisplayNameById(supportId, supportMap) {
  if (!isMeaningfulScheduleValue(supportId)) return "";
  const meta = supportMap && supportMap[supportId] ? supportMap[supportId] : null;
  return meta && meta.name ? meta.name : supportId;
}

function setScheduleDerivedNames(row, portfolioMap, supportMap) {
  if (!row || row.length < LIVE_SESSION_BASE_COLUMN_COUNT) return row;

  const supportId = row[LIVE_SESSION_SUPPORT_ID_INDEX];
  row[LIVE_SESSION_SESSION_INDEX] = buildScheduleSessionId(row[2], row[3], row[4], supportId);
  row[LIVE_SESSION_SUPPORT_NAME_INDEX] = getSupportDisplayNameById(supportId, supportMap);

  const backupHostId = row[LIVE_SESSION_BASE_COLUMN_COUNT + 2];
  if (row.length > LIVE_SESSION_BASE_COLUMN_COUNT + 3) {
    row[LIVE_SESSION_BASE_COLUMN_COUNT + 3] = getHostDisplayNameById(backupHostId, portfolioMap);
  }

  const backupSupportId = row[LIVE_SESSION_BASE_COLUMN_COUNT + 4];
  if (row.length > LIVE_SESSION_BASE_COLUMN_COUNT + 5) {
    row[LIVE_SESSION_BASE_COLUMN_COUNT + 5] = getSupportDisplayNameById(backupSupportId, supportMap);
  }

  return row;
}

function buildHostConflictCandidate(hostId, hostName, portfolioMap, sourceOrder) {
  const meta = portfolioMap && portfolioMap[hostId] ? portfolioMap[hostId] : {
    id: hostId,
    name: hostName || hostId,
    grade: "",
    trainingReady: 0,
    rankWeight: 0,
    cashOffer: Number.MAX_SAFE_INTEGER,
    castReady: 0,
    valid: false
  };

  const effectiveCashOffer = Number.isFinite(meta.cashOffer) ? meta.cashOffer : Number.MAX_SAFE_INTEGER;

  return {
    id: hostId,
    name: meta.name || hostName || hostId,
    grade: meta.grade || "",
    sourceOrder: sourceOrder || 0,
    score: [
      meta.valid ? 1 : 0,
      meta.castReady || 0,
      meta.trainingReady || 0,
      meta.rankWeight || 0,
      -effectiveCashOffer,
    ]
  };
}

function buildSupportConflictCandidate(supportId, supportMap, sourceOrder) {
  const meta = supportMap && supportMap[supportId] ? supportMap[supportId] : {
    id: supportId,
    name: supportId,
    level: "",
    levelWeight: 0,
    castReady: 0,
    cashOffer: Number.MAX_SAFE_INTEGER,
    experienceReady: 0,
    trainingReady: 0,
    hourlyCost: Number.MAX_SAFE_INTEGER,
    valid: false
  };

  const effectiveCashOffer = Number.isFinite(meta.cashOffer) ? meta.cashOffer : Number.MAX_SAFE_INTEGER;
  const effectiveHourlyCost = Number.isFinite(meta.hourlyCost) ? meta.hourlyCost : Number.MAX_SAFE_INTEGER;

  return {
    id: supportId,
    name: meta.name || supportId,
    level: meta.level || "",
    hourlyCost: effectiveHourlyCost,
    sourceOrder: sourceOrder || 0,
    score: [
      meta.valid ? 1 : 0,
      meta.castReady || 0,
      meta.trainingReady || 0,
      -(meta.levelWeight || 0),
      -effectiveCashOffer,
    ]
  };
}

function isCastReadyHost(hostId, portfolioMap) {
  if (!isMeaningfulScheduleValue(hostId)) return false;
  const meta = portfolioMap && portfolioMap[hostId] ? portfolioMap[hostId] : null;
  return Boolean(meta && meta.valid && meta.castReady);
}

function compareHostPriorityCandidates(left, right) {
  const scoreCompare = compareConflictMetricArrays(right.score, left.score);
  if (scoreCompare !== 0) return scoreCompare;

  const orderCompare = (left.sourceOrder || 0) - (right.sourceOrder || 0);
  if (orderCompare !== 0) return orderCompare;

  return (left.id || "").localeCompare((right.id || ""), 'vi', { sensitivity: 'base' });
}

function compareScheduleShiftPairItems(left, right) {
  const leftPairIndex = Number.isFinite(left && left.pairIndex) ? left.pairIndex : Number.MAX_SAFE_INTEGER;
  const rightPairIndex = Number.isFinite(right && right.pairIndex) ? right.pairIndex : Number.MAX_SAFE_INTEGER;
  if (leftPairIndex !== rightPairIndex) return leftPairIndex - rightPairIndex;

  const leftStart = getScheduleSlotParts(left && left.slotValue ? left.slotValue : "") || { startMinutes: Number.MAX_SAFE_INTEGER };
  const rightStart = getScheduleSlotParts(right && right.slotValue ? right.slotValue : "") || { startMinutes: Number.MAX_SAFE_INTEGER };
  if (leftStart.startMinutes !== rightStart.startMinutes) {
    return leftStart.startMinutes - rightStart.startMinutes;
  }

  return (left && left.rowNumber ? left.rowNumber : 0) - (right && right.rowNumber ? right.rowNumber : 0);
}

function getScheduleItemSupportCandidateIds(item) {
  if (!item) return [];

  return normalizeScheduleCandidatePool(
    (item.supportCandidateIds || []).concat(
      isMeaningfulScheduleValue(item.supportId) ? [item.supportId] : []
    )
  );
}

function hasOverlappingScheduleCandidateIds(leftIds, rightIds) {
  if (!leftIds || !rightIds || leftIds.length === 0 || rightIds.length === 0) {
    return false;
  }

  const candidateMap = {};
  leftIds.forEach(candidateId => {
    if (!isMeaningfulScheduleValue(candidateId)) return;
    candidateMap[candidateId.toString().trim()] = true;
  });

  return rightIds.some(candidateId =>
    isMeaningfulScheduleValue(candidateId) &&
    candidateMap[candidateId.toString().trim()]
  );
}

function syncScheduleItemPayloadFields(item, fieldIndexes) {
  if (!item) return item;

  if (item.values) {
    item.values[4] = item.hostId || "";
    item.values[5] = item.hostName || "";
    item.values[6] = item.formatValue || "";
    item.values[7] = item.supportId || "";
    item.values[8] = item.supportName || "";
    if (!isMeaningfulScheduleValue(item.hostId)) {
      item.values[9] = "";
    }
    item.values[11] = buildScheduleSessionId(item.values[2], item.values[3], item.hostId, item.supportId);
  }

  if (item.rawRow && fieldIndexes) {
    if (fieldIndexes.hostId !== undefined) item.rawRow[fieldIndexes.hostId] = item.hostId || "";
    if (fieldIndexes.hostName !== undefined) item.rawRow[fieldIndexes.hostName] = item.hostName || "";
    if (fieldIndexes.format !== undefined) item.rawRow[fieldIndexes.format] = item.formatValue || "";
    if (fieldIndexes.supportId !== undefined) item.rawRow[fieldIndexes.supportId] = item.supportId || "";
    if (fieldIndexes.supportName !== undefined) item.rawRow[fieldIndexes.supportName] = item.supportName || "";
    if (!isMeaningfulScheduleValue(item.hostId) && fieldIndexes.channel !== undefined) {
      item.rawRow[fieldIndexes.channel] = "";
    }
    if (fieldIndexes.sessionId !== undefined) {
      item.rawRow[fieldIndexes.sessionId] = buildScheduleSessionId(
        item.dateValue || (fieldIndexes.date !== undefined ? item.rawRow[fieldIndexes.date] : ""),
        item.slotValue || (fieldIndexes.time !== undefined ? item.rawRow[fieldIndexes.time] : ""),
        item.hostId,
        item.supportId
      );
    }
  }

  return item;
}

function buildHomeStudioSupportShadowItem(item, fieldIndexes) {
  if (!item) return null;

  const candidateIds = getScheduleItemSupportCandidateIds(item);
  const supportId = isMeaningfulScheduleValue(item.supportId) ? item.supportId.toString().trim() : "";
  if (!supportId && candidateIds.length === 0) {
    return null;
  }

  const shadowItem = Object.assign({}, item, {
    rowNumber: (Number(item.rowNumber) || 0) + 0.1,
    hostId: "",
    hostName: "",
    formatValue: "",
    supportId,
    supportName: supportId ? (item.supportName || "") : "",
    supportCandidateIds: candidateIds,
    homeStudioShadow: true
  });

  if (item.values) {
    shadowItem.values = item.values.slice();
  }

  if (item.rawRow) {
    shadowItem.rawRow = item.rawRow.slice();
  }

  return syncScheduleItemPayloadFields(shadowItem, fieldIndexes);
}

function applyHomeSupportRuleToScheduleItems(items, portfolioMap, options) {
  const config = options || {};
  const fieldIndexes = config.fieldIndexes || null;
  const slotMap = {};
  (items || []).forEach(item => {
    const groupingKey = item && (item.slotKey || item.supportShiftKey);
    if (!item || !groupingKey) return;
    if (!slotMap[groupingKey]) slotMap[groupingKey] = [];
    slotMap[groupingKey].push(item);
  });

  const pendingShadowItems = [];

  Object.keys(slotMap).forEach(slotKey => {
    const slotItems = slotMap[slotKey].slice().sort((a, b) => (a.rowNumber || 0) - (b.rowNumber || 0));
    const existingSupportOnlyItems = slotItems.filter(item =>
      !isMeaningfulScheduleValue(item.hostId) && !isHomeFormatValue(item.formatValue)
    );
    const claimedSupportOnlyIndexes = {};

    slotItems.forEach(item => {
      if (!isHomeFormatValue(item.formatValue)) return;

      const candidateIds = getScheduleItemSupportCandidateIds(item);
      const currentSupportId = isMeaningfulScheduleValue(item.supportId) ? item.supportId.toString().trim() : "";
      const matchedSupportOnlyIndex = existingSupportOnlyItems.findIndex((supportOnlyItem, index) => {
        if (claimedSupportOnlyIndexes[index]) return false;

        const supportOnlyCandidateIds = getScheduleItemSupportCandidateIds(supportOnlyItem);
        if (currentSupportId && supportOnlyItem.supportId === currentSupportId) {
          return true;
        }

        if (hasOverlappingScheduleCandidateIds(candidateIds, supportOnlyCandidateIds)) {
          return true;
        }

        return Number.isFinite(item.pairIndex) &&
          Number.isFinite(supportOnlyItem.pairIndex) &&
          item.pairIndex === supportOnlyItem.pairIndex;
      });

      if (matchedSupportOnlyIndex !== -1) {
        const supportOnlyItem = existingSupportOnlyItems[matchedSupportOnlyIndex];
        claimedSupportOnlyIndexes[matchedSupportOnlyIndex] = true;
        supportOnlyItem.formatValue = "";
        supportOnlyItem.supportCandidateIds = normalizeScheduleCandidatePool(
          (supportOnlyItem.supportCandidateIds || []).concat(candidateIds)
        );
        if (!isMeaningfulScheduleValue(supportOnlyItem.supportId) && currentSupportId) {
          supportOnlyItem.supportId = currentSupportId;
          supportOnlyItem.supportName = item.supportName || "";
        }
        syncScheduleItemPayloadFields(supportOnlyItem, fieldIndexes);
      } else {
        const shadowItem = buildHomeStudioSupportShadowItem(item, fieldIndexes);
        if (shadowItem) {
          pendingShadowItems.push(shadowItem);
        }
      }

      item.supportId = "";
      item.supportName = "";
      syncScheduleItemPayloadFields(item, fieldIndexes);
    });
  });

  if (pendingShadowItems.length > 0) {
    Array.prototype.push.apply(items, pendingShadowItems);
  }

  items.sort((left, right) => {
    const leftOrder = Number(left && left.rowNumber) || 0;
    const rightOrder = Number(right && right.rowNumber) || 0;
    return leftOrder - rightOrder;
  });

  return items;
}

function alignSupportAssignmentsWithinShift(items, supportMap) {
  const shiftMap = {};
  (items || []).forEach(item => {
    if (
      !item ||
      !item.supportShiftKey ||
      !isMeaningfulScheduleValue(item.hostId) ||
      isHomeFormatValue(item.formatValue)
    ) {
      return;
    }

    if (!shiftMap[item.supportShiftKey]) shiftMap[item.supportShiftKey] = [];
    shiftMap[item.supportShiftKey].push(item);
  });

  Object.keys(shiftMap).forEach(shiftKey => {
    const slotMap = {};
    shiftMap[shiftKey].forEach(item => {
      const slotKey = item.slotKey || `${item.supportShiftKey}__${item.slotValue || ""}`;
      if (!slotMap[slotKey]) slotMap[slotKey] = [];
      slotMap[slotKey].push(item);
    });

    const orderedSlotKeys = Object.keys(slotMap).sort((leftKey, rightKey) => {
      const leftItem = slotMap[leftKey][0];
      const rightItem = slotMap[rightKey][0];
      const leftStart = getScheduleSlotParts(leftItem && leftItem.slotValue ? leftItem.slotValue : "") || { startMinutes: Number.MAX_SAFE_INTEGER };
      const rightStart = getScheduleSlotParts(rightItem && rightItem.slotValue ? rightItem.slotValue : "") || { startMinutes: Number.MAX_SAFE_INTEGER };
      if (leftStart.startMinutes !== rightStart.startMinutes) {
        return leftStart.startMinutes - rightStart.startMinutes;
      }
      return (leftItem && leftItem.rowNumber ? leftItem.rowNumber : 0) - (rightItem && rightItem.rowNumber ? rightItem.rowNumber : 0);
    });

    orderedSlotKeys.forEach(slotKey => {
      slotMap[slotKey].sort(compareScheduleShiftPairItems);
    });

    const pairIndexMap = {};
    orderedSlotKeys.forEach(slotKey => {
      slotMap[slotKey].forEach((item, orderIndex) => {
        const pairIndex = Number.isFinite(item.pairIndex) ? item.pairIndex : orderIndex;
        if (!pairIndexMap[pairIndex]) pairIndexMap[pairIndex] = [];
        pairIndexMap[pairIndex].push(item);
      });
    });

    Object.keys(pairIndexMap).forEach(pairKey => {
      const groupItems = pairIndexMap[pairKey].slice().sort(compareScheduleShiftPairItems);
      if (groupItems.length <= 1) return;

      const supportCandidateMap = {};
      groupItems.forEach(item => {
        if (!isMeaningfulScheduleValue(item.supportId) || supportCandidateMap[item.supportId]) {
          return;
        }

        supportCandidateMap[item.supportId] = buildSupportConflictCandidate(
          item.supportId,
          supportMap,
          item.rowNumber
        );
      });

      const supportCandidates = Object.keys(supportCandidateMap).map(candidateKey => supportCandidateMap[candidateKey]);
      if (supportCandidates.length === 0) return;

      const supportSelection = supportCandidates.length > 1
        ? chooseSingleBestConflictCandidate(supportCandidates, "score", "Support", { preferFirstOnTie: true })
        : { selected: supportCandidates[0] || null };
      const sharedSupportId = supportSelection.selected ? supportSelection.selected.id : "";
      if (!sharedSupportId) return;

      const sharedSupportName = getSupportDisplayNameById(sharedSupportId, supportMap);
      groupItems.forEach(item => {
        item.supportId = sharedSupportId;
        item.supportName = sharedSupportName;
      });
    });
  });

  return items;
}

function alignSupportOnlyRowsWithinShift(items, supportMap) {
  const shiftMap = {};

  (items || []).forEach(item => {
    if (!item || !item.supportShiftKey || isHomeFormatValue(item.formatValue)) {
      return;
    }

    const candidateIds = normalizeScheduleCandidatePool(
      (item.supportCandidateIds || []).concat(item.supportId ? [item.supportId] : [])
    );
    if (candidateIds.length === 0) {
      return;
    }

    if (!shiftMap[item.supportShiftKey]) {
      shiftMap[item.supportShiftKey] = {
        hostItems: [],
        supportOnlyItems: []
      };
    }

    if (isMeaningfulScheduleValue(item.hostId)) {
      shiftMap[item.supportShiftKey].hostItems.push(item);
      return;
    }

    shiftMap[item.supportShiftKey].supportOnlyItems.push(item);
  });

  Object.keys(shiftMap).forEach(shiftKey => {
    const group = shiftMap[shiftKey];
    if (!group.supportOnlyItems.length) {
      return;
    }

    const assignedSupportMap = {};
    const occupiedSupportBySlot = {};
    group.hostItems.forEach(item => {
      if (!isMeaningfulScheduleValue(item.supportId) || assignedSupportMap[item.supportId]) {
        return;
      }

      assignedSupportMap[item.supportId] = buildSupportConflictCandidate(
        item.supportId,
        supportMap,
        item.rowNumber
      );
      markOccupiedCandidate(occupiedSupportBySlot, item.slotKey, item.supportId);
    });

    group.supportOnlyItems
      .slice()
      .sort(compareScheduleShiftPairItems)
      .forEach(item => {
        const candidateIds = normalizeScheduleCandidatePool(
          (item.supportCandidateIds || []).concat(item.supportId ? [item.supportId] : [])
        );
        const allCandidates = candidateIds.map(candidateId => buildSupportConflictCandidate(
          candidateId,
          supportMap,
          item.rowNumber
        ));
        const overlappingCandidates = allCandidates.filter(candidate => assignedSupportMap[candidate.id]);
        const fallbackCandidates = allCandidates.filter(candidate => !assignedSupportMap[candidate.id]);

        const availableOverlappingCandidates = item.slotKey
          ? overlappingCandidates.filter(candidate => !isCandidateOccupied(occupiedSupportBySlot, item.slotKey, candidate.id))
          : overlappingCandidates;
        const availableFallbackCandidates = item.slotKey
          ? fallbackCandidates.filter(candidate => !isCandidateOccupied(occupiedSupportBySlot, item.slotKey, candidate.id))
          : fallbackCandidates;
        const effectivePool = availableOverlappingCandidates.length > 0
          ? availableOverlappingCandidates
          : availableFallbackCandidates;

        const selection = effectivePool.length > 1
          ? chooseSingleBestConflictCandidate(effectivePool, "score", "Support", { preferFirstOnTie: true })
          : { selected: effectivePool[0] || null };
        const selectedSupportId = selection.selected ? selection.selected.id : "";

        if (!selectedSupportId) {
          item.supportId = "";
          item.supportName = "";
          return;
        }

        item.supportId = selectedSupportId;
        item.supportName = getSupportDisplayNameById(selectedSupportId, supportMap);
        markOccupiedCandidate(occupiedSupportBySlot, item.slotKey, selectedSupportId);
      });
  });

  return items;
}

function isStudioConflictEligibleFormat(formatValue) {
  const normalized = normalizeScheduleTrackingText(formatValue);
  return !normalized || isStudioFormatValue(formatValue);
}

function getStudioConflictGroupValue(formatValue) {
  const normalized = normalizeScheduleTrackingText(formatValue);
  if (!normalized) return "Studio";
  if (!isStudioFormatValue(formatValue)) return "";
  return (formatValue || "").toString().trim() || "Studio";
}

function getScheduleStudioGroupKey(row, idx) {
  const formatValue = idx.format !== undefined ? row[idx.format] : "";
  const groupFormat = getStudioConflictGroupValue(formatValue);
  if (!groupFormat) return "";

  return [
    formatAppDateValue(idx.date !== undefined ? row[idx.date] : ""),
    idx.time !== undefined && row[idx.time] ? row[idx.time].toString().trim() : "",
    groupFormat
  ].join("__");
}

function getScheduleSlotKey(row, idx) {
  return [
    formatAppDateValue(idx.date !== undefined ? row[idx.date] : ""),
    idx.time !== undefined && row[idx.time] ? row[idx.time].toString().trim() : ""
  ].join("__");
}

function getScheduleSupportShiftParts(slotValue) {
  const slotParts = getScheduleSlotParts(slotValue);
  if (!slotParts) return null;

  const normalizedStartMinutes = ((slotParts.startMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  return SUPPORT_SHIFT_WINDOWS.find(window =>
    normalizedStartMinutes >= window.startMinutes &&
    normalizedStartMinutes < window.endMinutes
  ) || null;
}

function buildScheduleSupportShiftKey(dateValue, slotValue) {
  const dateStr = formatAppDateValue(dateValue);
  const shiftParts = getScheduleSupportShiftParts(slotValue);
  if (!dateStr || !shiftParts) return "";
  return `${dateStr}__${shiftParts.label}`;
}

function getScheduleSupportShiftKey(row, idx) {
  return buildScheduleSupportShiftKey(
    idx.date !== undefined ? row[idx.date] : "",
    idx.time !== undefined ? row[idx.time] : ""
  );
}

function getScheduleConflictIndexes(headerMap) {
  return {
    date: headerMap["Ngày"],
    time: headerMap["Khung giờ"],
    hostId: headerMap["Mã nhân sự"],
    hostName: headerMap["Tên Host"],
    format: headerMap["Hình thức"],
    channel: headerMap["Live_Channel_Id"],
    supportId: headerMap["Mã Nhân sự Support live"],
    supportName: headerMap["Tên Support live"],
    sessionId: headerMap["Session_ID"],
    hostConfirm: headerMap["Host_Live_Confirm"],
    supportConfirm: headerMap["Support_Live_Confirm"],
    backupHost: headerMap["Backup_Host_ID"],
    backupHostName: headerMap["Backup_Host_Name"],
    backupSupport: headerMap["Backup_Support_ID"],
    backupSupportName: headerMap["Backup_Support_Name"],
    supportCandidatePool: headerMap[LIVE_SESSION_SUPPORT_POOL_HEADER]
  };
}

function buildSheetHeaderMap(headers) {
  const headerMap = {};
  (headers || []).forEach((header, index) => {
    headerMap[header] = index;
  });
  return headerMap;
}

function buildBaseScheduleRowFromHeaderMap(row, headerMap) {
  return LIVE_SESSION_BASE_HEADERS.map(header => {
    const colIndex = headerMap[header];
    return colIndex !== undefined ? row[colIndex] : "";
  });
}

function getScheduleSlotParts(slotValue) {
  if (!slotValue) return null;

  if (slotValue instanceof Date && !isNaN(slotValue.getTime())) {
    const startMinutes = slotValue.getHours() * 60 + slotValue.getMinutes();
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

function compareScheduleRowsByDateAndTime(leftDateValue, leftSlotValue, rightDateValue, rightSlotValue, leftFallback, rightFallback) {
  const leftDate = parseFlexibleDateValue(leftDateValue);
  const rightDate = parseFlexibleDateValue(rightDateValue);
  const leftTime = leftDate ? leftDate.getTime() : -Infinity;
  const rightTime = rightDate ? rightDate.getTime() : -Infinity;

  if (leftTime !== rightTime) return rightTime - leftTime;

  const leftParts = typeof getScheduleSlotParts === 'function' ? getScheduleSlotParts(leftSlotValue) : null;
  const rightParts = typeof getScheduleSlotParts === 'function' ? getScheduleSlotParts(rightSlotValue) : null;
  const leftStartMinutes = leftParts ? leftParts.startMinutes : Number.MAX_SAFE_INTEGER;
  const rightStartMinutes = rightParts ? rightParts.startMinutes : Number.MAX_SAFE_INTEGER;

  if (leftStartMinutes !== rightStartMinutes) return leftStartMinutes - rightStartMinutes;

  return leftFallback - rightFallback;
}

function getFirstNormalizedHeaderIndex(headers, patterns) {
  const normalizedHeaders = headers.map(h => normalizeScheduleTrackingText(h));
  for (let i = 0; i < normalizedHeaders.length; i++) {
    if (patterns.some(pattern => normalizedHeaders[i] === pattern || normalizedHeaders[i].indexOf(pattern) !== -1)) {
      return i;
    }
  }
  return -1;
}

function getHostConflictGradeWeight(gradeValue) {
  const normalized = normalizeScheduleTrackingText(gradeValue);
  if (!normalized) return 0;

  const padded = ` ${normalized} `;
  if (/(^|[^a-z])s([^a-z]|$)/.test(padded)) return 5;
  if (/(^|[^a-z])a([^a-z]|$)/.test(padded)) return 4;
  if (/(^|[^a-z])b([^a-z]|$)/.test(padded)) return 3;
  if (/(^|[^a-z])c([^a-z]|$)/.test(padded)) return 2;
  if (normalized.indexOf("thu viec") !== -1) return 1;
  return 0;
}

function getSupportLevelWeight(levelValue) {
  const normalized = normalizeScheduleTrackingText(levelValue);
  if (normalized.indexOf("cap 4") !== -1) return 4;
  if (normalized.indexOf("cap 3") !== -1) return 3;
  if (normalized.indexOf("cap 2") !== -1) return 2;
  if (normalized.indexOf("cap 1") !== -1) return 1;
  return 0;
}

// ===========================================================================
// QUOTA GIỜ SUPPORT THEO NGÀY (THEO HỢP ĐỒNG)
// - Mã đuôi _6H: trong tuần (T2-T6) làm 4h/ngày, cuối tuần (T7-CN) làm 6h/ngày
// - Mã không đuôi: 4h/ngày cho mọi ngày
// - Quota là TRẦN CỨNG: không xếp vượt; ca không còn người đủ quota sẽ để trống
// ===========================================================================
const SUPPORT_DEFAULT_DAILY_QUOTA_HOURS = 4;
const SUPPORT_DEFAULT_SLOT_HOURS = 2;

function isWeekendScheduleDate(dateValue) {
  const parsed = typeof parseFlexibleDateValue === 'function' ? parseFlexibleDateValue(dateValue) : null;
  if (!parsed) return false;
  const day = parsed.getDay();
  return day === 0 || day === 6; // CN = 0, T7 = 6
}

function getSupportDailyQuotaHours(supportId, dateValue) {
  if (!isWeekendScheduleDate(dateValue)) return SUPPORT_DEFAULT_DAILY_QUOTA_HOURS;
  // Cuối tuần: số giờ trong đuôi mã (vd _6H = 6h); không đuôi = 4h
  const match = normalizeScheduleTrackingText(supportId).match(/_(\d+)h$/);
  return match ? parseInt(match[1], 10) : SUPPORT_DEFAULT_DAILY_QUOTA_HOURS;
}

function getScheduleSlotHours(slotValue) {
  const parts = getScheduleSlotParts(slotValue);
  if (!parts) return SUPPORT_DEFAULT_SLOT_HOURS;
  const hours = (parts.endMinutes - parts.startMinutes) / 60;
  return hours > 0 ? hours : SUPPORT_DEFAULT_SLOT_HOURS;
}

function createSupportQuotaLedger() {
  return { usedByDay: {}, reserved: {} };
}

function buildFinalRowSupportCandidateIds(item) {
  if (!item || !item.values) return [];

  return normalizeScheduleCandidatePool(
    parseScheduleCandidatePool(item.values[LIVE_SESSION_SUPPORT_POOL_INDEX])
      .concat(item.values[LIVE_SESSION_SUPPORT_ID_INDEX] ? [item.values[LIVE_SESSION_SUPPORT_ID_INDEX]] : [])
      .concat((item.supportCandidates || []).map(candidate => candidate.id))
      .concat((item.supportBackupCandidates || []).map(candidate => candidate.id))
  );
}

function getSupportContinuityTier(continuityMap, dayKey, slotStartMinutes, supportId) {
  if (!dayKey || !isMeaningfulScheduleValue(supportId)) return 0;

  const state = continuityMap[`${dayKey}__${supportId}`];
  if (!state) return 1;
  if (state.lastEndMinutes === slotStartMinutes) return 2;
  return 0;
}

function reserveSupportContinuityState(continuityMap, dayKey, slotParts, supportId) {
  if (!dayKey || !slotParts || !isMeaningfulScheduleValue(supportId)) return;

  continuityMap[`${dayKey}__${supportId}`] = {
    lastEndMinutes: slotParts.endMinutes
  };
}

function optimizeSupportContinuityOnFinalRows(finalRows, supportMap) {
  const ledger = createSupportQuotaLedger();
  const continuityMap = {};

  const ordered = (finalRows || []).slice().sort((left, right) => {
    const leftDate = typeof parseFlexibleDateValue === 'function' ? parseFlexibleDateValue(left.values[2]) : null;
    const rightDate = typeof parseFlexibleDateValue === 'function' ? parseFlexibleDateValue(right.values[2]) : null;
    const leftTime = leftDate ? leftDate.getTime() : -Infinity;
    const rightTime = rightDate ? rightDate.getTime() : -Infinity;
    if (leftTime !== rightTime) return leftTime - rightTime;

    const leftParts = getScheduleSlotParts(left.values[3]);
    const rightParts = getScheduleSlotParts(right.values[3]);
    const leftStart = leftParts ? leftParts.startMinutes : Number.MAX_SAFE_INTEGER;
    const rightStart = rightParts ? rightParts.startMinutes : Number.MAX_SAFE_INTEGER;
    if (leftStart !== rightStart) return leftStart - rightStart;

    return (left.sortOrder || 0) - (right.sortOrder || 0);
  });

  ordered.forEach(item => {
    if (!item || !item.values || isHomeFormatValue(item.values[6])) {
      return;
    }

    const row = item.values;
    const currentSupportId = row[LIVE_SESSION_SUPPORT_ID_INDEX] ? row[LIVE_SESSION_SUPPORT_ID_INDEX].toString().trim() : "";
    const candidateIds = buildFinalRowSupportCandidateIds(item);
    if (candidateIds.length === 0) {
      return;
    }

    const dateValue = row[2];
    const slotValue = row[3];
    const slotKey = item.slotKey || `${dateValue}__${slotValue}`;
    const slotHours = getScheduleSlotHours(slotValue);
    const slotParts = getScheduleSlotParts(slotValue);
    const dayKey = getScheduleDateComparisonKey(dateValue);
    const slotStartMinutes = slotParts ? slotParts.startMinutes : Number.MAX_SAFE_INTEGER;

    const eligibleCandidates = candidateIds
      .filter(candidateId => hasSupportQuotaForSlot(ledger, dateValue, slotKey, candidateId, slotHours))
      .map(candidateId => {
        const baseCandidate = buildSupportConflictCandidate(candidateId, supportMap, item.sortOrder || 0);
        return {
          id: candidateId,
          sourceOrder: baseCandidate.sourceOrder,
          score: [
            getSupportContinuityTier(continuityMap, dayKey, slotStartMinutes, candidateId),
            candidateId === currentSupportId ? 1 : 0
          ].concat(baseCandidate.score)
        };
      });

    if (eligibleCandidates.length === 0) {
      return;
    }

    const selection = eligibleCandidates.length > 1
      ? chooseSingleBestConflictCandidate(eligibleCandidates, "score", "Support", { preferFirstOnTie: true })
      : { selected: eligibleCandidates[0] || null };
    const selectedSupportId = selection.selected ? selection.selected.id : "";
    if (!selectedSupportId) {
      return;
    }

    row[LIVE_SESSION_SUPPORT_ID_INDEX] = selectedSupportId;
    row[LIVE_SESSION_SUPPORT_NAME_INDEX] = getSupportDisplayNameById(selectedSupportId, supportMap);
    if (item.primarySupportId !== undefined) item.primarySupportId = selectedSupportId;
    if (row[LIVE_SESSION_BASE_COLUMN_COUNT + 4] === selectedSupportId) {
      row[LIVE_SESSION_BASE_COLUMN_COUNT + 4] = "";
      row[LIVE_SESSION_BASE_COLUMN_COUNT + 5] = "";
    }

    reserveSupportQuotaHours(ledger, dateValue, slotKey, selectedSupportId, slotHours);
    reserveSupportContinuityState(continuityMap, dayKey, slotParts, selectedSupportId);
  });

  return finalRows;
}

function hasSupportQuotaForSlot(ledger, dateValue, slotKey, supportId, slotHours) {
  if (!isMeaningfulScheduleValue(supportId)) return false;
  const dayKey = getScheduleDateComparisonKey(dateValue);
  if (!dayKey) return true; // Không parse được ngày → không chặn
  const dedupeKey = `${dayKey}__${slotKey || ""}__${supportId}`;
  if (ledger.reserved[dedupeKey]) return true; // Cùng ca đã tính rồi (dòng trùng)
  const quota = getSupportDailyQuotaHours(supportId, dateValue);
  const used = ledger.usedByDay[`${dayKey}__${supportId}`] || 0;
  return used + slotHours <= quota;
}

function reserveSupportQuotaHours(ledger, dateValue, slotKey, supportId, slotHours) {
  const dayKey = getScheduleDateComparisonKey(dateValue);
  if (!dayKey || !isMeaningfulScheduleValue(supportId)) return;
  const dedupeKey = `${dayKey}__${slotKey || ""}__${supportId}`;
  if (ledger.reserved[dedupeKey]) return; // Mỗi ca chỉ tính 1 lần
  ledger.reserved[dedupeKey] = true;
  const key = `${dayKey}__${supportId}`;
  ledger.usedByDay[key] = (ledger.usedByDay[key] || 0) + slotHours;
}

// Pass cuối trong computeResolvedMasterRows: duyệt finalRows theo thời gian,
// trừ quota từng ca; ca nào mà support đã hết quota thì thay bằng ứng viên
// còn quota trong pool (theo score), không còn ai thì để trống.
function enforceSupportQuotaOnFinalRows(finalRows, supportMap) {
  const ledger = createSupportQuotaLedger();
  const stats = { replaced: 0, cleared: 0 };

  // Duyệt theo đúng thứ tự thời gian: ngày cũ trước, slot sớm trước
  const ordered = (finalRows || []).slice().sort((left, right) => {
    const leftDate = typeof parseFlexibleDateValue === 'function' ? parseFlexibleDateValue(left.values[2]) : null;
    const rightDate = typeof parseFlexibleDateValue === 'function' ? parseFlexibleDateValue(right.values[2]) : null;
    const leftTime = leftDate ? leftDate.getTime() : -Infinity;
    const rightTime = rightDate ? rightDate.getTime() : -Infinity;
    if (leftTime !== rightTime) return leftTime - rightTime;

    const leftParts = getScheduleSlotParts(left.values[3]);
    const rightParts = getScheduleSlotParts(right.values[3]);
    const leftStart = leftParts ? leftParts.startMinutes : Number.MAX_SAFE_INTEGER;
    const rightStart = rightParts ? rightParts.startMinutes : Number.MAX_SAFE_INTEGER;
    if (leftStart !== rightStart) return leftStart - rightStart;

    return (left.sortOrder || 0) - (right.sortOrder || 0);
  });

  ordered.forEach(item => {
    const row = item.values;
    const supportId = row[LIVE_SESSION_SUPPORT_ID_INDEX] ? row[LIVE_SESSION_SUPPORT_ID_INDEX].toString().trim() : "";
    if (!isMeaningfulScheduleValue(supportId)) return;

    const dateValue = row[2];
    const slotValue = row[3];
    const slotKey = item.slotKey || `${dateValue}__${slotValue}`;
    const slotHours = getScheduleSlotHours(slotValue);

    if (hasSupportQuotaForSlot(ledger, dateValue, slotKey, supportId, slotHours)) {
      reserveSupportQuotaHours(ledger, dateValue, slotKey, supportId, slotHours);
      return;
    }

    // Hết quota → tìm người thay từ pool ứng viên còn quota
    const poolIds = normalizeScheduleCandidatePool(
      parseScheduleCandidatePool(row[LIVE_SESSION_SUPPORT_POOL_INDEX])
        .concat((item.supportCandidates || []).map(candidate => candidate.id))
        .concat((item.supportBackupCandidates || []).map(candidate => candidate.id))
    ).filter(candidateId => candidateId !== supportId);

    const eligibleCandidates = poolIds
      .filter(candidateId => hasSupportQuotaForSlot(ledger, dateValue, slotKey, candidateId, slotHours))
      .map(candidateId => buildSupportConflictCandidate(candidateId, supportMap, 0));

    if (eligibleCandidates.length > 0) {
      const selection = chooseSingleBestConflictCandidate(eligibleCandidates, "score", "Support", { preferFirstOnTie: true });
      const replacementId = selection.selected ? selection.selected.id : "";
      if (replacementId) {
        reserveSupportQuotaHours(ledger, dateValue, slotKey, replacementId, slotHours);
        row[LIVE_SESSION_SUPPORT_ID_INDEX] = replacementId;
        if (item.primarySupportId !== undefined) item.primarySupportId = replacementId;
        // Backup trùng người mới thay thì xóa backup
        if (row[LIVE_SESSION_BASE_COLUMN_COUNT + 4] === replacementId) {
          row[LIVE_SESSION_BASE_COLUMN_COUNT + 4] = "";
          row[LIVE_SESSION_BASE_COLUMN_COUNT + 5] = "";
        }
        stats.replaced++;
        return;
      }
    }

    // Không ai còn quota → để trống ca này
    row[LIVE_SESSION_SUPPORT_ID_INDEX] = "";
    if (item.primarySupportId !== undefined) item.primarySupportId = "";
    stats.cleared++;
  });

  return stats;
}

function isPositiveScheduleFlag(value) {
  const normalized = normalizeScheduleTrackingText(value);
  if (!normalized) return false;

  const negativeFlags = [
    "khong",
    "khong dong y",
    "chua",
    "false",
    "0",
    "no"
  ];
  if (negativeFlags.some(flag => normalized === flag || normalized.indexOf(flag) !== -1)) {
    return false;
  }

  return [
    "co",
    "dong y",
    "roi",
    "da",
    "da training",
    "true",
    "yes",
    "ok",
    "1"
  ].some(flag => normalized === flag || normalized.indexOf(flag) !== -1);
}

function buildPortfolioConflictMap(ss) {
  const sheet = ss.getSheetByName('Portfolio_Master');
  const result = {};
  if (!sheet || sheet.getLastRow() <= 1) return result;

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = getFirstNormalizedHeaderIndex(headers, ["streamer_id", "ma"]);
  const nameCol = getFirstNormalizedHeaderIndex(headers, ["full_name", "ten"]);
  const gradeCol = getFirstNormalizedHeaderIndex(headers, ["entry_grade", "entry grade"]);
  const locationCol = getFirstNormalizedHeaderIndex(headers, ["allowed_location"]);
  const cashCol = getFirstNormalizedHeaderIndex(headers, ["cash_offer", "cash offer"]);
  const castCol = getFirstNormalizedHeaderIndex(headers, ["dong y cast", "cast_ok"]);
  const trainingCol = getFirstNormalizedHeaderIndex(headers, ["training_status", "training"]);

  for (let i = 1; i < data.length; i++) {
    const hostId = idCol !== -1 && data[i][idCol] ? data[i][idCol].toString().trim() : "";
    if (!hostId) continue;

    const allowedLocation = locationCol !== -1 && data[i][locationCol] ? data[i][locationCol].toString().trim() : "";
    result[hostId] = {
      id: hostId,
      name: nameCol !== -1 && data[i][nameCol] ? data[i][nameCol].toString().trim() : hostId,
      grade: gradeCol !== -1 && data[i][gradeCol] ? data[i][gradeCol].toString().trim() : "",
      cashOffer: cashCol !== -1 ? parseScheduleCashOfferValue(data[i][cashCol]) : Number.MAX_SAFE_INTEGER,
      rankWeight: getHostConflictGradeWeight(gradeCol !== -1 ? data[i][gradeCol] : ""),
      allowedLocation,
      castReady: castCol !== -1 && isPositiveScheduleFlag(data[i][castCol]) ? 1 : 0,
      trainingReady: trainingCol !== -1 && isPositiveScheduleFlag(data[i][trainingCol]) ? 1 : 0,
      valid: true
    };
  }

  return result;
}

function buildSupportConflictMap(ss) {
  const sheet = ss.getSheetByName('Support_Master');
  const result = {};
  if (!sheet || sheet.getLastRow() <= 1) return result;

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = getFirstNormalizedHeaderIndex(headers, ["support_id", "ma support", "ma"]);
  const nameCol = getFirstNormalizedHeaderIndex(headers, ["ho va ten", "ten"]);
  const levelCol = getFirstNormalizedHeaderIndex(headers, ["cap do", "level"]);
  const castCol = getFirstNormalizedHeaderIndex(headers, ["dong y cast", "cast_ok"]);
  const experienceCol = getFirstNormalizedHeaderIndex(headers, ["kinh nghiem", "experience"]);
  const trainingCol = getFirstNormalizedHeaderIndex(headers, ["training"]);
  const cashOfferCol = getFirstNormalizedHeaderIndex(headers, ["cash offer", "luong mong muon"]);

  const baseSheet = ss.getSheetByName('Base_Salary_Card');
  const rateCard = typeof extractBaseSalaryConfig === 'function' ? extractBaseSalaryConfig(baseSheet) : { SUPPORT: {} };

  for (let i = 1; i < data.length; i++) {
    const supportId = idCol !== -1 && data[i][idCol] ? data[i][idCol].toString().trim() : "";
    if (!supportId) continue;

    const level = levelCol !== -1 && data[i][levelCol] ? data[i][levelCol].toString().trim() : "";
    const normalizedLevel = typeof normalizeSuppLevel === 'function' ? normalizeSuppLevel(level) : level;
    const supportRate = rateCard && rateCard.SUPPORT && rateCard.SUPPORT[normalizedLevel] ? rateCard.SUPPORT[normalizedLevel].hourlyRate : 0;
    const fallbackCashOffer = cashOfferCol !== -1 ? parseScheduleCashOfferValue(data[i][cashOfferCol]) : Number.MAX_SAFE_INTEGER;

    result[supportId] = {
      id: supportId,
      name: nameCol !== -1 && data[i][nameCol] ? data[i][nameCol].toString().trim() : supportId,
      level: normalizedLevel,
      levelWeight: getSupportLevelWeight(normalizedLevel),
      castReady: castCol !== -1 && isPositiveScheduleFlag(data[i][castCol]) ? 1 : 0,
      cashOffer: fallbackCashOffer,
      experienceReady: experienceCol !== -1 && isPositiveScheduleFlag(data[i][experienceCol]) ? 1 : 0,
      trainingReady: trainingCol !== -1 && isPositiveScheduleFlag(data[i][trainingCol]) ? 1 : 0,
      hourlyCost: supportRate || fallbackCashOffer || Number.MAX_SAFE_INTEGER,
      valid: true
    };
  }

  return result;
}

function compareConflictMetricArrays(left, right) {
  const maxLength = Math.max(left.length, right.length);
  for (let i = 0; i < maxLength; i++) {
    const leftValue = left[i] !== undefined ? left[i] : 0;
    const rightValue = right[i] !== undefined ? right[i] : 0;
    if (leftValue !== rightValue) return leftValue - rightValue;
  }
  return 0;
}

function formatMetricArray(values) {
  return values.map(value => typeof value === "number" ? value : (value || "")).join("|");
}

function chooseSingleBestConflictCandidate(candidates, metricKey, reasonLabel, options) {
  const config = options || {};
  if (!candidates.length) {
    return { selected: null, manual: false, reason: `${reasonLabel}: không có ứng viên hợp lệ` };
  }

  const sorted = candidates.slice().sort((a, b) => compareConflictMetricArrays(b[metricKey], a[metricKey]));
  const best = sorted[0];
  const tied = sorted.filter(candidate => compareConflictMetricArrays(candidate[metricKey], best[metricKey]) === 0);

  if (tied.length > 1) {
    if (config.preferFirstOnTie) {
      const selected = tied.slice().sort((a, b) => {
        const orderCompare = (a.sourceOrder || 0) - (b.sourceOrder || 0);
        if (orderCompare !== 0) return orderCompare;
        const leftId = (a.id || "").toString();
        const rightId = (b.id || "").toString();
        return leftId.localeCompare(rightId, 'vi', { sensitivity: 'base' });
      })[0];

      return {
        selected,
        manual: false,
        reason: `${reasonLabel}: hòa tiêu chí, lấy theo thứ tự nguồn = ${selected.id}`
      };
    }

    return {
      selected: null,
      manual: true,
      reason: `${reasonLabel}: hòa tiêu chí giữa ${tied.map(item => item.id).join(", ")}`
    };
  }

  return {
    selected: best,
    manual: false,
    reason: `${reasonLabel}: chọn ${best.id}`
  };
}

function buildMasterFinalRow(rawRow, idx, headerMap) {
  const baseRow = headerMap
    ? buildBaseScheduleRowFromHeaderMap(rawRow, headerMap)
    : rawRow.slice(0, LIVE_SESSION_BASE_COLUMN_COUNT);

  return baseRow.concat([
    idx.hostConfirm !== undefined ? rawRow[idx.hostConfirm] : "",
    idx.supportConfirm !== undefined ? rawRow[idx.supportConfirm] : "",
    idx.backupHost !== undefined ? rawRow[idx.backupHost] : "",
    idx.backupHostName !== undefined ? rawRow[idx.backupHostName] : "",
    idx.backupSupport !== undefined ? rawRow[idx.backupSupport] : "",
    idx.backupSupportName !== undefined ? rawRow[idx.backupSupportName] : "",
    idx.supportCandidatePool !== undefined ? rawRow[idx.supportCandidatePool] : ""
  ]);
}

function markOccupiedCandidate(occupiedMap, slotKey, candidateId) {
  if (!slotKey || !isMeaningfulScheduleValue(candidateId)) return;
  if (!occupiedMap[slotKey]) occupiedMap[slotKey] = {};
  occupiedMap[slotKey][candidateId] = true;
}

function isCandidateOccupied(occupiedMap, slotKey, candidateId) {
  if (!slotKey || !isMeaningfulScheduleValue(candidateId)) return false;
  return Boolean(occupiedMap[slotKey] && occupiedMap[slotKey][candidateId]);
}

function computeResolvedMasterRows(ss, data, headerMap) {
  const idx = getScheduleConflictIndexes(headerMap || {});
  const portfolioMap = buildPortfolioConflictMap(ss);
  const supportMap = buildSupportConflictMap(ss);
  const groups = {};
  const finalRows = [];
  const unresolvedGroupKeys = {};
  const preparedItems = [];
  const outputHeaders = LIVE_SESSION_BASE_HEADERS.concat(LIVE_SESSION_TRACKING_HEADERS, LIVE_SESSION_INTERNAL_HEADERS);
  const slotPairCounter = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i].slice();
    const hostId = idx.hostId !== undefined && row[idx.hostId] ? row[idx.hostId].toString().trim() : "";
    const supportId = idx.supportId !== undefined && row[idx.supportId] ? row[idx.supportId].toString().trim() : "";
    const hostName = idx.hostName !== undefined && row[idx.hostName] ? row[idx.hostName].toString().trim() : hostId;
    const currentFormat = idx.format !== undefined ? row[idx.format] : "";
    const normalizedHostId = isMeaningfulScheduleValue(hostId) ? hostId : "";
    const normalizedSupportId = isMeaningfulScheduleValue(supportId) ? supportId : "";
    const supportCandidateIds = normalizeScheduleCandidatePool(
      parseScheduleCandidatePool(idx.supportCandidatePool !== undefined ? row[idx.supportCandidatePool] : "")
        .concat(normalizedSupportId ? [normalizedSupportId] : [])
    );
    const rowDate = idx.date !== undefined ? formatAppDateValue(row[idx.date]) : "";
    const rowSlot = idx.time !== undefined && row[idx.time] ? row[idx.time].toString().trim() : "";
    const hasScheduleContext = Boolean(rowDate || rowSlot || normalizedHostId || normalizedSupportId);

    if (!normalizedHostId && !normalizedSupportId) {
      continue;
    }

    if (!hasScheduleContext) {
      continue;
    }

    if (normalizedHostId && !isCastReadyHost(normalizedHostId, portfolioMap)) {
      continue;
    }

    const slotKey = getScheduleSlotKey(row, idx);
    const pairIndex = slotKey ? (slotPairCounter[slotKey] || 0) : 0;
    if (slotKey) {
      slotPairCounter[slotKey] = pairIndex + 1;
    }

    preparedItems.push({
      rowNumber: i + 1,
      rawRow: row,
      hostId: normalizedHostId,
      supportId: normalizedSupportId,
      hostName: normalizedHostId ? hostName : "",
      formatValue: normalizedHostId
        ? getPreferredScheduleFormatForHost(normalizedHostId, currentFormat, portfolioMap)
        : (currentFormat ? currentFormat.toString().trim() : ""),
      slotKey,
      supportShiftKey: getScheduleSupportShiftKey(row, idx),
      slotValue: rowSlot,
      pairIndex,
      sessionId: idx.sessionId !== undefined && row[idx.sessionId] ? row[idx.sessionId].toString().trim() : "",
      hostConfirm: idx.hostConfirm !== undefined ? row[idx.hostConfirm] : "",
      supportConfirm: idx.supportConfirm !== undefined ? row[idx.supportConfirm] : "",
      supportCandidateIds,
      backupHost: idx.backupHost !== undefined ? row[idx.backupHost] : "",
      backupSupport: idx.backupSupport !== undefined ? row[idx.backupSupport] : ""
    });
  }

  applyHomeSupportRuleToScheduleItems(preparedItems, portfolioMap, { fieldIndexes: idx });
  alignSupportAssignmentsWithinShift(preparedItems, supportMap);
  alignSupportOnlyRowsWithinShift(preparedItems, supportMap);

  preparedItems.forEach(item => {
    if (idx.format !== undefined) {
      item.rawRow[idx.format] = item.formatValue || "";
    }
    if (idx.supportId !== undefined) {
      item.rawRow[idx.supportId] = item.supportId || "";
    }
    if (idx.supportName !== undefined) {
      item.rawRow[idx.supportName] = getSupportDisplayNameById(item.supportId, supportMap);
    }
    if (idx.supportCandidatePool !== undefined) {
      item.rawRow[idx.supportCandidatePool] = serializeScheduleCandidatePool(
        (item.supportCandidateIds || []).concat(item.supportId ? [item.supportId] : [])
      );
    }

    if (!isMeaningfulScheduleValue(item.hostId)) {
      const passthroughRow = buildMasterFinalRow(item.rawRow, idx, headerMap);
      if (!passthroughRow[6]) {
        passthroughRow[6] = item.formatValue || "";
      }
      passthroughRow[LIVE_SESSION_BASE_COLUMN_COUNT] = "";
      passthroughRow[LIVE_SESSION_BASE_COLUMN_COUNT + 1] = item.supportId ? passthroughRow[LIVE_SESSION_BASE_COLUMN_COUNT + 1] : "";
      passthroughRow[LIVE_SESSION_BASE_COLUMN_COUNT + 2] = "";
      passthroughRow[LIVE_SESSION_BASE_COLUMN_COUNT + 3] = "";
      passthroughRow[LIVE_SESSION_BASE_COLUMN_COUNT + 4] = "";
      passthroughRow[LIVE_SESSION_BASE_COLUMN_COUNT + 5] = "";
      passthroughRow[LIVE_SESSION_SUPPORT_ID_INDEX] = item.supportId || "";
      passthroughRow[LIVE_SESSION_SUPPORT_NAME_INDEX] = getSupportDisplayNameById(item.supportId, supportMap);
      setScheduleDerivedNames(passthroughRow, portfolioMap, supportMap);

      finalRows.push({
        sortOrder: item.rowNumber,
        proposalRow: item.rowNumber,
        values: passthroughRow,
        slotKey: item.slotKey,
        primaryHostId: "",
        primarySupportId: item.supportId,
        autoBackup: false
      });
      return;
    }

    if (!isStudioConflictEligibleFormat(item.formatValue)) {
      const passthroughRow = buildMasterFinalRow(item.rawRow, idx, headerMap);
      if (!passthroughRow[6]) {
        passthroughRow[6] = item.formatValue || "";
      }
      passthroughRow[LIVE_SESSION_SUPPORT_ID_INDEX] = item.supportId || "";
      passthroughRow[LIVE_SESSION_SUPPORT_NAME_INDEX] = getSupportDisplayNameById(item.supportId, supportMap);
      if (!item.supportId) {
        passthroughRow[LIVE_SESSION_BASE_COLUMN_COUNT + 1] = "";
        passthroughRow[LIVE_SESSION_BASE_COLUMN_COUNT + 3] = "";
        passthroughRow[LIVE_SESSION_BASE_COLUMN_COUNT + 4] = "";
        passthroughRow[LIVE_SESSION_BASE_COLUMN_COUNT + 5] = "";
      }
      setScheduleDerivedNames(passthroughRow, portfolioMap, supportMap);

      finalRows.push({
        sortOrder: item.rowNumber,
        proposalRow: item.rowNumber,
        values: passthroughRow,
        slotKey: item.slotKey,
        primaryHostId: item.hostId,
        primarySupportId: item.supportId,
        autoBackup: false
      });
      return;
    }

    const groupFormat = getStudioConflictGroupValue(item.formatValue);
    const groupKey = getScheduleStudioGroupKey(item.rawRow, idx);

    if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push({
        rowNumber: item.rowNumber,
        rawRow: item.rawRow,
        hostId: item.hostId,
        supportId: item.supportId,
        hostName: item.hostName,
        formatValue: groupFormat,
        supportShiftKey: item.supportShiftKey,
        sessionId: item.sessionId,
        hostConfirm: item.hostConfirm,
        supportConfirm: item.supportConfirm,
        supportCandidateIds: item.supportCandidateIds,
        backupHost: item.backupHost,
      backupSupport: item.backupSupport
    });
  });

  let autoResolvedGroups = 0;
  let manualReviewGroups = 0;

  Object.keys(groups).forEach(groupKey => {
    const rows = groups[groupKey];

    const hostCandidateMap = {};
    rows.forEach(item => {
      if (!isMeaningfulScheduleValue(item.hostId)) return;
      if (!hostCandidateMap[item.hostId]) {
        hostCandidateMap[item.hostId] = buildHostConflictCandidate(
          item.hostId,
          item.hostName,
          portfolioMap,
          item.rowNumber
        );
      }
    });

    const supportCandidateMap = {};
    rows.forEach(item => {
      if (!isMeaningfulScheduleValue(item.supportId)) return;
      if (!supportCandidateMap[item.supportId]) {
        supportCandidateMap[item.supportId] = buildSupportConflictCandidate(
          item.supportId,
          supportMap,
          item.rowNumber
        );
      }
    });
    const supportBackupCandidateMap = {};
    rows.forEach(item => {
      const candidateIds = normalizeScheduleCandidatePool(
        (item.supportCandidateIds || []).concat(item.supportId ? [item.supportId] : [])
      );
      candidateIds.forEach(candidateId => {
        if (supportBackupCandidateMap[candidateId]) return;
        supportBackupCandidateMap[candidateId] = buildSupportConflictCandidate(
          candidateId,
          supportMap,
          item.rowNumber
        );
      });
    });

    const hostCandidates = Object.keys(hostCandidateMap).map(key => hostCandidateMap[key]);
    const supportCandidates = Object.keys(supportCandidateMap).map(key => supportCandidateMap[key]);
    const supportBackupCandidates = Object.keys(supportBackupCandidateMap).map(key => supportBackupCandidateMap[key]);
    const hostConflict = hostCandidates.length > 1;
    const supportConflict = supportCandidates.length > 1;

    const hostSelection = hostConflict
      ? chooseSingleBestConflictCandidate(hostCandidates, "score", "Host", { preferFirstOnTie: true })
      : { selected: hostCandidates[0] || null, manual: false, reason: hostCandidates[0] ? `Host: giữ ${hostCandidates[0].id}` : "Host: không có ứng viên" };
    const supportSelection = supportConflict
      ? chooseSingleBestConflictCandidate(supportCandidates, "score", "Support", { preferFirstOnTie: true })
      : { selected: supportCandidates[0] || null, manual: false, reason: supportCandidates[0] ? `Support: giữ ${supportCandidates[0].id}` : "Support: chưa có support" };

    const needsManualReview = hostSelection.manual || supportSelection.manual;
    const selectedHostId = hostSelection.selected ? hostSelection.selected.id : "";
    const selectedSupportId = supportSelection.selected ? supportSelection.selected.id : "";

    let canonicalRow = null;
    if (selectedHostId) {
      canonicalRow = rows.find(item => item.hostId === selectedHostId && (!selectedSupportId || item.supportId === selectedSupportId)) ||
        rows.find(item => item.hostId === selectedHostId) ||
        rows[0];
    } else {
      canonicalRow = rows[0];
    }

    const supportSourceRow = selectedSupportId
      ? rows.find(item => item.supportId === selectedSupportId)
      : null;

    if (needsManualReview) {
      manualReviewGroups++;
      unresolvedGroupKeys[groupKey] = true;
      rows.forEach(item => {
        if (!shouldKeepMasterScheduleRow(item.formatValue, item.supportId)) {
          return;
        }
        finalRows.push({
          sortOrder: item.rowNumber,
          proposalRow: item.rowNumber,
          values: buildMasterFinalRow(item.rawRow, idx, headerMap),
          slotKey: getScheduleSlotKey(item.rawRow, idx),
          primaryHostId: item.hostId,
          primarySupportId: item.supportId,
          autoBackup: false
        });
      });
      return;
    }

    const finalRow = buildMasterFinalRow(canonicalRow.rawRow, idx, headerMap);
    if (!finalRow[6]) {
      finalRow[6] = canonicalRow.formatValue || "Studio";
    }
    finalRow[LIVE_SESSION_BASE_COLUMN_COUNT + 1] = "";
    finalRow[LIVE_SESSION_BASE_COLUMN_COUNT + 2] = "";
    finalRow[LIVE_SESSION_BASE_COLUMN_COUNT + 3] = "";
    finalRow[LIVE_SESSION_BASE_COLUMN_COUNT + 4] = "";
    finalRow[LIVE_SESSION_BASE_COLUMN_COUNT + 5] = "";
    finalRow[LIVE_SESSION_SUPPORT_ID_INDEX] = selectedSupportId || "";
    finalRow[LIVE_SESSION_SUPPORT_NAME_INDEX] = getSupportDisplayNameById(selectedSupportId, supportMap);
    finalRow[LIVE_SESSION_SUPPORT_POOL_INDEX] = serializeScheduleCandidatePool(
      rows.reduce(
        (allCandidateIds, rowItem) => allCandidateIds.concat(
          (rowItem.supportCandidateIds || []).concat(rowItem.supportId ? [rowItem.supportId] : [])
        ),
        []
      )
    );

    if (supportSourceRow) {
      finalRow[LIVE_SESSION_BASE_COLUMN_COUNT + 1] = supportSourceRow.supportConfirm || "";
    }
    setScheduleDerivedNames(finalRow, portfolioMap, supportMap);

    if (!shouldKeepMasterScheduleRow(canonicalRow.formatValue, selectedSupportId)) {
      return;
    }

    finalRows.push({
      sortOrder: rows[0].rowNumber,
      proposalRow: rows[0].rowNumber,
      values: finalRow,
      slotKey: getScheduleSlotKey(canonicalRow.rawRow, idx),
      primaryHostId: selectedHostId,
      primarySupportId: selectedSupportId,
      autoBackup: true,
      hostCandidates,
      supportCandidates,
      supportBackupCandidates
    });

    if (rows.length > 1 || hostConflict || supportConflict) {
      autoResolvedGroups++;
    }
  });

  finalRows.sort((left, right) => compareScheduleRowsByDateAndTime(
    left.values[2],
    left.values[3],
    right.values[2],
    right.values[3],
    left.sortOrder,
    right.sortOrder
  ));

  optimizeSupportContinuityOnFinalRows(finalRows, supportMap);

  const occupiedHostBySlot = {};
  finalRows.forEach(item => {
    markOccupiedCandidate(occupiedHostBySlot, item.slotKey, item.primaryHostId);
  });

  finalRows.forEach(item => {
    if (!item.autoBackup) return;

    const hostBackupCandidates = (item.hostCandidates || []).filter(candidate =>
      candidate.id !== item.primaryHostId &&
      !isCandidateOccupied(occupiedHostBySlot, item.slotKey, candidate.id)
    );
    const supportBackupCandidates = (item.supportBackupCandidates || item.supportCandidates || []).filter(candidate =>
      candidate.id !== item.primarySupportId
    );

    const hostBackupSelection = hostBackupCandidates.length > 0
      ? chooseSingleBestConflictCandidate(hostBackupCandidates, "score", "Backup Host", { preferFirstOnTie: true })
      : { selected: null };
    const supportBackupSelection = supportBackupCandidates.length > 0
      ? chooseSingleBestConflictCandidate(supportBackupCandidates, "score", "Backup Support", { preferFirstOnTie: true })
      : { selected: null };

    const backupHostId = hostBackupSelection.selected ? hostBackupSelection.selected.id : "";
    const backupSupportId = supportBackupSelection.selected ? supportBackupSelection.selected.id : "";

    item.values[LIVE_SESSION_BASE_COLUMN_COUNT + 2] = backupHostId;
    item.values[LIVE_SESSION_BASE_COLUMN_COUNT + 3] = getHostDisplayNameById(backupHostId, portfolioMap);
    item.values[LIVE_SESSION_BASE_COLUMN_COUNT + 4] = backupSupportId;
    item.values[LIVE_SESSION_BASE_COLUMN_COUNT + 5] = getSupportDisplayNameById(backupSupportId, supportMap);

    markOccupiedCandidate(occupiedHostBySlot, item.slotKey, backupHostId);
  });

  const quotaStats = enforceSupportQuotaOnFinalRows(finalRows, supportMap);

  const outputRows = finalRows.map((item, index) => {
    const row = item.values.slice();
    row[0] = index + 1;
    setScheduleDerivedNames(row, portfolioMap, supportMap);
    return row;
  });

  return {
    outputHeaders,
    outputRows,
    proposalRows: finalRows.map(item => item.proposalRow),
    unresolvedGroupKeys,
    summary: {
      totalGroups: Object.keys(groups).length,
      finalRows: outputRows.length,
      autoResolvedGroups,
      manualReviewGroups,
      quotaReplaced: quotaStats.replaced,
      quotaCleared: quotaStats.cleared
    }
  };
}

function resolveScheduleConflicts(showAlert, options) {
  const config = options || {};
  const futureOnly = Boolean(config.futureOnly);
  const targetDateLabel = getScheduleTargetDateLabel(config);
  const hasDateScope = futureOnly || Boolean(targetDateLabel);
  const autoFillOptions = Object.assign(
    {
      skipChannelUpdate: true,
      skipDropdownRefresh: true,
      skipLookupValidation: true
    },
    targetDateLabel ? { targetDate: targetDateLabel } : (futureOnly ? { futureOnly: true } : {})
  );
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Live_Session_Master');
  if (!sheet || sheet.getLastRow() <= 1) {
    if (showAlert !== false) safeAlert("Tab 'Live_Session_Master' chưa có dữ liệu để resolve conflict.");
    return {
      totalGroups: 0,
      finalRows: 0,
      autoResolvedGroups: 0,
      manualReviewGroups: 0
    };
  }

  removeColumnsByHeaders(sheet, REMOVED_LIVE_SESSION_HEADERS);
  if (typeof autoFillLocationToSchedule === 'function') {
    autoFillLocationToSchedule(false, autoFillOptions);
  }

  removeConflictTrackingColumns(sheet);
  const headerMap = ensureRealScheduleTrackingColumns(sheet);
  const data = sheet.getDataRange().getValues();
  let resolution;
  let outputHeaders;
  let outputRows;

  if (hasDateScope) {
    const idx = getScheduleConflictIndexes(headerMap);
    const targetData = [data[0]];
    const preservedRows = [];

    for (let i = 1; i < data.length; i++) {
      if (isScheduleDateInScope(idx.date !== undefined ? data[i][idx.date] : "", config)) {
        targetData.push(data[i].slice());
      } else {
        preservedRows.push(buildMasterFinalRow(data[i], idx, headerMap));
      }
    }

    resolution = targetData.length > 1
      ? computeResolvedMasterRows(ss, targetData, headerMap)
      : {
          outputHeaders: LIVE_SESSION_BASE_HEADERS.concat(LIVE_SESSION_TRACKING_HEADERS, LIVE_SESSION_INTERNAL_HEADERS),
          outputRows: [],
          summary: {
            totalGroups: 0,
            finalRows: 0,
            autoResolvedGroups: 0,
            manualReviewGroups: 0,
            quotaReplaced: 0,
            quotaCleared: 0
          }
        };
    outputHeaders = resolution.outputHeaders;
    outputRows = resolution.outputRows.concat(preservedRows);
  } else {
    resolution = computeResolvedMasterRows(ss, data, headerMap);
    outputHeaders = resolution.outputHeaders;
    outputRows = resolution.outputRows;
  }

  if (hasDateScope) {
    outputRows = outputRows
      .map((row, index) => ({
        row: row.slice(),
        sortOrder: index
      }))
      .sort((left, right) => compareScheduleRowsByDateAndTime(
        left.row[2],
        left.row[3],
        right.row[2],
        right.row[3],
        left.sortOrder,
        right.sortOrder
      ))
      .map(entry => entry.row);
  }

  outputRows = outputRows.map((row, index) => {
    const nextRow = row.slice();
    nextRow[0] = index + 1;
    return nextRow;
  });

  const summary = Object.assign({}, resolution.summary, {
    finalRows: outputRows.length
  });

  sheet.clearContents();
  sheet.getRange(1, 1, 1, outputHeaders.length)
    .setValues([outputHeaders])
    .setFontWeight("bold")
    .setBackground("#1f497d")
    .setFontColor("#ffffff");
  sheet.setFrozenRows(1);

  if (outputRows.length > 0) {
    sheet.getRange(2, 1, outputRows.length, outputHeaders.length).setValues(outputRows);
    sheet.getRange(2, 1, outputRows.length, 1).setHorizontalAlignment("center");
    sheet.getRange(2, 2, outputRows.length, 3).setHorizontalAlignment("center");
    sheet.getRange(2, 5, outputRows.length, 1).setHorizontalAlignment("center");
    sheet.getRange(2, 8, outputRows.length, 1).setHorizontalAlignment("center");
    sheet.getRange(2, LIVE_SESSION_BASE_COLUMN_COUNT + 1, outputRows.length, LIVE_SESSION_TRACKING_HEADERS.length).setHorizontalAlignment("center");
  }
  trimTrailingGeneratedColumns(sheet, outputHeaders.length);

  if (!config.skipPostAutoFill && typeof autoFillLocationToSchedule === 'function') {
    autoFillLocationToSchedule(
      false,
      targetDateLabel ? { targetDate: targetDateLabel } : (futureOnly ? { futureOnly: true } : undefined)
    );
  }

  const sessionRepairSummary = rebuildScheduleSessionIdsInMaster_(
    targetDateLabel ? { targetDate: targetDateLabel } : (futureOnly ? { futureOnly: true } : undefined),
    false
  );
  summary.sessionRepairSummary = sessionRepairSummary;

  if (showAlert !== false) {
    let alertMessage =
      `Đã resolve ${summary.totalGroups} nhóm conflict.\n` +
      `Final rows: ${summary.finalRows}\n` +
      `Auto-resolved groups: ${summary.autoResolvedGroups}\n` +
      `Manual review groups: ${summary.manualReviewGroups}`;
    if (sessionRepairSummary && sessionRepairSummary.updatedRows > 0) {
      alertMessage += `\nSession_ID repaired: ${sessionRepairSummary.updatedRows}`;
    }
    if (summary.quotaReplaced || summary.quotaCleared) {
      alertMessage +=
        `\nQuota support: ${summary.quotaReplaced || 0} ca đổi người do hết giờ hợp đồng` +
        `, ${summary.quotaCleared || 0} ca để trống do không còn người đủ giờ`;
    }
    safeAlert(alertMessage);
  }

  return summary;
}

function buildRealScheduleFromMaster() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const targetSheetName = 'Real_Live_Schedule';
  const sourceSheet = ss.getSheetByName('Live_Session_Master');

  if (!sourceSheet || sourceSheet.getLastRow() <= 1) {
    SpreadsheetApp.getUi().alert("Tab 'Live_Session_Master' chưa có dữ liệu để convert sang real schedule.");
    return;
  }

  const sourceData = sourceSheet.getDataRange().getValues();
  const sourceHeaderMap = buildSheetHeaderMap(sourceData[0] || []);
  const resolution = computeResolvedMasterRows(ss, sourceData, sourceHeaderMap);
  const resolvedHeaders = resolution.outputHeaders;
  const resolvedData = [resolvedHeaders].concat(resolution.outputRows);
  const headerMap = buildSheetHeaderMap(resolvedHeaders);
  const portfolioSheet = ss.getSheetByName('Portfolio_Master');
  const supportSheet = ss.getSheetByName('Support_Master');
  const portfolioMap = buildPortfolioConflictMap(ss);
  const supportMap = buildSupportConflictMap(ss);
  const validHostIds = buildMasterIdSet(portfolioSheet, ["streamer_id", "ma"]);
  const validSupportIds = buildMasterIdSet(supportSheet, ["support_id", "ma"]);

  const baseHeaders = LIVE_SESSION_BASE_HEADERS.slice();
  const outputHeaders = baseHeaders.concat(LIVE_SESSION_TRACKING_HEADERS, [
    "Proposal_Row"
  ]);

  const realRows = [];
  const pendingRows = [];

  const idx = {
    thu: headerMap["Thứ"],
    ngay: headerMap["Ngày"],
    slot: headerMap["Khung giờ"],
    hostId: headerMap["Mã nhân sự"],
    hostName: headerMap["Tên Host"],
    format: headerMap["Hình thức"],
    supportId: headerMap["Mã Nhân sự Support live"],
    sessionId: headerMap["Session_ID"],
    hostConfirm: headerMap["Host_Live_Confirm"],
    supportConfirm: headerMap["Support_Live_Confirm"],
    backupHost: headerMap["Backup_Host_ID"],
    backupSupport: headerMap["Backup_Support_ID"]
  };

  for (let i = 1; i < resolvedData.length; i++) {
    const row = resolvedData[i];
    const hostId = idx.hostId > -1 && row[idx.hostId] ? row[idx.hostId].toString().trim() : "";
    const formatValue = idx.format > -1 ? row[idx.format] : "";
    const supportId = idx.supportId > -1 && row[idx.supportId] ? row[idx.supportId].toString().trim() : "";
    const sessionId = idx.sessionId > -1 && row[idx.sessionId] ? row[idx.sessionId].toString().trim() : "";
    const hostConfirm = idx.hostConfirm > -1 ? row[idx.hostConfirm] : "";
    const supportConfirm = idx.supportConfirm > -1 ? row[idx.supportConfirm] : "";
    const backupHostId = idx.backupHost > -1 && row[idx.backupHost] ? row[idx.backupHost].toString().trim() : "";
    const backupSupportId = idx.backupSupport > -1 && row[idx.backupSupport] ? row[idx.backupSupport].toString().trim() : "";
    const supportRequired = !isHomeFormatValue(formatValue);
    if (!isMeaningfulScheduleValue(hostId) && !isMeaningfulScheduleValue(supportId)) {
      continue;
    }

    const normalizedBackupHost = (isMeaningfulScheduleValue(backupHostId) && backupHostId !== hostId) ? backupHostId : "";
    const normalizedBackupSupport = supportRequired &&
      isMeaningfulScheduleValue(backupSupportId) &&
      backupSupportId !== supportId
      ? backupSupportId
      : "";
    const issues = [];
    const groupKey = getScheduleStudioGroupKey(row, idx);
    const unresolvedGroup = groupKey ? resolution.unresolvedGroupKeys[groupKey] : false;

    if (!isMeaningfulScheduleValue(hostId)) issues.push("Thiếu host chính");
    if (supportRequired && !isMeaningfulScheduleValue(supportId)) issues.push("Thiếu support chính");
    if (!isConfirmedScheduleValue(hostConfirm)) issues.push("Host chưa confirm");
    if (supportRequired && !isConfirmedScheduleValue(supportConfirm)) issues.push("Support chưa confirm");
    if (unresolvedGroup) {
      issues.push("Conflict Studio chưa auto resolve");
    }

    if (normalizedBackupHost && validHostIds.size > 0 && !validHostIds.has(normalizedBackupHost)) {
      issues.push("Backup host chưa có trong Portfolio_Master");
    }

    if (normalizedBackupSupport && validSupportIds.size > 0 && !validSupportIds.has(normalizedBackupSupport)) {
      issues.push("Backup support chưa có trong Support_Master");
    }

    if (issues.length > 0) {
      pendingRows.push({
        rowNumber: i + 1,
        sessionId,
        hostId,
        supportId,
        issues
      });
      continue;
    }

    const outputRow = buildBaseScheduleRowFromHeaderMap(row, headerMap);
    outputRow[0] = realRows.length + 1;
    outputRow[2] = formatAppDateValue(outputRow[2]);
    outputRow.push(
      "Đã xác nhận",
      supportRequired ? "Đã xác nhận" : "",
      normalizedBackupHost,
      getHostDisplayNameById(normalizedBackupHost, portfolioMap),
      normalizedBackupSupport,
      getSupportDisplayNameById(normalizedBackupSupport, supportMap),
      resolution.proposalRows[i - 1] || i + 1
    );
    setScheduleDerivedNames(outputRow, portfolioMap, supportMap);
    realRows.push(outputRow);
  }

  let realSheet = ss.getSheetByName(targetSheetName);
  if (!realSheet) {
    realSheet = ss.insertSheet(targetSheetName);
  } else {
    realSheet.clear();
  }

  realSheet.getRange(1, 1, 1, outputHeaders.length)
    .setValues([outputHeaders])
    .setFontWeight("bold")
    .setBackground("#1f497d")
    .setFontColor("#ffffff")
    .setHorizontalAlignment("center");
  realSheet.setFrozenRows(1);

  for (let col = 1; col <= LIVE_SESSION_BASE_COLUMN_COUNT; col++) {
    const sourceColIndex = sourceHeaderMap[baseHeaders[col - 1]];
    if (sourceColIndex !== undefined) {
      realSheet.setColumnWidth(col, sourceSheet.getColumnWidth(sourceColIndex + 1));
    }
  }
  realSheet.setColumnWidth(LIVE_SESSION_BASE_COLUMN_COUNT + 1, 130);
  realSheet.setColumnWidth(LIVE_SESSION_BASE_COLUMN_COUNT + 2, 140);
  realSheet.setColumnWidth(LIVE_SESSION_BASE_COLUMN_COUNT + 3, 140);
  realSheet.setColumnWidth(LIVE_SESSION_BASE_COLUMN_COUNT + 4, 170);
  realSheet.setColumnWidth(LIVE_SESSION_BASE_COLUMN_COUNT + 5, 150);
  realSheet.setColumnWidth(LIVE_SESSION_BASE_COLUMN_COUNT + 6, 170);
  realSheet.setColumnWidth(LIVE_SESSION_BASE_COLUMN_COUNT + 7, 100);

  if (realRows.length > 0) {
    realSheet.getRange(2, 1, realRows.length, outputHeaders.length).setValues(realRows);
    realSheet.getRange(2, 1, realRows.length, 1).setHorizontalAlignment("center");
    realSheet.getRange(2, 2, realRows.length, 3).setHorizontalAlignment("center");
    realSheet.getRange(2, 8, realRows.length, 1).setHorizontalAlignment("center");
    realSheet.getRange(2, LIVE_SESSION_BASE_COLUMN_COUNT, realRows.length, 1).setHorizontalAlignment("center");
    realSheet.getRange(2, LIVE_SESSION_BASE_COLUMN_COUNT + 1, realRows.length, LIVE_SESSION_TRACKING_HEADERS.length + 1).setHorizontalAlignment("center");
  }

  let alertMessage = `Đã tạo ${targetSheetName} với ${realRows.length} ca đủ điều kiện final.`;
  if (pendingRows.length > 0) {
    const preview = pendingRows
      .slice(0, 8)
      .map(item => `dòng ${item.rowNumber}${item.sessionId ? ` (${item.sessionId})` : ""}: ${item.issues.join(", ")}`)
      .join("\n");
    alertMessage += `\n\nCòn ${pendingRows.length} dòng proposal chưa lên được ${targetSheetName}:\n${preview}`;
    if (pendingRows.length > 8) {
      alertMessage += `\n... và ${pendingRows.length - 8} dòng khác.`;
    }
  }

  SpreadsheetApp.getUi().alert(alertMessage);
}
