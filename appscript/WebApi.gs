const SCHEDULE_WEB_TOKEN_PROPERTY = "SCHEDULE_WEB_TOKEN";
const SCHEDULE_WEB_CONFIRM_REVISION_PROPERTY = "SCHEDULE_WEB_CONFIRM_REVISION";
const SCHEDULE_WEB_CONFIRM_VALUE = "Đã xác nhận";
const SCHEDULE_WEB_UNCONFIRM_VALUE = "Chưa xác nhận";

function doGet(e) {
  return handleScheduleWebRequest_("GET", e);
}

function doPost(e) {
  return handleScheduleWebRequest_("POST", e);
}

function generateScheduleWebToken() {
  const token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  PropertiesService.getScriptProperties().setProperty(SCHEDULE_WEB_TOKEN_PROPERTY, token);
  const message =
    "Đã tạo SCHEDULE_WEB_TOKEN. Copy token này vào biến GOOGLE_SCHEDULE_API_TOKEN trên Vercel:\n" +
    token;
  safeAlert(message);
  return token;
}

function handleScheduleWebRequest_(method, event) {
  try {
    const body = method === "POST" ? parseScheduleWebJsonBody_(event) : {};
    const params = (event && event.parameter) || {};
    const action = (body.action || params.action || "schedule").toString().trim().toLowerCase();

    assertScheduleWebToken_(body.token || params.token);

    if (method === "GET" && action === "people") {
      return buildScheduleWebJsonResponse_(getScheduleWebPeoplePayload_());
    }

    if (method === "GET" || action === "schedule") {
      return buildScheduleWebJsonResponse_(getScheduleWebPayload_(params));
    }

    if (action === "confirm") {
      return buildScheduleWebJsonResponse_(confirmScheduleWebSession_(body));
    }

    if (action === "refresh") {
      return buildScheduleWebJsonResponse_(refreshScheduleWebPayload_(body));
    }

    if (action === "read") {
      return buildScheduleWebJsonResponse_(readScheduleWebSnapshot_());
    }

    if (action === "submit_application") {
      return buildScheduleWebJsonResponse_(submitScheduleWebApplication_(body));
    }

    throw new Error("Action không hợp lệ.");
  } catch (error) {
    return buildScheduleWebJsonResponse_({
      success: false,
      error: error && error.message ? error.message : String(error)
    });
  }
}

function parseScheduleWebJsonBody_(event) {
  const raw = event && event.postData && event.postData.contents
    ? event.postData.contents
    : "";
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("Body JSON không hợp lệ.");
  }
}

function assertScheduleWebToken_(incomingToken) {
  const expectedToken = PropertiesService.getScriptProperties().getProperty(SCHEDULE_WEB_TOKEN_PROPERTY);
  if (!expectedToken) {
    throw new Error("Chưa cấu hình Script Property SCHEDULE_WEB_TOKEN.");
  }

  if (!incomingToken || incomingToken !== expectedToken) {
    throw new Error("Token không hợp lệ.");
  }
}

function buildScheduleWebJsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function getScheduleWebSpreadsheet_() {
  const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (activeSpreadsheet) return activeSpreadsheet;

  if (typeof DEST_FILE_ID === "string" && DEST_FILE_ID) {
    return SpreadsheetApp.openById(DEST_FILE_ID);
  }

  throw new Error("Không xác định được spreadsheet đích.");
}

function getScheduleWebApplicationSpreadsheet_() {
  if (typeof SOURCE_SCHEDULE_SPREADSHEET_ID === "string" && SOURCE_SCHEDULE_SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SOURCE_SCHEDULE_SPREADSHEET_ID);
  }

  if (typeof SOURCE_FILE_ID === "string" && SOURCE_FILE_ID) {
    return SpreadsheetApp.openById(SOURCE_FILE_ID);
  }

  const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (activeSpreadsheet) return activeSpreadsheet;

  throw new Error("Không xác định được spreadsheet nguồn để ghi hồ sơ ứng tuyển.");
}

