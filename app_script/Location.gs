function autoFillLocationToSchedule(showLookupAlert, options) {
  const config = options || {};
  const skipChannelUpdate = Boolean(config.skipChannelUpdate);
  const skipDropdownRefresh = Boolean(config.skipDropdownRefresh);
  const skipLookupValidation = Boolean(config.skipLookupValidation);
  const futureOnly = Boolean(config.futureOnly);
  const targetDateLabel = typeof getScheduleTargetDateLabel === 'function' ? getScheduleTargetDateLabel(config) : "";
  const hasDateScope = futureOnly || Boolean(targetDateLabel);

  // Vì chạy trong cùng 1 file, ta dùng getActiveSpreadsheet()
  const masterSs = SpreadsheetApp.getActiveSpreadsheet(); 
  
  // 1. MỞ TAB PORTFOLIO ĐỂ LẤY LOCATION GỐC
  const portfolioSheet = masterSs.getSheetByName('Portfolio_Master');
  if (!portfolioSheet) {
    Logger.log("Không tìm thấy tab Portfolio_Master.");
    return;
  }
  const portfolioData = portfolioSheet.getDataRange().getValues();
  
  // Tự động tìm vị trí cột trong Portfolio_Master
  let pfHeaders = portfolioData[0];
  let idColIndex = pfHeaders.indexOf("Streamer_ID");
  let locColIndex = pfHeaders.indexOf("Allowed_Location");
  let channelColIndex = pfHeaders.indexOf("Live_Channel_Id");
  if (channelColIndex === -1) channelColIndex = pfHeaders.indexOf("Live_Channel");
  
  if (idColIndex === -1 || locColIndex === -1 || channelColIndex === -1) {
    Logger.log("Lỗi: Không tìm thấy cột Streamer_ID, Allowed_Location hoặc Live_Channel_Id trong Portfolio_Master.");
    return;
  }
  
  function splitChannels(rawValue) {
    return (rawValue || "")
      .toString()
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);
  }

  // Tạo từ điển: Host_ID -> Location / Live_Channel_Id
  let hostLocationMap = {};
  let hostChannelMap = {};
  for (let i = 1; i < portfolioData.length; i++) {
    let hostId = portfolioData[i][idColIndex]; 
    let location = portfolioData[i][locColIndex]; 
    let liveChannel = portfolioData[i][channelColIndex];
    
    if (hostId) {
      let cleanHostId = hostId.toString().trim();
      if (location) {
        hostLocationMap[cleanHostId] = location.toString().trim();
      }
      if (liveChannel) {
        hostChannelMap[cleanHostId] = splitChannels(liveChannel);
      }
    }
  }
  
  // 2. MỞ TAB LỊCH (LIVE_SESSION_MASTER) ĐỂ CẬP NHẬT
  const scheduleSheet = masterSs.getSheetByName('Live_Session_Master');
  if (!scheduleSheet) {
    Logger.log("Không tìm thấy tab Live_Session_Master.");
    return;
  }
  const scheduleData = scheduleSheet.getDataRange().getValues();
  
  // Tự động tìm vị trí cột trong Live_Session_Master
  // Cột mã host trong lịch thường có tên là "Mã nhân sự" hoặc "Streamer_ID"
  let schHeaders = scheduleData[0];
  
  // Tìm cột chứa Mã nhân sự (Host). Bạn kiểm tra xem file của bạn đang dùng tiêu đề nào nhé
  let schIdColIndex = schHeaders.indexOf("Mã nhân sự"); 
  if (schIdColIndex === -1) schIdColIndex = schHeaders.indexOf("Streamer_ID");
  
  // Tìm cột Hình thức / Location. 
  let schFormatColIndex = schHeaders.indexOf("Hình thức");
  if (schFormatColIndex === -1) schFormatColIndex = schHeaders.indexOf("Location_Required");
  let schChannelColIndex = schHeaders.indexOf("Live_Channel_Id");
  if (schChannelColIndex === -1) schChannelColIndex = schHeaders.indexOf("Kênh Live");
  const schDateColIndex = schHeaders.indexOf("Ngày");
  const schHostConfirmColIndex = schHeaders.indexOf("Host_Live_Confirm");

  if (schIdColIndex === -1 || schFormatColIndex === -1 || schChannelColIndex === -1) {
    Logger.log("Lỗi: Không tìm thấy cột Mã nhân sự/Streamer_ID, Hình thức/Location_Required hoặc Live_Channel_Id trong Live_Session_Master.");
    return;
  }

  if (hasDateScope && schDateColIndex === -1) {
    Logger.log("Không thể giới hạn sync theo ngày vì thiếu cột Ngày trong Live_Session_Master.");
    return;
  }
  
  let updatedLocationCount = 0;
  let updatedChannelCount = 0;
  const targetRows = [];

  if (!skipChannelUpdate && scheduleData.length > 1 && !hasDateScope) {
    scheduleSheet.getRange(2, schChannelColIndex + 1, scheduleData.length - 1, 1).clearDataValidations();
  }
  
  for (let i = 1; i < scheduleData.length; i++) {
    if (hasDateScope && !isScheduleDateInScope(scheduleData[i][schDateColIndex], config)) {
      continue;
    }

    targetRows.push(i + 1);
    if (isScheduleRowLockedByHeaderIndex_(scheduleData[i], schHostConfirmColIndex)) {
      continue;
    }

    let hostIdString = scheduleData[i][schIdColIndex]; 
    let currentFormat = scheduleData[i][schFormatColIndex]; 
    let currentChannel = scheduleData[i][schChannelColIndex];
    
    if (!hostIdString) continue;
    
    let hostId = hostIdString.toString().trim();
    
    // ĐIỀU KIỆN: CHỈ CÓ 1 HOST (Không có dấu phẩy)
    if (!hostId.includes(',')) {
      let mappedLocation = hostLocationMap[hostId];
      let mappedChannels = hostChannelMap[hostId] || [];
      let mappedChannel = mappedChannels.length === 1 ? mappedChannels[0] : "";
      
      if (mappedLocation) {
        let targetLocation = getDefaultScheduleLocation(mappedLocation, currentFormat);
        let safeMapped = targetLocation.toLowerCase().trim();
        let safeCurrent = currentFormat ? currentFormat.toString().toLowerCase().trim() : "";
        
        // Cập nhật nếu có sự thay đổi
        if (safeMapped !== safeCurrent) {
          scheduleSheet.getRange(i + 1, schFormatColIndex + 1).setValue(targetLocation);
          updatedLocationCount++;
        }
      }

      if (!skipChannelUpdate) {
        if (mappedChannel) {
          let safeMappedChannel = mappedChannel.toLowerCase().trim();
          let safeCurrentChannel = currentChannel ? currentChannel.toString().toLowerCase().trim() : "";

          if (safeMappedChannel !== safeCurrentChannel) {
            scheduleSheet.getRange(i + 1, schChannelColIndex + 1).setValue(mappedChannel);
            updatedChannelCount++;
          }
        } else if (mappedChannels.length > 1 && currentChannel && !mappedChannels.includes(currentChannel.toString().trim())) {
          scheduleSheet.getRange(i + 1, schChannelColIndex + 1).clearContent();
          updatedChannelCount++;
        }
      }
    }
  }

  if (!skipDropdownRefresh) {
    if (!hasDateScope) {
      ensurePlainLiveChannelColumn(scheduleSheet);
    }
    refreshLiveChannelDropdowns(
      targetDateLabel ? { targetDate: targetDateLabel } : (futureOnly ? { futureOnly: true } : undefined)
    );
  }

  const lookupSummary = skipLookupValidation
    ? null
    : validateLiveSessionLookups(showLookupAlert !== false, hasDateScope ? targetRows : undefined);
  
  Logger.log(`Tuyệt vời! Đã cập nhật Location cho ${updatedLocationCount} ca và Live_Channel_Id cho ${updatedChannelCount} ca trong tab Live_Session_Master.`);
  return {
    updatedLocationCount,
    updatedChannelCount,
    lookupSummary
  };
}

