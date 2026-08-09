

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

function extractUnmatchedMinutesFromPayrollNote(noteValue) {
  const raw = noteValue ? noteValue.toString() : "";
  if (!raw) return 0;

  const match = raw.match(/unmatched\s+(\d+(?:\.\d+)?)m/i);
  return match ? (parseFloat(match[1]) || 0) : 0;
}

function buildPayrollAggregationSessionId(liveId, sessionIds, roleTag) {
  const uniqueSessionIds = (sessionIds || []).filter(Boolean);
  if (uniqueSessionIds.length === 1) return uniqueSessionIds[0];

  const safeLiveId = liveId ? liveId.toString().trim() : "";
  const shortLiveId = safeLiveId ? safeLiveId.slice(-8) : "UNKNOWN";
  return `LIVE-${shortLiveId}-${roleTag}`;
}

const PAYROLL_BLOCK_MAX_GAP_MINUTES = 10;

function parsePayrollDateTimeValue_(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof parseFlexibleDateValue === "function") {
    const parsed = parseFlexibleDateValue(value);
    if (parsed instanceof Date && !isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  if (value instanceof Date && !isNaN(value.getTime())) {
    return new Date(value.getTime());
  }

  const directDate = new Date(value);
  if (!isNaN(directDate.getTime())) {
    return directDate;
  }

  return null;
}

function buildPayrollDateParts_(date, timezone) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return null;

  return {
    dateStr: Utilities.formatDate(date, timezone, "dd/MM/yyyy"),
    dateKey: Utilities.formatDate(date, timezone, "yyyy-MM-dd")
  };
}

function normalizePayrollIdentityKey_(value) {
  return normalizeRateCardText(value).replace(/[^a-z0-9]/g, "");
}

function sanitizePayrollToken_(value) {
  const token = (value || "")
    .toString()
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return token || "UNKNOWN";
}

function isMeaningfulPayrollStaffId_(value) {
  const normalized = normalizeRateCardText(value).replace(/\s+/g, "_");
  return Boolean(
    normalized &&
    !["trong", "unknown", "no_host", "nohost", "no_support", "nosupport"].includes(normalized)
  );
}

function shouldResolvePayrollHostFromAccount_(value) {
  const normalized = normalizeRateCardText(value).replace(/\s+/g, "_");
  return !normalized || normalized === "trong" || normalized === "unknown" || normalized === "no_host" || normalized === "nohost";
}

function buildPayrollBlockSlotValue_(block, timezone) {
  const hasStart = block.blockStartDate instanceof Date && !isNaN(block.blockStartDate.getTime());
  const hasEnd = block.blockEndDate instanceof Date && !isNaN(block.blockEndDate.getTime());

  if (!hasStart && !hasEnd) return "00:00 - 00:00";

  const startValue = hasStart
    ? Utilities.formatDate(block.blockStartDate, timezone, "HH:mm")
    : "00:00";
  const endValue = hasEnd
    ? Utilities.formatDate(block.blockEndDate, timezone, "HH:mm")
    : startValue;

  return `${startValue} - ${endValue}`;
}

function buildPayrollBlockCompanionCode_(companionFlags, fallbackValue) {
  const companionIds = Object.keys(companionFlags || {}).filter(isMeaningfulPayrollStaffId_);
  if (companionIds.length === 1) return companionIds[0];
  return fallbackValue;
}