function submitScheduleWebApplication_(body) {
  const role = body && body.role ? body.role.toString().trim().toLowerCase() : "";
  const employeeId = body && body.employeeId ? body.employeeId.toString().trim() : "";
  const fullName = body && body.fullName ? body.fullName.toString().trim() : "";
  const phone = body && body.phone ? body.phone.toString().trim() : "";

  if (role !== "host" && role !== "support") throw new Error("role phải là host hoặc support.");
  if (!employeeId) throw new Error("Thiếu employeeId.");
  if (!fullName) throw new Error("Thiếu fullName.");
  if (!phone) throw new Error("Thiếu phone.");

  const ss = getScheduleWebApplicationSpreadsheet_();
  const sheetName = role === "host" ? "Thông tin Mẫu Live" : "Thông tin Support Live";
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error("Không tìm thấy tab " + sheetName + ".");

  const headerMap = ensureScheduleWebApplicationHeaders_(sheet, role);
  const rowIndex = findScheduleWebApplicationRow_(sheet, headerMap, {
    role: role,
    employeeId: employeeId,
    phone: phone,
    email: body && body.email ? body.email.toString().trim() : ""
  });
  const values = buildScheduleWebApplicationRowValues_(headerMap, body, role);
  const targetRow = rowIndex === -1 ? sheet.getLastRow() + 1 : rowIndex;

  sheet.getRange(targetRow, 1, 1, values.length).setValues([values]);

  return {
    success: true,
    spreadsheetId: ss.getId(),
    sheetName: sheetName,
    rowNumber: targetRow,
    employeeId: employeeId,
    action: rowIndex === -1 ? "inserted" : "updated"
  };
}

function getScheduleWebApplicationHeaderSpecs_(role) {
  const common = [
    { key: "employeeId", header: "Mã nhân viên", aliases: ["mã nhân viên", "ma nhan vien", "streamer_id", "support_id", "mã support"] },
    { key: "fullName", header: "Tên", aliases: ["tên", "ten", "họ và tên", "ho va ten", "full_name", "full name"] },
    { key: "phone", header: "SĐT", aliases: ["sđt", "số điện thoại", "so dien thoai", "phone"] },
    { key: "email", header: "Email", aliases: ["email", "gmail"] },
    { key: "cvUrl", header: "CV", aliases: ["cv", "link cv", "cv link", "đường dẫn cv"] },
    { key: "experience", header: "Kinh nghiệm", aliases: ["kinh nghiệm", "kinh nghiem", "experience"] },
    { key: "achievements", header: "Thành tích", aliases: ["thành tích", "thanh tich", "achievements"] },
    { key: "expectedSalary", header: "Lương thỏa thuận", aliases: ["lương thỏa thuận", "luong thoa thuan", "cash offer", "expected salary"] },
    { key: "notes", header: "Ghi chú", aliases: ["ghi chú", "ghi chu", "note", "notes"] },
    { key: "applicationId", header: "Application ID", aliases: ["application id", "application_id"] },
    { key: "submittedAt", header: "Submitted At", aliases: ["submitted at", "submitted_at", "thời gian nộp", "thoi gian nop"] }
  ];

  if (role !== "host") return common;

  return common.concat([
    { key: "liveAtHome", header: "Live tại nhà", aliases: ["live tại nhà", "live tai nha"] },
    { key: "liveAtStudio", header: "Live tại Studio", aliases: ["live tại studio", "live tai studio"] },
    { key: "livePersonal", header: "Live tk cá nhân", aliases: ["live tk cá nhân", "live tk ca nhan"] },
    { key: "liveCompany", header: "Live tk công ty", aliases: ["live tk công ty", "live tk cong ty"] },
    { key: "introVideoUrl", header: "Video giới thiệu", aliases: ["video giới thiệu", "video gioi thieu", "intro video", "video"] },
    { key: "tiktokUrl", header: "TikTok", aliases: ["tiktok", "link tiktok"] }
  ]);
}