function ensurePlainLiveChannelColumn(scheduleSheet) {
  const sheet = scheduleSheet || SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Live_Session_Master');
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return;

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  let channelColIndex = headers.indexOf("Live_Channel_Id");
  if (channelColIndex === -1) channelColIndex = headers.indexOf("Kênh Live");
  if (channelColIndex === -1) return;

  const col = channelColIndex + 1;
  const colValues = sheet.getRange(1, col, lastRow, 1).getValues();
  const colWidth = sheet.getColumnWidth(col);

  sheet.deleteColumn(col);
  sheet.insertColumnBefore(col);
  sheet.setColumnWidth(col, colWidth);
  sheet.getRange(1, col, lastRow, 1).setValues(colValues);
}

function refreshLiveChannelDropdowns(options) {
  const config = options || {};
  const futureOnly = Boolean(config.futureOnly);
  const targetDateLabel = typeof getScheduleTargetDateLabel === 'function' ? getScheduleTargetDateLabel(config) : "";
  const hasDateScope = futureOnly || Boolean(targetDateLabel);
  const masterSs = SpreadsheetApp.getActiveSpreadsheet();
  const portfolioSheet = masterSs.getSheetByName('Portfolio_Master');
  const scheduleSheet = masterSs.getSheetByName('Live_Session_Master');

  if (!portfolioSheet || !scheduleSheet) {
    Logger.log("Không thể đồng bộ Live_Channel_Id vì thiếu Portfolio_Master hoặc Live_Session_Master.");
    return;
  }

  const portfolioData = portfolioSheet.getDataRange().getValues();
  const scheduleData = scheduleSheet.getDataRange().getValues();
  if (portfolioData.length <= 1 || scheduleData.length <= 1) return;

  const pfHeaders = portfolioData[0];
  const schHeaders = scheduleData[0];

  const pfIdColIndex = pfHeaders.indexOf("Streamer_ID");
  let pfChannelColIndex = pfHeaders.indexOf("Live_Channel_Id");
  if (pfChannelColIndex === -1) pfChannelColIndex = pfHeaders.indexOf("Live_Channel");
  const schIdColIndex = schHeaders.indexOf("Mã nhân sự") !== -1 ? schHeaders.indexOf("Mã nhân sự") : schHeaders.indexOf("Streamer_ID");
  const schDateColIndex = schHeaders.indexOf("Ngày");
  const schHostConfirmColIndex = schHeaders.indexOf("Host_Live_Confirm");
  let schChannelColIndex = schHeaders.indexOf("Live_Channel_Id");
  if (schChannelColIndex === -1) schChannelColIndex = schHeaders.indexOf("Kênh Live");

  if (pfIdColIndex === -1 || pfChannelColIndex === -1 || schIdColIndex === -1 || schChannelColIndex === -1) {
    Logger.log("Không thể đồng bộ Live_Channel_Id vì thiếu cột Streamer_ID / Live_Channel_Id / Mã nhân sự / Live_Channel_Id.");
    return;
  }

  if (hasDateScope && schDateColIndex === -1) {
    Logger.log("Không thể giới hạn dropdown theo ngày vì thiếu cột Ngày trong Live_Session_Master.");
    return;
  }

  if (!hasDateScope) {
    const channelRange = scheduleSheet.getRange(2, schChannelColIndex + 1, scheduleData.length - 1, 1);
    channelRange.clearDataValidations();
  }

  const hostChannelMap = {};
  for (let i = 1; i < portfolioData.length; i++) {
    const hostId = portfolioData[i][pfIdColIndex] ? portfolioData[i][pfIdColIndex].toString().trim() : "";
    const rawChannels = portfolioData[i][pfChannelColIndex] ? portfolioData[i][pfChannelColIndex].toString() : "";
    if (!hostId || !rawChannels) continue;

    const channels = rawChannels
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);

    if (!hostChannelMap[hostId]) hostChannelMap[hostId] = [];
    channels.forEach(channel => {
      if (!hostChannelMap[hostId].includes(channel)) {
        hostChannelMap[hostId].push(channel);
      }
    });
  }

  for (let i = 1; i < scheduleData.length; i++) {
    if (hasDateScope && !isScheduleDateInScope(scheduleData[i][schDateColIndex], config)) {
      continue;
    }

    if (isScheduleRowLockedByHeaderIndex_(scheduleData[i], schHostConfirmColIndex)) {
      continue;
    }

    const hostId = scheduleData[i][schIdColIndex] ? scheduleData[i][schIdColIndex].toString().trim() : "";
    const currentChannel = scheduleData[i][schChannelColIndex] ? scheduleData[i][schChannelColIndex].toString().trim() : "";
    const channelCell = scheduleSheet.getRange(i + 1, schChannelColIndex + 1);
    channelCell.clearDataValidations();

    if (!hostId || hostId.includes(',')) {
      channelCell.clearDataValidations();
      channelCell.clearNote();
      channelCell.setBackground(null);
      continue;
    }

    const allowedChannels = hostChannelMap[hostId] || [];
    if (allowedChannels.length === 0) {
      channelCell.clearNote();
      channelCell.setBackground("#fce8e6");
      continue;
    }

    channelCell.clearNote();
    channelCell.setBackground(allowedChannels.length > 1 ? "#fff2cc" : "#d9ead3");

    if (!currentChannel) {
      channelCell.setValue(allowedChannels[0]);
    } else if (!allowedChannels.includes(currentChannel)) {
      channelCell.setValue(allowedChannels[0]);
    }
  }
}