function buildPayrollBlockSessionId_(block, roleTag, timezone) {
  const sessionIds = Object.keys(block.sessionFlags || {}).filter(Boolean);
  if (sessionIds.length === 1) return sessionIds[0];

  const slotValue = buildPayrollBlockSlotValue_(block, timezone);
  const hostCode = roleTag === "HOST"
    ? (isMeaningfulPayrollStaffId_(block.staffId) ? block.staffId : "NOHOST")
    : buildPayrollBlockCompanionCode_(block.companionFlags, "NOHOST");
  const supportCode = roleTag === "SUPPORT"
    ? (isMeaningfulPayrollStaffId_(block.staffId) ? block.staffId : "NO_SUPPORT")
    : buildPayrollBlockCompanionCode_(block.companionFlags, "NO_SUPPORT");

  if (typeof buildScheduleSessionId === "function") {
    return buildScheduleSessionId(block.dateStr || block.dateKey, slotValue, hostCode, supportCode);
  }

  const dateToken = (block.dateKey || "").replace(/-/g, "") || ((block.dateStr || "").replace(/[^0-9]/g, "") || "DATE");
  const slotToken = slotValue.replace(/[^0-9]/g, "") || "NOSLOT";
  return `SS-${dateToken}-${slotToken}-${hostCode}-${supportCode}`;
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
  let liveIdIdx = tkHeaders.indexOf("tiktok_live_id");
  let noteIdx   = tkHeaders.indexOf("note");
  let startIdx  = tkHeaders.indexOf("start_time");
  let endIdx    = tkHeaders.indexOf("end_time");
  let grossIdx  = tkHeaders.indexOf("gross_gmv");
  let retIdx    = tkHeaders.indexOf("returned_gmv");
  let accountIdx = tkHeaders.indexOf("account_id");
  let hostIdx   = tkHeaders.indexOf("host_id");
  let suppIdx   = tkHeaders.indexOf("support_id");

  if (sessIdx === -1) sessIdx = 0;
  if (liveIdIdx === -1) liveIdIdx = 1;
  if (noteIdx === -1) noteIdx = 9;
  if (startIdx === -1) startIdx = 3;
  if (endIdx === -1) endIdx = 4;
  if (retIdx === -1) retIdx = 5;
  if (grossIdx === -1) grossIdx = 7;
  if (accountIdx === -1) accountIdx = 2;
  if (hostIdx === -1) hostIdx = 10;
  if (suppIdx === -1) suppIdx = 11;

  let payrollRows = [];
  const payrollTz = typeof getAppTimeZone === "function" ? getAppTimeZone() : ss.getSpreadsheetTimeZone();
  const hostLiveMetaMap = {};
  const supportLiveMetaMap = {};
  const rowContexts = [];
  const hostAccountDayMap = {};

  function touchLiveMeta(metaMap, liveKey, staffId, unmatchedMinutes) {
    if (!metaMap[liveKey]) {
      metaMap[liveKey] = {
        staffFlags: {},
        unmatchedMinutes: 0
      };
    }

    if (staffId) metaMap[liveKey].staffFlags[staffId] = true;
    metaMap[liveKey].unmatchedMinutes = Math.max(metaMap[liveKey].unmatchedMinutes, unmatchedMinutes || 0);
  }

  function buildAccountDayKey(dateKey, accountId) {
    if (!dateKey) return "";
    return `${dateKey}__${normalizePayrollIdentityKey_(accountId || "NO_ACCOUNT")}`;
  }

  function touchAccountDayStaff(map, dateKey, accountId, staffIds) {
    const key = buildAccountDayKey(dateKey, accountId);
    if (!key || !staffIds || !staffIds.length) return;
    if (!map[key]) map[key] = {};

    staffIds.forEach(staffId => {
      if (staffId) map[key][staffId] = true;
    });
  }

  function splitPayrollIds(rawValue) {
    if (!rawValue) return [];

    return rawValue
      .toString()
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);
  }

  for (let i = 1; i < tkData.length; i++) {
    let sessId     = tkData[i][sessIdx] ? tkData[i][sessIdx].toString().trim() : "";
    let liveId     = tkData[i][liveIdIdx] ? tkData[i][liveIdIdx].toString().trim() : "";
    let accountId  = tkData[i][accountIdx] ? tkData[i][accountIdx].toString().trim() : "";
    let noteVal    = tkData[i][noteIdx];
    let rawHostIds = tkData[i][hostIdx] ? tkData[i][hostIdx].toString().trim() : "";
    let rawSuppIds = tkData[i][suppIdx] ? tkData[i][suppIdx].toString().trim() : "";

    if ((!rawHostIds || rawHostIds.toLowerCase().includes("trống")) && (!rawSuppIds || rawSuppIds.toLowerCase().includes("trống"))) {
      continue;
    }

    let startTimeVal = tkData[i][startIdx];
    let endTimeVal   = tkData[i][endIdx];
    let dateStr = "";
    let dateKey = "";
    let hoursWorkedRaw = 2.0;
    let startDate = parsePayrollDateTimeValue_(startTimeVal);
    let endDate   = parsePayrollDateTimeValue_(endTimeVal);

    if (startDate) {
      const startParts = buildPayrollDateParts_(startDate, payrollTz);
      if (startParts) {
        dateStr = startParts.dateStr;
        dateKey = startParts.dateKey;
      }
      if (endDate && endDate.getTime() > startDate.getTime()) {
        let diffMs = endDate.getTime() - startDate.getTime();
        hoursWorkedRaw = diffMs / (1000 * 60 * 60);
      } else {
        endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
      }
    } else if (startTimeVal) {
      dateStr = startTimeVal.toString().split(" ")[0];
    }

    let grossGMV = parseCurrencyNumber(tkData[i][grossIdx]);
    let returnedGMV = parseCurrencyNumber(tkData[i][retIdx]);
    let eligibleGMV = Math.max(0, grossGMV - returnedGMV);
    let unmatchedMinutes = extractUnmatchedMinutesFromPayrollNote(noteVal);
    let hostIds = splitPayrollIds(rawHostIds).filter(isMeaningfulPayrollStaffId_);
    let suppIds = splitPayrollIds(rawSuppIds).filter(isMeaningfulPayrollStaffId_);
    const aggregationLiveKey = liveId || (sessId ? `SESSION-${sessId}` : `ROW-${i}`);

    touchAccountDayStaff(hostAccountDayMap, dateKey, accountId, hostIds);

    rowContexts.push({
      rowNumber: i + 1,
      liveKey: aggregationLiveKey,
      sessId,
      liveId: liveId || aggregationLiveKey,
      accountId,
      dateStr,
      dateKey,
      startDate,
      endDate,
      hoursWorkedRaw,
      eligibleGMV,
      unmatchedMinutes,
      hostIds,
      suppIds,
      rawHostIds
    });
  }

  function buildRoundedHours(totalHoursRaw, extraMinutes) {
    const totalHours = totalHoursRaw + ((extraMinutes || 0) / 60);
    if (totalHours <= 0) return 0;
    return Math.max(0.5, Math.round(totalHours * 10) / 10);
  }

  function resolveHostIdsForPayroll(context) {
    if (context.hostIds && context.hostIds.length > 0) {
      return context.hostIds;
    }

    if (!shouldResolvePayrollHostFromAccount_(context.rawHostIds)) {
      return [];
    }

    const accountKey = buildAccountDayKey(context.dateKey, context.accountId);
    if (!accountKey || !hostAccountDayMap[accountKey]) {
      return [];
    }

    const candidateHostIds = Object.keys(hostAccountDayMap[accountKey]);
    return candidateHostIds.length === 1 ? candidateHostIds : [];
  }