function ensureScheduleWebApplicationHeaders_(sheet, role) {
  const specs = getScheduleWebApplicationHeaderSpecs_(role);
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const rawHeaders = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const normalizedHeaders = rawHeaders.map(function(header) {
    return normalizeScheduleTrackingText(header).replace(/_/g, " ");
  });
  const columnByKey = {};
  let currentLastColumn = lastColumn;

  specs.forEach(function(spec) {
    const aliases = spec.aliases.map(function(alias) {
      return normalizeScheduleTrackingText(alias).replace(/_/g, " ");
    });
    let columnIndex = -1;

    for (let i = 0; i < aliases.length; i++) {
      const exactIndex = normalizedHeaders.indexOf(aliases[i]);
      if (exactIndex !== -1) {
        columnIndex = exactIndex;
        break;
      }
    }

    if (columnIndex === -1) {
      currentLastColumn += 1;
      sheet.getRange(1, currentLastColumn).setValue(spec.header);
      normalizedHeaders.push(normalizeScheduleTrackingText(spec.header).replace(/_/g, " "));
      columnIndex = currentLastColumn - 1;
    }

    columnByKey[spec.key] = columnIndex + 1;
  });

  return {
    specs: specs,
    columnByKey: columnByKey,
    width: currentLastColumn
  };
}

function findScheduleWebApplicationRow_(sheet, headerMap, lookup) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return -1;

  const values = sheet.getRange(2, 1, lastRow - 1, headerMap.width).getDisplayValues();
  const employeeIdCol = headerMap.columnByKey.employeeId - 1;
  const phoneCol = headerMap.columnByKey.phone - 1;
  const emailCol = headerMap.columnByKey.email ? headerMap.columnByKey.email - 1 : -1;
  const normalizedEmployeeId = normalizeScheduleTrackingText(lookup.employeeId);
  const normalizedPhone = normalizeScheduleTrackingText(lookup.phone);
  const normalizedEmail = normalizeScheduleTrackingText(lookup.email || "");

  for (let i = 0; i < values.length; i++) {
    if (normalizeScheduleTrackingText(values[i][employeeIdCol]) === normalizedEmployeeId) return i + 2;
  }

  for (let i = 0; i < values.length; i++) {
    if (normalizedPhone && normalizeScheduleTrackingText(values[i][phoneCol]) === normalizedPhone) return i + 2;
    if (normalizedEmail && emailCol !== -1 && normalizeScheduleTrackingText(values[i][emailCol]) === normalizedEmail) return i + 2;
  }

  return -1;
}

function buildScheduleWebApplicationRowValues_(headerMap, body, role) {
  const values = [];
  for (let index = 0; index < headerMap.width; index++) values.push("");

  function setValue(key, value) {
    const col = headerMap.columnByKey[key];
    if (!col) return;
    values[col - 1] = value;
  }

  setValue("employeeId", body.employeeId || "");
  setValue("fullName", body.fullName || "");
  setValue("phone", body.phone || "");
  setValue("email", body.email || "");
  setValue("cvUrl", body.cvUrl || "");
  setValue("experience", body.experience || "");
  setValue("achievements", body.achievements || "");
  setValue("expectedSalary", body.expectedSalary || "");
  setValue("notes", body.notes || "");
  setValue("applicationId", body.applicationId || "");
  setValue("submittedAt", body.submittedAt || new Date().toISOString());

  if (role === "host") {
    setValue("liveAtHome", body.liveLocationPreference === "home" ? "Có" : "");
    setValue("liveAtStudio", body.liveLocationPreference === "studio" ? "Có" : "");
    setValue("livePersonal", body.liveAccountPreference === "personal" ? "Có" : "");
    setValue("liveCompany", body.liveAccountPreference === "company" ? "Có" : "");
    setValue("introVideoUrl", body.introVideoUrl || "");
    setValue("tiktokUrl", body.tiktokUrl || "");
  }

  return values;
}

function getScheduleWebPeoplePayload_() {
  const ss = getScheduleWebSpreadsheet_();
  const portfolioSheet = ss.getSheetByName("Portfolio_Master");
  const supportSheet = ss.getSheetByName("Support_Master");
  if (!portfolioSheet || !supportSheet) {
    throw new Error("Thiếu tab Portfolio_Master hoặc Support_Master.");
  }

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    source: "Portfolio_Master / Support_Master",
    hosts: readScheduleWebPeople_(portfolioSheet, "host"),
    supports: readScheduleWebPeople_(supportSheet, "support")
  };
}