function formatLookupIssueRows(rows) {
  if (!rows || !rows.length) return "";
  const sortedRows = rows.slice().sort((a, b) => a - b);
  const preview = sortedRows.slice(0, 5).join(", ");
  return sortedRows.length > 5 ? `${preview}, ...` : preview;
}

function formatLookupAlertMessage(summary) {
  if (!summary || !summary.totalIssues) return "";

  const lines = ["Da to do cac o lookup khong thay."];

  if (summary.hostIssues.length > 0) {
    const hostPreview = summary.hostIssues
      .slice(0, 5)
      .map(item => `${item.id} (dong ${formatLookupIssueRows(item.rows)})`)
      .join("; ");
    lines.push(`Host khong co trong Portfolio_Master: ${hostPreview}${summary.hostIssues.length > 5 ? `; +${summary.hostIssues.length - 5} ma khac` : ""}`);
  }

  if (summary.supportIssues.length > 0) {
    const supportPreview = summary.supportIssues
      .slice(0, 5)
      .map(item => `${item.id} (dong ${formatLookupIssueRows(item.rows)})`)
      .join("; ");
    lines.push(`Support khong co trong Support_Master: ${supportPreview}${summary.supportIssues.length > 5 ? `; +${summary.supportIssues.length - 5} ma khac` : ""}`);
  }

  return lines.join("\n");
}

function buildSupportLookupRepairContext_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const supportSheet = ss.getSheetByName('Support_Master');
  const context = {
    byId: {},
    idsByName: {},
    idsByBaseCode: {}
  };

  if (!supportSheet || supportSheet.getLastRow() <= 1) {
    return context;
  }

  const supportData = supportSheet.getDataRange().getValues();
  const supportHeaders = supportData[0] || [];
  const supportIdColIndex = supportHeaders.indexOf("Mã Support (Support_ID)") !== -1
    ? supportHeaders.indexOf("Mã Support (Support_ID)")
    : supportHeaders.findIndex(h => normalizeScheduleTrackingText(h) === "ma support (support_id)" || normalizeScheduleTrackingText(h).indexOf("ma support") !== -1);
  const supportNameColIndex = supportHeaders.indexOf("Họ Và Tên") !== -1
    ? supportHeaders.indexOf("Họ Và Tên")
    : supportHeaders.findIndex(h => {
        const normalized = normalizeScheduleTrackingText(h);
        return normalized === "ho va ten" || normalized === "full_name";
      });

  if (supportIdColIndex === -1) {
    return context;
  }

  for (let i = 1; i < supportData.length; i++) {
    const supportId = supportData[i][supportIdColIndex] ? supportData[i][supportIdColIndex].toString().trim() : "";
    if (!supportId) continue;

    const supportName = supportNameColIndex !== -1 && supportData[i][supportNameColIndex]
      ? supportData[i][supportNameColIndex].toString().trim()
      : "";
    const normalizedName = normalizeSupportLookupName_(supportName);
    const baseCode = getSupportLookupBaseCode_(supportId);

    context.byId[supportId] = {
      id: supportId,
      name: supportName,
      normalizedName: normalizedName,
      baseCode: baseCode
    };

    if (normalizedName) {
      if (!context.idsByName[normalizedName]) context.idsByName[normalizedName] = [];
      if (!context.idsByName[normalizedName].includes(supportId)) {
        context.idsByName[normalizedName].push(supportId);
      }
    }

    if (baseCode) {
      if (!context.idsByBaseCode[baseCode]) context.idsByBaseCode[baseCode] = [];
      if (!context.idsByBaseCode[baseCode].includes(supportId)) {
        context.idsByBaseCode[baseCode].push(supportId);
      }
    }
  }

  return context;
}

