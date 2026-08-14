export const EMPLOYEE_ID_HEADER = "Mã nhân viên";
export const FULL_NAME_HEADER = "Họ và tên đầy đủ";
export const NICKNAME_HEADER = "Tên gọi khác";
export const CURRENT_OFFER_HEADER = "Lương thỏa thuận";
export const LEVEL_HEADER = "Đánh giá level";
export const RATING_HEADER = "Rating";
export const EXPERIENCE_HEADER = "Kinh nghiệm";
export const PERSONAL_FLAG_HEADER = "Live tk cá nhân";
export const COMPANY_FLAG_HEADER = "Live tk công ty";
export const FOLLOW_HEADER = "Lượt follow";
export const LIVE_CHANNEL_ID_HEADER = "Live_Channel_Id";

export const HOST_OFFER_BY_GRADE = {
  "Thử việc": "70.000 + 5% GMV",
  C: "100.000 + 7% GMV",
  B: "120.000 + 12% GMV",
  A: "200.000 + commission theo bậc GMV",
  S: "500.000 + commission theo bậc GMV"
};

export function normalizeText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value == null ? "" : String(value).trim();
}

function normalizeSignal(value) {
  return normalizeText(value)
    .toLocaleLowerCase("vi")
    .replace(/[đĐ]/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseBool(value) {
  const normalized = normalizeSignal(value);
  if (!normalized) return null;
  if (["true", "yes", "y", "1"].includes(normalized)) return true;
  if (["false", "no", "n", "0"].includes(normalized)) return false;
  return null;
}

export function parseFollowCount(value) {
  const digits = normalizeText(value).replace(/\D/g, "");
  return digits ? Number(digits) : null;
}

export function normalizeHostGrade(value) {
  const signal = normalizeSignal(value);
  if (!signal) return undefined;
  if (signal.includes("thu viec") || signal.includes("trial") || signal.includes("trainee")) return "Thử việc";
  if (/^s(?:\s|$)/.test(signal)) return "S";
  if (/^a(?:\s|$)/.test(signal)) return "A";
  if (/^b(?:\s|$)/.test(signal)) return "B";
  if (/^c(?:\s|$)/.test(signal)) return "C";
  return undefined;
}

export function inferLane(candidate) {
  const personalFlag = parseBool(candidate[PERSONAL_FLAG_HEADER]);
  const companyFlag = parseBool(candidate[COMPANY_FLAG_HEADER]);
  const followCount = parseFollowCount(candidate[FOLLOW_HEADER]);
  const liveChannelId = normalizeText(candidate[LIVE_CHANNEL_ID_HEADER]);

  if (personalFlag && (companyFlag || liveChannelId)) {
    return { accountMode: "mixed", followCount };
  }
  if (personalFlag || followCount != null) {
    return { accountMode: "personal-account", followCount };
  }
  if (companyFlag || liveChannelId) {
    return { accountMode: "company-account", followCount };
  }
  return { accountMode: "unknown", followCount };
}

export function columnLabel(index) {
  let current = index + 1;
  let label = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}

export function rowToObject(headers, row) {
  const padded = row.concat(Array.from({ length: Math.max(0, headers.length - row.length) }, () => ""));
  return Object.fromEntries(headers.map((header, index) => [header, padded[index] || ""]));
}

export function buildCandidateName(candidate) {
  return normalizeText(candidate[FULL_NAME_HEADER]) || normalizeText(candidate[NICKNAME_HEADER]) || normalizeText(candidate[EMPLOYEE_ID_HEADER]);
}

export function buildOfferProposal({
  headers,
  row,
  rowNumber,
  tabName
}) {
  const candidate = Array.isArray(row) ? rowToObject(headers, row) : row;
  const currentValue = normalizeText(candidate[CURRENT_OFFER_HEADER]);
  const targetIndex = headers.indexOf(CURRENT_OFFER_HEADER);
  const lane = inferLane(candidate);
  const ratingGrade = normalizeHostGrade(candidate[RATING_HEADER]);
  const levelGrade = normalizeHostGrade(candidate[LEVEL_HEADER]);
  const grade = ratingGrade || levelGrade;
  const gradeSource = ratingGrade ? RATING_HEADER : levelGrade ? LEVEL_HEADER : "";
  const targetCell = `${columnLabel(targetIndex >= 0 ? targetIndex : 7)}${rowNumber}`;
  const result = {
    success: true,
    status: "hold",
    employeeId: normalizeText(candidate[EMPLOYEE_ID_HEADER]),
    employeeName: buildCandidateName(candidate),
    rowNumber,
    targetCell,
    targetRange: `'${tabName}'!${targetCell}`,
    currentValue,
    accountMode: lane.accountMode,
    grade: grade || "",
    gradeSource,
    experience: normalizeText(candidate[EXPERIENCE_HEADER]),
    proposedValue: "",
    confidence: "low",
    notes: []
  };

  if (!result.employeeId) {
    result.notes.push("Thiếu mã nhân viên; không thể sync cột H.");
    return result;
  }

  if (lane.accountMode !== "company-account") {
    result.notes.push(
      lane.accountMode === "personal-account"
        ? "Row đang là personal-account; chuyển sang skill hr-offer-eval để duyệt theo follow band."
        : lane.accountMode === "mixed"
          ? "Row có cả personal và company signal; chuyển sang skill hr-offer-eval để duyệt thủ công."
          : "Không xác định được lane company-account; chưa tự động ghi cột H."
    );
    return result;
  }

  if (!grade || !HOST_OFFER_BY_GRADE[grade]) {
    result.notes.push(`Thiếu tín hiệu đánh giá ở cột ${RATING_HEADER} hoặc ${LEVEL_HEADER}; chưa tự động ghi cột H.`);
    return result;
  }

  result.status = "ready";
  result.proposedValue = HOST_OFFER_BY_GRADE[grade];
  result.confidence = gradeSource === RATING_HEADER ? "high" : "medium";

  if (currentValue === result.proposedValue) {
    result.notes.push("Cột H hiện đã khớp với mức đề xuất.");
  } else if (currentValue) {
    result.notes.push("Cột H đang có giá trị khác; apply sẽ là hành động overwrite.");
  } else {
    result.notes.push("Cột H đang trống; có thể ghi mới sau khi duyệt.");
  }

  if (!normalizeText(candidate[EXPERIENCE_HEADER])) {
    result.notes.push("Cột Kinh nghiệm đang trống; nên HR kiểm tra lại trước khi chốt.");
  }

  return result;
}

export function buildSummary(results) {
  return results.reduce((summary, item) => {
    summary.total += 1;
    if (item.status === "ready") summary.ready += 1;
    if (item.status === "hold") summary.hold += 1;
    if (item.status === "skipped") summary.skipped += 1;
    if (item.status === "applied") summary.applied += 1;
    return summary;
  }, {
    total: 0,
    ready: 0,
    hold: 0,
    skipped: 0,
    applied: 0
  });
}