function readScheduleWebPeople_(sheet, role) {
  const data = sheet.getDataRange().getDisplayValues();
  if (data.length <= 1) return [];

  const headers = data[0];
  const idAliases = role === "host"
    ? ["streamer_id", "ma nhan vien", "ma"]
    : ["ma support (support_id)", "support_id", "ma support", "ma"];
  const nameAliases = role === "host"
    ? ["full_name", "ho va ten", "ten"]
    : ["ho va ten", "full_name", "ten"];
  const levelAliases = role === "host"
    ? ["entry_grade", "entry grade", "grade"]
    : ["cap do / level", "cap do", "level"];
  const idCol = findScheduleWebPeopleHeader_(headers, idAliases);
  const nameCol = findScheduleWebPeopleHeader_(headers, nameAliases);
  const levelCol = findScheduleWebPeopleHeader_(headers, levelAliases);

  if (idCol === -1) {
    throw new Error("Không tìm thấy cột mã nhân viên trong " + sheet.getName() + ".");
  }

  const seen = {};
  const people = [];
  for (let i = 1; i < data.length; i++) {
    const id = data[i][idCol] ? data[i][idCol].toString().trim() : "";
    if (!isMeaningfulScheduleValue(id)) continue;
    const lookupKey = id.toLowerCase();
    if (seen[lookupKey]) continue;
    seen[lookupKey] = true;
    people.push({
      id: id,
      name: nameCol !== -1 && data[i][nameCol] ? data[i][nameCol].toString().trim() : id,
      role: role,
      level: levelCol !== -1 && data[i][levelCol] ? data[i][levelCol].toString().trim() : ""
    });
  }

  people.sort(function(left, right) {
    return [left.name, left.id].join("__").localeCompare([right.name, right.id].join("__"));
  });
  return people;
}

function findScheduleWebPeopleHeader_(headers, aliases) {
  const normalizedHeaders = (headers || []).map(function(header) {
    return normalizeScheduleTrackingText(header).replace(/_/g, " ");
  });
  const normalizedAliases = (aliases || []).map(function(alias) {
    return normalizeScheduleTrackingText(alias).replace(/_/g, " ");
  });

  for (let i = 0; i < normalizedAliases.length; i++) {
    const exactIndex = normalizedHeaders.indexOf(normalizedAliases[i]);
    if (exactIndex !== -1) return exactIndex;
  }
  for (let i = 0; i < normalizedAliases.length; i++) {
    const partialIndex = normalizedHeaders.findIndex(function(header) {
      return header.indexOf(normalizedAliases[i]) !== -1;
    });
    if (partialIndex !== -1) return partialIndex;
  }
  return -1;
}

function getScheduleWebPayload_(params) {
  const ss = getScheduleWebSpreadsheet_();
  const sheet = ss.getSheetByName("Live_Session_Master");
  if (!sheet) {
    throw new Error("Không tìm thấy tab Live_Session_Master.");
  }

  ensureRealScheduleTrackingColumns(sheet);

  const timezone = getAppTimeZone();
  const fromKey = normalizeScheduleWebDateKey_(params && params.from);
  const toKey = normalizeScheduleWebDateKey_(params && params.to);
  const rows = readScheduleWebRows_(sheet, timezone, fromKey, toKey);

  return {
    success: true,
    spreadsheetId: ss.getId(),
    sheetName: sheet.getName(),
    generatedAt: new Date().toISOString(),
    confirmationRevision: getScheduleWebConfirmationRevision_(),
    timezone: timezone,
    rowCount: rows.length,
    summary: buildScheduleWebSummary_(rows),
    rows: rows
  };
}

function refreshScheduleWebPayload_() {
  const lock = getScheduleWebLock_();
  if (!lock.tryLock(30000)) {
    throw new Error("Không lấy được lock để cập nhật lịch. Vui lòng thử lại.");
  }

  try {
    const syncResult = syncAndUnpivotSchedule({
      futureOnly: true,
      suppressAlert: true,
      externalLockHeld: true
    }) || {
      success: false,
      message: "Không nhận được kết quả sync."
    };
    const payload = getScheduleWebPayload_({});
    payload.sync = syncResult;
    return payload;
  } finally {
    lock.releaseLock();
  }
}

function readScheduleWebSnapshot_() {
  const lock = getScheduleWebLock_();
  if (!lock.tryLock(10000)) {
    throw new Error("Không lấy được lock để đọc lịch. Vui lòng thử lại.");
  }

  try {
    return getScheduleWebPayload_({});
  } finally {
    lock.releaseLock();
  }
}