function normalizeSupportLookupName_(value) {
  return normalizeScheduleTrackingText(value).replace(/\s+/g, " ").trim();
}

function getSupportLookupBaseCode_(value) {
  const raw = (value || "").toString().trim().toUpperCase();
  if (!raw) return "";
  return raw.replace(/_\d+H$/i, "");
}

function getUniqueSupportLookupId_(candidateIds) {
  if (!candidateIds || candidateIds.length !== 1) return "";
  return candidateIds[0] || "";
}

function findSupportLookupIdByName_(supportName, supportContext) {
  if (!supportName || !supportContext) return "";
  const ids = supportContext.idsByName[normalizeSupportLookupName_(supportName)] || [];
  return getUniqueSupportLookupId_(ids);
}

function findSupportLookupIdByBaseCode_(supportId, supportContext) {
  if (!supportId || !supportContext) return "";
  const ids = supportContext.idsByBaseCode[getSupportLookupBaseCode_(supportId)] || [];
  return getUniqueSupportLookupId_(ids);
}

function normalizeSupportCandidatePoolForLookupRepair_(candidatePoolValue, supportContext) {
  const rawIds = typeof parseScheduleCandidatePool === "function"
    ? parseScheduleCandidatePool(candidatePoolValue)
    : (candidatePoolValue ? candidatePoolValue.toString().split(",").map(item => item.trim()).filter(Boolean) : []);

  const normalizedIds = [];
  rawIds.forEach(rawId => {
    const exactId = supportContext.byId[rawId] ? rawId : "";
    const fallbackId = exactId || findSupportLookupIdByBaseCode_(rawId, supportContext) || rawId;
    if (!fallbackId) return;
    if (!normalizedIds.includes(fallbackId)) {
      normalizedIds.push(fallbackId);
    }
  });

  return typeof serializeScheduleCandidatePool === "function"
    ? serializeScheduleCandidatePool(normalizedIds)
    : normalizedIds.join(", ");
}

function resolveSupportLookupRepair_(supportId, supportName, candidatePoolValue, supportContext) {
  const currentId = supportId ? supportId.toString().trim() : "";
  const currentName = supportName ? supportName.toString().trim() : "";
  const exactMeta = currentId && supportContext.byId[currentId] ? supportContext.byId[currentId] : null;
  const nameMatchedId = currentName ? findSupportLookupIdByName_(currentName, supportContext) : "";
  const baseMatchedId = currentId ? findSupportLookupIdByBaseCode_(currentId, supportContext) : "";
  const candidateIds = typeof parseScheduleCandidatePool === "function"
    ? parseScheduleCandidatePool(candidatePoolValue)
    : [];
  const normalizedCandidateIds = candidateIds
    .map(candidateId => {
      if (supportContext.byId[candidateId]) return candidateId;
      return findSupportLookupIdByBaseCode_(candidateId, supportContext);
    })
    .filter(Boolean);

  if (exactMeta) {
    if (
      nameMatchedId &&
      nameMatchedId !== currentId &&
      normalizedCandidateIds.includes(nameMatchedId)
    ) {
      const matchedMeta = supportContext.byId[nameMatchedId];
      return {
        nextId: nameMatchedId,
        nextName: matchedMeta ? matchedMeta.name : currentName,
        changedId: true,
        changedName: !matchedMeta || currentName !== matchedMeta.name,
        unresolved: false,
        reason: "name matched a different candidate from Support_Candidate_Pool"
      };
    }

    return {
      nextId: currentId,
      nextName: exactMeta.name || currentName,
      changedId: false,
      changedName: Boolean(exactMeta.name) && currentName !== exactMeta.name,
      unresolved: false,
      reason: "exact support id exists"
    };
  }

  if (nameMatchedId) {
    const matchedByName = supportContext.byId[nameMatchedId];
    return {
      nextId: nameMatchedId,
      nextName: matchedByName ? matchedByName.name : currentName,
      changedId: nameMatchedId !== currentId,
      changedName: !matchedByName || currentName !== matchedByName.name,
      unresolved: false,
      reason: "support name matched Support_Master uniquely"
    };
  }

  if (baseMatchedId) {
    const matchedByBase = supportContext.byId[baseMatchedId];
    return {
      nextId: baseMatchedId,
      nextName: matchedByBase ? matchedByBase.name : currentName,
      changedId: baseMatchedId !== currentId,
      changedName: !matchedByBase || currentName !== matchedByBase.name,
      unresolved: false,
      reason: "legacy support id mapped by base code"
    };
  }

  return {
    nextId: currentId,
    nextName: currentName,
    changedId: false,
    changedName: false,
    unresolved: Boolean(currentId),
    reason: currentId ? "no safe lookup repair found" : "blank support id"
  };
}