function createPayrollSegment(role, staffId, context, allocatedGMV) {
  return {
      role,
      staffId,
      accountId: context.accountId || "",
      liveKey: context.liveKey,
      liveId: context.liveId,
      sessionId: context.sessId,
      dateStr: context.dateStr,
      dateKey: context.dateKey,
      startDate: context.startDate,
      endDate: context.endDate,
      hoursWorkedRaw: context.hoursWorkedRaw,
      eligibleGMV: allocatedGMV,
      companionIds: []
    };
  }

  const hostSegments = [];
  const supportSegments = [];

  rowContexts.forEach(context => {
    const resolvedHostIds = resolveHostIdsForPayroll(context);
    const resolvedSupportIds = context.suppIds || [];
    const gmvPerHost = resolvedHostIds.length > 0 ? context.eligibleGMV / resolvedHostIds.length : context.eligibleGMV;

    resolvedHostIds.forEach(hostId => {
      if (!hostId) return;
      touchLiveMeta(hostLiveMetaMap, context.liveKey, hostId, context.unmatchedMinutes);
      const segment = createPayrollSegment("HOST", hostId, context, gmvPerHost);
      segment.companionIds = (context.suppIds || []).filter(isMeaningfulPayrollStaffId_);
      hostSegments.push(segment);
    });

    resolvedSupportIds.forEach(supportId => {
      if (!supportId) return;
      touchLiveMeta(supportLiveMetaMap, context.liveKey, supportId, context.unmatchedMinutes);
      const segment = createPayrollSegment("SUPPORT", supportId, context, context.eligibleGMV);
      segment.companionIds = (resolvedHostIds || []).filter(isMeaningfulPayrollStaffId_);
      supportSegments.push(segment);
    });
  });

  function buildSegmentGroupKey(segment) {
    return [
      segment.role,
      segment.staffId,
      segment.dateKey || segment.dateStr || "NO_DATE",
      normalizePayrollIdentityKey_(segment.accountId || "NO_ACCOUNT")
    ].join("__");
  }

  function sortPayrollSegments(left, right) {
    const leftTime = (left.startDate instanceof Date && !isNaN(left.startDate.getTime())) ? left.startDate.getTime() : Number.POSITIVE_INFINITY;
    const rightTime = (right.startDate instanceof Date && !isNaN(right.startDate.getTime())) ? right.startDate.getTime() : Number.POSITIVE_INFINITY;
    if (leftTime !== rightTime) return leftTime - rightTime;

    const leftTie = `${left.liveId || ""}__${left.sessionId || ""}`;
    const rightTie = `${right.liveId || ""}__${right.sessionId || ""}`;
    return leftTie.localeCompare(rightTie);
  }

  function createPayrollBlock(segment) {
    return {
      role: segment.role,
      staffId: segment.staffId,
      accountId: segment.accountId || "",
      dateStr: segment.dateStr,
      dateKey: segment.dateKey,
      totalHoursRaw: 0,
      totalEligibleGMV: 0,
      sessionFlags: {},
      liveFlags: {},
      companionFlags: {},
      primaryLiveId: segment.liveId || segment.liveKey,
      blockStartDate: segment.startDate instanceof Date && !isNaN(segment.startDate.getTime()) ? new Date(segment.startDate.getTime()) : null,
      blockEndDate: segment.endDate instanceof Date && !isNaN(segment.endDate.getTime()) ? new Date(segment.endDate.getTime()) : null
    };
  }

  function addSegmentToPayrollBlock(block, segment) {
    block.totalHoursRaw += segment.hoursWorkedRaw || 0;
    block.totalEligibleGMV += segment.eligibleGMV || 0;

    if (segment.sessionId) block.sessionFlags[segment.sessionId] = true;
    if (segment.liveKey) block.liveFlags[segment.liveKey] = true;
    (segment.companionIds || []).forEach(companionId => {
      if (companionId) block.companionFlags[companionId] = true;
    });

    if (!block.primaryLiveId && segment.liveId) {
      block.primaryLiveId = segment.liveId;
    }

    if (segment.startDate instanceof Date && !isNaN(segment.startDate.getTime())) {
      if (!block.blockStartDate || segment.startDate.getTime() < block.blockStartDate.getTime()) {
        block.blockStartDate = new Date(segment.startDate.getTime());
      }
    }

    if (segment.endDate instanceof Date && !isNaN(segment.endDate.getTime())) {
      if (!block.blockEndDate || segment.endDate.getTime() > block.blockEndDate.getTime()) {
        block.blockEndDate = new Date(segment.endDate.getTime());
      }
    }
  }

  function canMergeIntoPayrollBlock(block, segment) {
    if (!block || !segment) return false;
    if (block.staffId !== segment.staffId) return false;
    if ((block.dateKey || block.dateStr || "") !== (segment.dateKey || segment.dateStr || "")) return false;
    if (normalizePayrollIdentityKey_(block.accountId || "") !== normalizePayrollIdentityKey_(segment.accountId || "")) return false;

    if (!(block.blockEndDate instanceof Date) || isNaN(block.blockEndDate.getTime())) return false;
    if (!(segment.startDate instanceof Date) || isNaN(segment.startDate.getTime())) return false;

    const allowedGapMs = PAYROLL_BLOCK_MAX_GAP_MINUTES * 60 * 1000;
    return segment.startDate.getTime() <= (block.blockEndDate.getTime() + allowedGapMs);
  }

  function buildPayrollBlocks(segments) {
    const groupedSegments = {};

    segments.forEach(segment => {
      const key = buildSegmentGroupKey(segment);
      if (!groupedSegments[key]) groupedSegments[key] = [];
      groupedSegments[key].push(segment);
    });

    const blocks = [];

    Object.keys(groupedSegments).forEach(key => {
      const sortedSegments = groupedSegments[key].slice().sort(sortPayrollSegments);
      let currentBlock = null;

      sortedSegments.forEach(segment => {
        if (!currentBlock || !canMergeIntoPayrollBlock(currentBlock, segment)) {
          if (currentBlock) blocks.push(currentBlock);
          currentBlock = createPayrollBlock(segment);
        }

        addSegmentToPayrollBlock(currentBlock, segment);
      });

      if (currentBlock) blocks.push(currentBlock);
    });

    return blocks.sort((left, right) => {
      const leftTime = (left.blockStartDate instanceof Date && !isNaN(left.blockStartDate.getTime())) ? left.blockStartDate.getTime() : Number.POSITIVE_INFINITY;
      const rightTime = (right.blockStartDate instanceof Date && !isNaN(right.blockStartDate.getTime())) ? right.blockStartDate.getTime() : Number.POSITIVE_INFINITY;
      if (leftTime !== rightTime) return leftTime - rightTime;

      return `${left.dateKey || left.dateStr || ""}__${left.staffId || ""}`.localeCompare(`${right.dateKey || right.dateStr || ""}__${right.staffId || ""}`);
    });
  }

  function getBlockExtraMinutes(block, liveMetaMap) {
    let totalExtraMinutes = 0;
    const liveKeys = Object.keys(block.liveFlags || {});

    liveKeys.forEach(liveKey => {
      const liveMeta = liveMetaMap[liveKey];
      if (!liveMeta) return;

      const uniqueStaffIds = Object.keys(liveMeta.staffFlags || {});
      if (uniqueStaffIds.length === 1 && uniqueStaffIds[0] === block.staffId) {
        totalExtraMinutes += liveMeta.unmatchedMinutes || 0;
      }
    });

    return totalExtraMinutes;
  }

  const hostBlocks = buildPayrollBlocks(hostSegments);
  const supportBlocks = buildPayrollBlocks(supportSegments);

  hostBlocks.forEach(block => {
    const extraMinutes = getBlockExtraMinutes(block, hostLiveMetaMap);
    const hoursWorked = buildRoundedHours(block.totalHoursRaw, extraMinutes);

    let fullName = hostNameMap[block.staffId] || block.staffId;
    let grade = hostGradeMap[block.staffId] || hostPfGradeMap[block.staffId] || "Thử việc";
    const hostComp = resolveHostCompensation(grade, block.totalEligibleGMV, rateCard);
    let hourlyRate = hostComp.hourlyRate;
    let commRate   = hostComp.commRate;

    let basePay    = hoursWorked * hourlyRate;
    let commPay    = block.totalEligibleGMV * commRate;
    let bonusPay   = 0;
    let totalPayout = basePay + commPay;
    let cleanSessId = buildPayrollBlockSessionId_(block, "HOST", payrollTz);

    payrollRows.push([
      cleanSessId, block.dateStr, block.staffId, fullName, "Host (Chính)",
      grade, hoursWorked, hourlyRate, basePay,
      block.totalEligibleGMV, commRate, commPay,
      bonusPay, totalPayout
    ]);
  });

  supportBlocks.forEach(block => {
    const extraMinutes = getBlockExtraMinutes(block, supportLiveMetaMap);
    const hoursWorked = buildRoundedHours(block.totalHoursRaw, extraMinutes);

    let suppName  = suppNameMap[block.staffId] || hostNameMap[block.staffId] || block.staffId;
    let suppGrade = suppLevelMap[block.staffId] || "Cấp 2";
    let hourlyRate = 0;
    let commRate   = 0;

    if (rateCard.SUPPORT[suppGrade]) {
      hourlyRate = rateCard.SUPPORT[suppGrade].hourlyRate;
      commRate   = rateCard.SUPPORT[suppGrade].commRate;
    }

    let basePay    = hoursWorked * hourlyRate;
    let commPay    = block.totalEligibleGMV * commRate;
    let totalPayout = basePay + commPay;
    let cleanSessId = buildPayrollBlockSessionId_(block, "SUPPORT", payrollTz);

    payrollRows.push([
      cleanSessId, block.dateStr, block.staffId, suppName, "Support",
      suppGrade, hoursWorked, hourlyRate, basePay,
      block.totalEligibleGMV, commRate, commPay,
      0, totalPayout
    ]);
  });

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