function confirmScheduleWebSession_(body) {
  const sessionId = body && body.sessionId ? body.sessionId.toString().trim() : "";
  const role = body && body.role ? body.role.toString().trim().toLowerCase() : "";
  const confirmed = body && body.confirmed !== false;

  if (!sessionId) {
    throw new Error("Thiếu sessionId.");
  }

  if (["host", "support", "both"].indexOf(role) === -1) {
    throw new Error("Role confirm phải là host, support hoặc both.");
  }

  const lock = getScheduleWebLock_();
  if (!lock.tryLock(10000)) {
    throw new Error("Không lấy được lock để cập nhật confirm. Vui lòng thử lại.");
  }

  try {
    const ss = getScheduleWebSpreadsheet_();
    const sheet = ss.getSheetByName("Live_Session_Master");
    if (!sheet || sheet.getLastRow() <= 1) {
      throw new Error("Tab Live_Session_Master chưa có dữ liệu.");
    }

    const headerMap = ensureRealScheduleTrackingColumns(sheet);
    const sessionCol = getScheduleWebHeaderIndex_(headerMap, "Session_ID", LIVE_SESSION_SESSION_INDEX) + 1;
    const hostIdCol = getScheduleWebHeaderIndex_(headerMap, LIVE_SESSION_BASE_HEADERS[4], 4) + 1;
    const supportIdCol = getScheduleWebHeaderIndex_(headerMap, LIVE_SESSION_BASE_HEADERS[7], 7) + 1;
    const dateCol = getScheduleWebHeaderIndex_(headerMap, LIVE_SESSION_BASE_HEADERS[2], 2) + 1;
    const slotCol = getScheduleWebHeaderIndex_(headerMap, LIVE_SESSION_BASE_HEADERS[3], 3) + 1;
    const hostConfirmCol = getScheduleWebHeaderIndex_(headerMap, "Host_Live_Confirm", -1) + 1;
    const supportConfirmCol = getScheduleWebHeaderIndex_(headerMap, "Support_Live_Confirm", -1) + 1;

    if (sessionCol <= 0 || hostIdCol <= 0 || supportIdCol <= 0 || hostConfirmCol <= 0 || supportConfirmCol <= 0) {
      throw new Error("Thiếu cột Session_ID / Host_ID / Support_ID / cột confirm.");
    }

    const lastRow = sheet.getLastRow();
    const sessionValues = sheet.getRange(2, sessionCol, lastRow - 1, 1).getValues();
    let targetRowNumber = 0;
    let matchingSessionCount = 0;

    for (let i = 0; i < sessionValues.length; i++) {
      const currentSessionId = sessionValues[i][0] ? sessionValues[i][0].toString().trim() : "";
      if (currentSessionId === sessionId) {
        matchingSessionCount++;
        if (!targetRowNumber) targetRowNumber = i + 2;
      }
    }

    if (!targetRowNumber) {
      throw new Error("Không tìm thấy Session_ID trong Live_Session_Master.");
    }
    if (matchingSessionCount > 1) {
      throw new Error("Session_ID " + sessionId + " đang bị trùng " + matchingSessionCount + " dòng. Không cập nhật để tránh sửa nhầm ca.");
    }

    assertScheduleWebConfirmPermission_(sheet, targetRowNumber, body, role, sessionId, hostIdCol, supportIdCol, dateCol, slotCol);

    const nextValue = confirmed ? SCHEDULE_WEB_CONFIRM_VALUE : SCHEDULE_WEB_UNCONFIRM_VALUE;
    if (role === "host" || role === "both") {
      sheet.getRange(targetRowNumber, hostConfirmCol).setValue(nextValue);
    }
    if (role === "support" || role === "both") {
      sheet.getRange(targetRowNumber, supportConfirmCol).setValue(nextValue);
    }

    SpreadsheetApp.flush();
    const confirmationRevision = incrementScheduleWebConfirmationRevision_();

    return {
      success: true,
      generatedAt: new Date().toISOString(),
      confirmationRevision: confirmationRevision,
      updatedSessionId: sessionId,
      updatedRole: role,
      confirmed: confirmed
    };
  } finally {
    lock.releaseLock();
  }
}