function repairLiveSessionSupportLookups(showAlert, options) {
  const shouldAlert = showAlert !== false;
  const config = options || {};
  const futureOnly = Boolean(config.futureOnly);
  const targetDateLabel = typeof getScheduleTargetDateLabel === 'function' ? getScheduleTargetDateLabel(config) : "";
  const hasDateScope = futureOnly || Boolean(targetDateLabel);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const scheduleSheet = ss.getSheetByName('Live_Session_Master');

  if (!scheduleSheet || scheduleSheet.getLastRow() <= 1) {
    if (shouldAlert) safeAlert("Tab 'Live_Session_Master' chưa có dữ liệu để sửa lookup support.");
    return {
      scannedRows: 0,
      updatedSupportIds: 0,
      updatedSupportNames: 0,
      updatedBackupSupportIds: 0,
      updatedBackupSupportNames: 0,
      normalizedCandidatePools: 0,
      unresolvedRows: 0,
      validationSummary: null
    };
  }

  const supportContext = buildSupportLookupRepairContext_();
  if (Object.keys(supportContext.byId).length === 0) {
    if (shouldAlert) safeAlert("Support_Master chưa có dữ liệu hợp lệ để repair lookup.");
    return {
      scannedRows: 0,
      updatedSupportIds: 0,
      updatedSupportNames: 0,
      updatedBackupSupportIds: 0,
      updatedBackupSupportNames: 0,
      normalizedCandidatePools: 0,
      unresolvedRows: 0,
      validationSummary: null
    };
  }

  const scheduleData = scheduleSheet.getDataRange().getValues();
  const headers = scheduleData[0] || [];
  const headerMap = typeof buildSheetHeaderMap === "function" ? buildSheetHeaderMap(headers) : {};
  const idx = {
    date: headerMap["Ngày"],
    supportId: headerMap["Mã Nhân sự Support live"],
    supportName: headerMap["Tên Support live"],
    supportConfirm: headerMap["Support_Live_Confirm"],
    backupSupportId: headerMap["Backup_Support_ID"],
    backupSupportName: headerMap["Backup_Support_Name"],
    supportCandidatePool: headerMap["Support_Candidate_Pool"]
  };

  if (idx.supportId === undefined) {
    if (shouldAlert) safeAlert("Thiếu cột Mã Nhân sự Support live để repair lookup.");
    return {
      scannedRows: 0,
      updatedSupportIds: 0,
      updatedSupportNames: 0,
      updatedBackupSupportIds: 0,
      updatedBackupSupportNames: 0,
      normalizedCandidatePools: 0,
      unresolvedRows: 0,
      validationSummary: null
    };
  }

  const numRows = scheduleData.length - 1;
  const supportIdRange = scheduleSheet.getRange(2, idx.supportId + 1, numRows, 1);
  const supportIdValues = supportIdRange.getValues();
  const supportNameRange = idx.supportName !== undefined
    ? scheduleSheet.getRange(2, idx.supportName + 1, numRows, 1)
    : null;
  const supportNameValues = supportNameRange ? supportNameRange.getValues() : null;
  const backupSupportIdRange = idx.backupSupportId !== undefined
    ? scheduleSheet.getRange(2, idx.backupSupportId + 1, numRows, 1)
    : null;
  const backupSupportIdValues = backupSupportIdRange ? backupSupportIdRange.getValues() : null;
  const backupSupportNameRange = idx.backupSupportName !== undefined
    ? scheduleSheet.getRange(2, idx.backupSupportName + 1, numRows, 1)
    : null;
  const backupSupportNameValues = backupSupportNameRange ? backupSupportNameRange.getValues() : null;
  const supportPoolRange = idx.supportCandidatePool !== undefined
    ? scheduleSheet.getRange(2, idx.supportCandidatePool + 1, numRows, 1)
    : null;
  const supportPoolValues = supportPoolRange ? supportPoolRange.getValues() : null;

  let scannedRows = 0;
  let updatedSupportIds = 0;
  let updatedSupportNames = 0;
  let updatedBackupSupportIds = 0;
  let updatedBackupSupportNames = 0;
  let normalizedCandidatePools = 0;
  let unresolvedRows = 0;
  const touchedRows = [];
  const scopedRows = [];

  for (let i = 1; i < scheduleData.length; i++) {
    const sheetRow = i + 1;
    if (hasDateScope && idx.date !== undefined && !isScheduleDateInScope(scheduleData[i][idx.date], config)) {
      continue;
    }

    scannedRows++;
    scopedRows.push(sheetRow);
    const rowIndex = i - 1;
    if (isScheduleRowLockedByHeaderIndex_(scheduleData[i], idx.supportConfirm)) {
      continue;
    }

    let rowTouched = false;
    let rowUnresolved = false;
    const currentSupportId = supportIdValues[rowIndex][0] ? supportIdValues[rowIndex][0].toString().trim() : "";
    const currentSupportName = supportNameValues ? (supportNameValues[rowIndex][0] ? supportNameValues[rowIndex][0].toString().trim() : "") : "";
    const currentPoolValue = supportPoolValues ? supportPoolValues[rowIndex][0] : "";

    if (supportPoolValues) {
      const normalizedPool = normalizeSupportCandidatePoolForLookupRepair_(currentPoolValue, supportContext);
      const currentPoolText = currentPoolValue ? currentPoolValue.toString().trim() : "";
      if (normalizedPool !== currentPoolText) {
        supportPoolValues[rowIndex][0] = normalizedPool;
        normalizedCandidatePools++;
        rowTouched = true;
      }
    }

    const supportRepair = resolveSupportLookupRepair_(
      currentSupportId,
      currentSupportName,
      supportPoolValues ? supportPoolValues[rowIndex][0] : currentPoolValue,
      supportContext
    );

    if (supportRepair.changedId) {
      supportIdValues[rowIndex][0] = supportRepair.nextId || "";
      updatedSupportIds++;
      rowTouched = true;
    }
    if (supportNameValues && supportRepair.changedName) {
      supportNameValues[rowIndex][0] = supportRepair.nextName || "";
      updatedSupportNames++;
      rowTouched = true;
    }
    if (supportRepair.unresolved) {
      rowUnresolved = true;
    }

    if (backupSupportIdValues) {
      const currentBackupId = backupSupportIdValues[rowIndex][0] ? backupSupportIdValues[rowIndex][0].toString().trim() : "";
      const currentBackupName = backupSupportNameValues ? (backupSupportNameValues[rowIndex][0] ? backupSupportNameValues[rowIndex][0].toString().trim() : "") : "";
      const backupRepair = resolveSupportLookupRepair_(
        currentBackupId,
        currentBackupName,
        "",
        supportContext
      );

      if (backupRepair.changedId) {
        backupSupportIdValues[rowIndex][0] = backupRepair.nextId || "";
        updatedBackupSupportIds++;
        rowTouched = true;
      }
      if (backupSupportNameValues && backupRepair.changedName) {
        backupSupportNameValues[rowIndex][0] = backupRepair.nextName || "";
        updatedBackupSupportNames++;
        rowTouched = true;
      }
      if (backupRepair.unresolved) {
        rowUnresolved = true;
      }
    }

    if (rowUnresolved) {
      unresolvedRows++;
    }
    if (rowTouched) {
      touchedRows.push(sheetRow);
    }
  }

  supportIdRange.setValues(supportIdValues);
  if (supportNameRange) supportNameRange.setValues(supportNameValues);
  if (backupSupportIdRange) backupSupportIdRange.setValues(backupSupportIdValues);
  if (backupSupportNameRange) backupSupportNameRange.setValues(backupSupportNameValues);
  if (supportPoolRange) supportPoolRange.setValues(supportPoolValues);

  const validationSummary = validateLiveSessionLookups(false, hasDateScope ? scopedRows : undefined);
  const scopeLabel = targetDateLabel
    ? `ngày ${targetDateLabel}`
    : (futureOnly ? "từ hôm nay trở đi" : "toàn bộ sheet");

  if (shouldAlert) {
    const messageLines = [
      `Đã repair lookup support cho phạm vi ${scopeLabel}.`,
      `Rows scanned: ${scannedRows}`,
      `Support chính: đổi ${updatedSupportIds} mã, cập nhật ${updatedSupportNames} tên`,
      `Backup support: đổi ${updatedBackupSupportIds} mã, cập nhật ${updatedBackupSupportNames} tên`,
      `Support_Candidate_Pool: chuẩn hóa ${normalizedCandidatePools} dòng`,
      `Còn ${unresolvedRows} dòng không auto-fix an toàn`
    ];
    if (validationSummary && validationSummary.totalIssues > 0) {
      messageLines.push("");
      messageLines.push(formatLookupAlertMessage(validationSummary));
    }
    safeAlert(messageLines.join("\n"));
  }

  return {
    scannedRows,
    updatedSupportIds,
    updatedSupportNames,
    updatedBackupSupportIds,
    updatedBackupSupportNames,
    normalizedCandidatePools,
    unresolvedRows,
    validationSummary
  };
}