function assertScheduleWebConfirmPermission_(sheet, rowNumber, body, requestedRole, sessionId, hostIdCol, supportIdCol, dateCol, slotCol) {
  const actorType = body && body.actorType ? body.actorType.toString().trim().toLowerCase() : "";
  if (actorType === "admin") return;
  if (actorType !== "employee") {
    throw new Error("Không xác định được tài khoản thực hiện confirm.");
  }

  const actorRole = body && body.actorRole ? body.actorRole.toString().trim().toLowerCase() : "";
  const actorEmployeeId = body && body.actorEmployeeId ? body.actorEmployeeId.toString().trim() : "";
  if (!actorEmployeeId || ["host", "support"].indexOf(actorRole) === -1) {
    throw new Error("Phiên đăng nhập thiếu mã nhân viên hoặc vai trò.");
  }

  const targetDateValue = sheet.getRange(rowNumber, dateCol).getValue();
  const targetDate = parseFlexibleDateValue(targetDateValue);
  if (!targetDate) {
    throw new Error("Ca " + sessionId + " không có ngày hợp lệ nên nhân viên không thể thay đổi xác nhận.");
  }
  const spreadsheet = sheet.getParent();
  const timezone = (spreadsheet && spreadsheet.getSpreadsheetTimeZone()) ||
    (typeof APP_TZ === "string" ? APP_TZ : "Asia/Bangkok");
  const targetDateKey = Utilities.formatDate(targetDate, timezone, "yyyy-MM-dd");
  const todayKey = Utilities.formatDate(new Date(), timezone, "yyyy-MM-dd");
  if (targetDateKey < todayKey) {
    throw new Error("Bạn không thể thay đổi xác nhận của ngày đã qua. Chỉ Admin được xử lý lịch sử.");
  }

  if (requestedRole === "both" || requestedRole !== actorRole) {
    throw new Error(
      "Bạn đang đăng nhập với vai trò " + getScheduleWebRoleLabel_(actorRole) +
      " nên không thể thay đổi xác nhận của " + getScheduleWebRoleLabel_(requestedRole) + "."
    );
  }

  const assignedIdCol = requestedRole === "host" ? hostIdCol : supportIdCol;
  const assignedEmployeeId = sheet.getRange(rowNumber, assignedIdCol).getDisplayValue().toString().trim();
  const dateLabel = sheet.getRange(rowNumber, dateCol).getDisplayValue().toString().trim();
  const slotLabel = sheet.getRange(rowNumber, slotCol).getDisplayValue().toString().trim();
  const assignmentLabel = [dateLabel, slotLabel].filter(Boolean).join(" · ");

  if (!assignedEmployeeId) {
    throw new Error("Ca " + sessionId + " chưa có " + getScheduleWebRoleLabel_(requestedRole) + " để xác nhận.");
  }
  if (assignedEmployeeId.toLowerCase() !== actorEmployeeId.toLowerCase()) {
    throw new Error(
      "Bạn không thể confirm hoặc huỷ confirm ca của người khác. Ca " + assignmentLabel +
      " đang thuộc mã " + assignedEmployeeId + ", không phải " + actorEmployeeId + "."
    );
  }
}

function getScheduleWebRoleLabel_(role) {
  if (role === "host") return "Host";
  if (role === "support") return "Support Live";
  return role || "vai trò khác";
}

function getScheduleWebLock_() {
  return LockService.getScriptLock();
}

function getScheduleWebConfirmationRevision_() {
  const value = PropertiesService.getScriptProperties().getProperty(SCHEDULE_WEB_CONFIRM_REVISION_PROPERTY);
  const revision = Number(value || 0);
  return isFinite(revision) && revision >= 0 ? Math.floor(revision) : 0;
}

function incrementScheduleWebConfirmationRevision_() {
  const nextRevision = getScheduleWebConfirmationRevision_() + 1;
  PropertiesService.getScriptProperties().setProperty(
    SCHEDULE_WEB_CONFIRM_REVISION_PROPERTY,
    String(nextRevision)
  );
  return nextRevision;
}