function repairAllLiveSessionSupportLookups() {
  return repairLiveSessionSupportLookups(true, { futureOnly: false });
}

function repairFutureLiveSessionSupportLookups() {
  return repairLiveSessionSupportLookups(true, { futureOnly: true });
}

function validateLiveSessionLookups(showAlert, targetRows) {
  const masterSs = SpreadsheetApp.getActiveSpreadsheet();
  const scheduleSheet = masterSs.getSheetByName('Live_Session_Master');
  const portfolioSheet = masterSs.getSheetByName('Portfolio_Master');
  const supportSheet = masterSs.getSheetByName('Support_Master');

  const emptySummary = {
    totalIssues: 0,
    hostIssues: [],
    supportIssues: [],
    updatedHostNames: 0
  };

  if (!scheduleSheet || !portfolioSheet) {
    return emptySummary;
  }

  const scheduleData = scheduleSheet.getDataRange().getValues();
  if (scheduleData.length <= 1) {
    return emptySummary;
  }

  const scheduleHeaders = scheduleData[0];
  const hostIdColIndex = scheduleHeaders.indexOf("Mã nhân sự") !== -1
    ? scheduleHeaders.indexOf("Mã nhân sự")
    : scheduleHeaders.indexOf("Streamer_ID");
  const hostNameColIndex = scheduleHeaders.indexOf("Tên Host") !== -1
    ? scheduleHeaders.indexOf("Tên Host")
    : scheduleHeaders.indexOf("Full_Name");
  const hostConfirmColIndex = scheduleHeaders.indexOf("Host_Live_Confirm");
  const supportIdColIndex = scheduleHeaders.indexOf("Mã Nhân sự Support live");

  if (hostIdColIndex === -1) {
    return emptySummary;
  }

  const portfolioData = portfolioSheet.getDataRange().getValues();
  if (portfolioData.length <= 1) {
    return emptySummary;
  }

  const pfHeaders = portfolioData[0];
  const pfIdColIndex = pfHeaders.indexOf("Streamer_ID");
  const pfNameColIndex = pfHeaders.indexOf("Full_Name") !== -1 ? pfHeaders.indexOf("Full_Name") : pfHeaders.indexOf("Tên");
  if (pfIdColIndex === -1) {
    return emptySummary;
  }

  const hostLookupMap = {};
  for (let i = 1; i < portfolioData.length; i++) {
    const hostId = portfolioData[i][pfIdColIndex] ? portfolioData[i][pfIdColIndex].toString().trim() : "";
    if (!hostId) continue;
    hostLookupMap[hostId] = {
      name: pfNameColIndex !== -1 && portfolioData[i][pfNameColIndex]
        ? portfolioData[i][pfNameColIndex].toString().trim()
        : ""
    };
  }

  const supportLookupMap = {};
  if (supportSheet && supportSheet.getLastRow() > 1) {
    const supportData = supportSheet.getDataRange().getValues();
    const supportHeaders = supportData[0];
    const supportIdLookupColIndex = supportHeaders.indexOf("Mã Support (Support_ID)") !== -1
      ? supportHeaders.indexOf("Mã Support (Support_ID)")
      : supportHeaders.findIndex(h => h && h.toString().toLowerCase().includes("mã support"));

    if (supportIdLookupColIndex !== -1) {
      for (let i = 1; i < supportData.length; i++) {
        const supportId = supportData[i][supportIdLookupColIndex]
          ? supportData[i][supportIdLookupColIndex].toString().trim()
          : "";
        if (supportId) {
          supportLookupMap[supportId] = true;
        }
      }
    }
  }

  const hasTargetRowFilter = Array.isArray(targetRows);
  const targetRowSet = hasTargetRowFilter ? new Set(targetRows) : null;

  const numRows = scheduleData.length - 1;
  const hostIdRange = scheduleSheet.getRange(2, hostIdColIndex + 1, numRows, 1);
  const hostIdNotes = hostIdRange.getNotes();
  const hostIdBackgrounds = hostIdRange.getBackgrounds();

  const hostNameRange = hostNameColIndex !== -1
    ? scheduleSheet.getRange(2, hostNameColIndex + 1, numRows, 1)
    : null;
  const hostNameValues = hostNameRange ? hostNameRange.getValues() : null;
  const hostNameNotes = hostNameRange ? hostNameRange.getNotes() : null;
  const hostNameBackgrounds = hostNameRange ? hostNameRange.getBackgrounds() : null;

  const supportRange = supportIdColIndex !== -1
    ? scheduleSheet.getRange(2, supportIdColIndex + 1, numRows, 1)
    : null;
  const supportNotes = supportRange ? supportRange.getNotes() : null;
  const supportBackgrounds = supportRange ? supportRange.getBackgrounds() : null;

  const invalidColor = "#f4cccc";
  const hostIssuesMap = {};
  const supportIssuesMap = {};
  let updatedHostNames = 0;

  function clearLookupState(noteMatrix, backgroundMatrix, rowIndex) {
    if (!noteMatrix || !backgroundMatrix) return;
    const existingNote = noteMatrix[rowIndex][0] || "";
    if (existingNote.indexOf("[Lookup]") === 0) {
      noteMatrix[rowIndex][0] = "";
      backgroundMatrix[rowIndex][0] = null;
    }
  }

  function markLookupState(noteMatrix, backgroundMatrix, rowIndex, message) {
    if (!noteMatrix || !backgroundMatrix) return;
    noteMatrix[rowIndex][0] = `[Lookup] ${message}`;
    backgroundMatrix[rowIndex][0] = invalidColor;
  }

  function recordIssue(issueMap, id, rowNumber) {
    if (!issueMap[id]) {
      issueMap[id] = { id, rows: [] };
    }
    issueMap[id].rows.push(rowNumber);
  }

  for (let i = 1; i < scheduleData.length; i++) {
    const sheetRow = i + 1;
    if (hasTargetRowFilter && !targetRowSet.has(sheetRow)) continue;

    const rowIndex = i - 1;
    const hostId = scheduleData[i][hostIdColIndex] ? scheduleData[i][hostIdColIndex].toString().trim() : "";
    const normalizedHostId = hostId.toLowerCase();
    const currentHostName = hostNameValues ? (hostNameValues[rowIndex][0] ? hostNameValues[rowIndex][0].toString().trim() : "") : "";
    const hostLocked = isScheduleRowLockedByHeaderIndex_(scheduleData[i], hostConfirmColIndex);

    if (hostId && !["trống", "unknown", "no_host"].includes(normalizedHostId)) {
      const hostLookup = hostLookupMap[hostId];
      if (!hostLookup) {
        const message = `Khong tim thay ma host ${hostId} trong Portfolio_Master`;
        markLookupState(hostIdNotes, hostIdBackgrounds, rowIndex, message);
        if (hostNameRange) {
          markLookupState(hostNameNotes, hostNameBackgrounds, rowIndex, message);
        }
        recordIssue(hostIssuesMap, hostId, sheetRow);
      } else {
        clearLookupState(hostIdNotes, hostIdBackgrounds, rowIndex);
        if (hostNameRange) {
          clearLookupState(hostNameNotes, hostNameBackgrounds, rowIndex);
          if (
            !hostLocked &&
            hostLookup.name &&
            (!currentHostName || currentHostName.toLowerCase() === "trống" || currentHostName === hostId)
          ) {
            hostNameValues[rowIndex][0] = hostLookup.name;
            updatedHostNames++;
          }
        }
      }
    } else {
      clearLookupState(hostIdNotes, hostIdBackgrounds, rowIndex);
      if (hostNameRange) {
        clearLookupState(hostNameNotes, hostNameBackgrounds, rowIndex);
      }
    }

    if (supportRange) {
      const supportId = scheduleData[i][supportIdColIndex] ? scheduleData[i][supportIdColIndex].toString().trim() : "";
      const normalizedSupportId = supportId.toLowerCase();
      if (supportId && !["trống", "unknown", "no_support"].includes(normalizedSupportId)) {
        if (!supportLookupMap[supportId]) {
          const message = `Khong tim thay ma support ${supportId} trong Support_Master`;
          markLookupState(supportNotes, supportBackgrounds, rowIndex, message);
          recordIssue(supportIssuesMap, supportId, sheetRow);
        } else {
          clearLookupState(supportNotes, supportBackgrounds, rowIndex);
        }
      } else {
        clearLookupState(supportNotes, supportBackgrounds, rowIndex);
      }
    }
  }

  hostIdRange.setNotes(hostIdNotes);
  hostIdRange.setBackgrounds(hostIdBackgrounds);

  if (hostNameRange) {
    hostNameRange.setValues(hostNameValues);
    hostNameRange.setNotes(hostNameNotes);
    hostNameRange.setBackgrounds(hostNameBackgrounds);
  }

  if (supportRange) {
    supportRange.setNotes(supportNotes);
    supportRange.setBackgrounds(supportBackgrounds);
  }

  const summary = {
    totalIssues: Object.keys(hostIssuesMap).length + Object.keys(supportIssuesMap).length,
    hostIssues: Object.keys(hostIssuesMap).map(key => hostIssuesMap[key]),
    supportIssues: Object.keys(supportIssuesMap).map(key => supportIssuesMap[key]),
    updatedHostNames
  };

  if (showAlert && summary.totalIssues > 0) {
    SpreadsheetApp.getUi().alert(formatLookupAlertMessage(summary));
  }

  return summary;
}

function onEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== 'Live_Session_Master') return;
  if (e.range.getRow() === 1) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const hostColIndex = headers.indexOf("Mã nhân sự") !== -1 ? headers.indexOf("Mã nhân sự") + 1 : headers.indexOf("Streamer_ID") + 1;
  const supportColIndex = headers.indexOf("Mã Nhân sự Support live") + 1;
  let channelColIndex = headers.indexOf("Live_Channel_Id");
  if (channelColIndex === -1) channelColIndex = headers.indexOf("Kênh Live");
  channelColIndex += 1;
  if (hostColIndex === 0) return;

  if (e.range.getColumn() === hostColIndex) {
    refreshLiveChannelDropdowns();
    const lookupSummary = validateLiveSessionLookups(false, [e.range.getRow()]);
    if (lookupSummary.totalIssues > 0) {
      SpreadsheetApp.getActiveSpreadsheet().toast(formatLookupAlertMessage(lookupSummary), 'Lookup', 5);
    }
    return;
  }

  if (supportColIndex > 0 && e.range.getColumn() === supportColIndex) {
    const lookupSummary = validateLiveSessionLookups(false, [e.range.getRow()]);
    if (lookupSummary.totalIssues > 0) {
      SpreadsheetApp.getActiveSpreadsheet().toast(formatLookupAlertMessage(lookupSummary), 'Lookup', 5);
    }
    return;
  }

  if (channelColIndex > 0 && e.range.getColumn() === channelColIndex) {
    const portfolioSheet = sheet.getParent().getSheetByName('Portfolio_Master');
    if (!portfolioSheet) return;

    const portfolioData = portfolioSheet.getDataRange().getValues();
    if (portfolioData.length <= 1) return;

    const pfHeaders = portfolioData[0];
    const pfIdColIndex = pfHeaders.indexOf("Streamer_ID");
    let pfChannelColIndex = pfHeaders.indexOf("Live_Channel_Id");
    if (pfChannelColIndex === -1) pfChannelColIndex = pfHeaders.indexOf("Live_Channel");
    if (pfIdColIndex === -1 || pfChannelColIndex === -1) return;

    const row = e.range.getRow();
    const hostId = sheet.getRange(row, hostColIndex).getValue().toString().trim();
    const selectedChannel = e.range.getValue() ? e.range.getValue().toString().trim() : "";
    if (!hostId || !selectedChannel) return;

    let allowedChannels = [];
    for (let i = 1; i < portfolioData.length; i++) {
      const pfHostId = portfolioData[i][pfIdColIndex] ? portfolioData[i][pfIdColIndex].toString().trim() : "";
      if (pfHostId !== hostId) continue;

      const rawChannels = portfolioData[i][pfChannelColIndex] ? portfolioData[i][pfChannelColIndex].toString() : "";
      rawChannels.split(',').map(v => v.trim()).filter(Boolean).forEach(channel => {
        if (!allowedChannels.includes(channel)) allowedChannels.push(channel);
      });
    }

    if (allowedChannels.length > 0 && allowedChannels.includes(selectedChannel)) {
      e.range.setBackground(allowedChannels.length > 1 ? "#fff2cc" : "#d9ead3");
    } else {
      e.range.setBackground(null);
    }
  }
}