function readScheduleWebRows_(sheet, timezone, fromKey, toKey) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol <= 0) return [];

  const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = data[0];
  const headerMap = buildSheetHeaderMap(headers);
  const idx = getScheduleWebIndexes_(headerMap);
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const session = buildScheduleWebSession_(row, idx, i + 1, timezone);
    if (!session.sessionId && !session.hostId && !session.supportId) continue;
    if (fromKey && session.dateKey && session.dateKey < fromKey) continue;
    if (toKey && session.dateKey && session.dateKey > toKey) continue;
    rows.push(session);
  }

  rows.sort(function(left, right) {
    return [left.dateKey, left.slotSortKey, left.sessionId].join("__")
      .localeCompare([right.dateKey, right.slotSortKey, right.sessionId].join("__"));
  });

  return rows;
}

function getScheduleWebIndexes_(headerMap) {
  return {
    stt: getScheduleWebHeaderIndex_(headerMap, LIVE_SESSION_BASE_HEADERS[0], 0),
    weekday: getScheduleWebHeaderIndex_(headerMap, LIVE_SESSION_BASE_HEADERS[1], 1),
    date: getScheduleWebHeaderIndex_(headerMap, LIVE_SESSION_BASE_HEADERS[2], 2),
    slot: getScheduleWebHeaderIndex_(headerMap, LIVE_SESSION_BASE_HEADERS[3], 3),
    hostId: getScheduleWebHeaderIndex_(headerMap, LIVE_SESSION_BASE_HEADERS[4], 4),
    hostName: getScheduleWebHeaderIndex_(headerMap, LIVE_SESSION_BASE_HEADERS[5], 5),
    format: getScheduleWebHeaderIndex_(headerMap, LIVE_SESSION_BASE_HEADERS[6], 6),
    supportId: getScheduleWebHeaderIndex_(headerMap, LIVE_SESSION_BASE_HEADERS[7], 7),
    supportName: getScheduleWebHeaderIndex_(headerMap, LIVE_SESSION_BASE_HEADERS[8], 8),
    channel: getScheduleWebHeaderIndex_(headerMap, LIVE_SESSION_BASE_HEADERS[9], 9),
    scriptUrl: getScheduleWebHeaderIndex_(headerMap, LIVE_SESSION_BASE_HEADERS[10], 10),
    sessionId: getScheduleWebHeaderIndex_(headerMap, "Session_ID", LIVE_SESSION_SESSION_INDEX),
    hostConfirm: getScheduleWebHeaderIndex_(headerMap, "Host_Live_Confirm", -1),
    supportConfirm: getScheduleWebHeaderIndex_(headerMap, "Support_Live_Confirm", -1),
    backupHostId: getScheduleWebHeaderIndex_(headerMap, "Backup_Host_ID", -1),
    backupHostName: getScheduleWebHeaderIndex_(headerMap, "Backup_Host_Name", -1),
    backupSupportId: getScheduleWebHeaderIndex_(headerMap, "Backup_Support_ID", -1),
    backupSupportName: getScheduleWebHeaderIndex_(headerMap, "Backup_Support_Name", -1),
    supportCandidatePool: getScheduleWebHeaderIndex_(headerMap, LIVE_SESSION_SUPPORT_POOL_HEADER, -1)
  };
}

function getScheduleWebHeaderIndex_(headerMap, headerName, fallbackIndex) {
  return headerMap && headerMap[headerName] !== undefined ? headerMap[headerName] : fallbackIndex;
}

function buildScheduleWebSession_(row, idx, rowNumber, timezone) {
  const dateValue = getScheduleWebCell_(row, idx.date);
  const date = parseFlexibleDateValue(dateValue);
  const dateKey = date ? Utilities.formatDate(date, timezone, "yyyy-MM-dd") : "";
  const formatValue = getScheduleWebText_(row, idx.format);
  const sessionId = getScheduleWebText_(row, idx.sessionId);
  const hostId = getScheduleWebText_(row, idx.hostId);
  const supportId = getScheduleWebText_(row, idx.supportId);
  const hostConfirm = getScheduleWebText_(row, idx.hostConfirm);
  const supportConfirm = getScheduleWebText_(row, idx.supportConfirm);
  const supportRequired = isScheduleWebSupportRequired_(formatValue);
  const isSupportOnly = !isMeaningfulScheduleValue(hostId) && isMeaningfulScheduleValue(supportId);
  const missingSupport = isMeaningfulScheduleValue(hostId) && supportRequired && !isMeaningfulScheduleValue(supportId);
  const warnings = [];

  if (missingSupport) {
    warnings.push("STUDIO_MISSING_SUPPORT");
  }
  if (isSupportOnly) {
    warnings.push("SUPPORT_ONLY");
  }
  if (!dateKey) {
    warnings.push("INVALID_DATE");
  }

  return {
    rowNumber: rowNumber,
    stt: getScheduleWebText_(row, idx.stt),
    sessionId: sessionId,
    dateKey: dateKey,
    dateLabel: date ? Utilities.formatDate(date, timezone, "dd/MM/yyyy") : getScheduleWebText_(row, idx.date),
    weekday: getScheduleWebText_(row, idx.weekday),
    slot: getScheduleWebText_(row, idx.slot),
    slotSortKey: getScheduleWebSlotSortKey_(getScheduleWebCell_(row, idx.slot)),
    hostId: hostId,
    hostName: getScheduleWebText_(row, idx.hostName),
    format: formatValue,
    supportId: supportId,
    supportName: getScheduleWebText_(row, idx.supportName),
    channel: getScheduleWebText_(row, idx.channel),
    scriptUrl: getScheduleWebText_(row, idx.scriptUrl),
    hostConfirm: hostConfirm,
    supportConfirm: supportConfirm,
    backupHostId: getScheduleWebText_(row, idx.backupHostId),
    backupHostName: getScheduleWebText_(row, idx.backupHostName),
    backupSupportId: getScheduleWebText_(row, idx.backupSupportId),
    backupSupportName: getScheduleWebText_(row, idx.backupSupportName),
    supportCandidatePool: getScheduleWebText_(row, idx.supportCandidatePool),
    isHostConfirmed: isConfirmedScheduleValue(hostConfirm),
    isSupportConfirmed: isConfirmedScheduleValue(supportConfirm),
    canConfirmHost: Boolean(sessionId) && isMeaningfulScheduleValue(hostId),
    canConfirmSupport: Boolean(sessionId) && isMeaningfulScheduleValue(supportId),
    supportRequired: supportRequired,
    isSupportOnly: isSupportOnly,
    missingSupport: missingSupport,
    warningLevel: missingSupport ? "danger" : (isSupportOnly ? "info" : "ok"),
    warnings: warnings
  };
}

function getScheduleWebCell_(row, index) {
  if (index === undefined || index < 0) return "";
  return row[index];
}

function getScheduleWebText_(row, index) {
  const value = getScheduleWebCell_(row, index);
  if (value === null || value === undefined) return "";
  if (value instanceof Date && !isNaN(value.getTime())) {
    return formatAppDateValue(value);
  }
  return value.toString().trim();
}

function getScheduleWebSlotSortKey_(slotValue) {
  const slotParts = getScheduleSlotParts(slotValue);
  if (!slotParts) return "9999";
  return String(slotParts.startMinutes).padStart(4, "0");
}

function isScheduleWebSupportRequired_(formatValue) {
  const normalized = normalizeScheduleTrackingText(formatValue);
  if (!normalized || normalized === "both" || normalized === "home") return false;
  return normalized.indexOf("studio") !== -1;
}

function normalizeScheduleWebDateKey_(value) {
  const date = parseFlexibleDateValue(value);
  return date ? Utilities.formatDate(date, getAppTimeZone(), "yyyy-MM-dd") : "";
}

function buildScheduleWebSummary_(rows) {
  return (rows || []).reduce(function(summary, row) {
    summary.total++;
    if (row.isSupportOnly) summary.supportOnly++;
    if (row.missingSupport) summary.missingSupport++;
    if (row.canConfirmHost && !row.isHostConfirmed) summary.pendingHostConfirm++;
    if (row.canConfirmSupport && !row.isSupportConfirmed) summary.pendingSupportConfirm++;
    if (row.isHostConfirmed) summary.confirmedHost++;
    if (row.isSupportConfirmed) summary.confirmedSupport++;
    return summary;
  }, {
    total: 0,
    supportOnly: 0,
    missingSupport: 0,
    pendingHostConfirm: 0,
    pendingSupportConfirm: 0,
    confirmedHost: 0,
    confirmedSupport: 0
  });
}
