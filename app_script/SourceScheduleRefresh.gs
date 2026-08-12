const SOURCE_SCHEDULE_SPREADSHEET_ID =
  typeof SCHEDULE_FILE_ID === 'string' && SCHEDULE_FILE_ID
    ? SCHEDULE_FILE_ID
    : '12WU5jM-KC9EngkA_xBS3U82KYnO-8RMwGwk9fwcGe3o';

const SOURCE_SCHEDULE_SHEET_NAMES = {
  hostSchedule: 'Collect lịch live chính',
  supportSchedule: 'Collect lịch sp live',
  hostInfo: 'Thông tin Mẫu Live',
  supportInfo: 'Thông tin Support Live',
  aggregateSchedule: ['LIVE STREAM/ SCHEDULE', 'LIVE STREAM SCHEDULE']
};
const SOURCE_SCHEDULE_STAFF_ID_ALIASES = {
  HRSL01: 'HRSL01_6H',
  HRSL02: 'HRSL02_6H'
};

function refreshSourceLiveStreamSchedule_(options) {
  const config = options || {};
  const lock = config.skipLock ? null : LockService.getScriptLock();
  if (lock && !lock.tryLock(30000)) {
    throw new Error('Không lấy được lock để làm mới schedule nguồn.');
  }

  try {
    const sourceSs = SpreadsheetApp.openById(SOURCE_SCHEDULE_SPREADSHEET_ID);
    const hostSheet = sourceSs.getSheetByName(SOURCE_SCHEDULE_SHEET_NAMES.hostSchedule);
    const supportSheet = sourceSs.getSheetByName(SOURCE_SCHEDULE_SHEET_NAMES.supportSchedule);
    const hostInfoSheet = sourceSs.getSheetByName(SOURCE_SCHEDULE_SHEET_NAMES.hostInfo);
    const supportInfoSheet = sourceSs.getSheetByName(SOURCE_SCHEDULE_SHEET_NAMES.supportInfo);
    const aggregateSheet = findSourceScheduleSheetByNames_(
      sourceSs,
      SOURCE_SCHEDULE_SHEET_NAMES.aggregateSchedule
    );

    if (!hostSheet || !supportSheet || !hostInfoSheet || !supportInfoSheet || !aggregateSheet) {
      throw new Error(
        'Không tìm thấy đủ sheet cần thiết ở file nguồn: ' +
        [
          SOURCE_SCHEDULE_SHEET_NAMES.hostSchedule,
          SOURCE_SCHEDULE_SHEET_NAMES.supportSchedule,
          SOURCE_SCHEDULE_SHEET_NAMES.hostInfo,
          SOURCE_SCHEDULE_SHEET_NAMES.supportInfo
        ].concat(SOURCE_SCHEDULE_SHEET_NAMES.aggregateSchedule).join(', ')
      );
    }

    const hostInfo = loadSourceHostInfo_(hostInfoSheet);
    const supportIdSet = loadSourceSupportIdSet_(supportInfoSheet);

    const cleanedHostCells = cleanSourceScheduleGrid_(hostSheet, hostInfo.validIds);
    const cleanedSupportCells = cleanSourceScheduleGrid_(supportSheet, supportIdSet);

    const hostData = hostSheet.getDataRange().getValues();
    const supportData = supportSheet.getDataRange().getValues();
    const aggregateRows = buildSourceAggregateScheduleRows_(
      hostData,
      supportData,
      hostInfo.nameMap,
      hostInfo.formatMap,
      sourceSs.getSpreadsheetTimeZone() || getAppTimeZone()
    );

    writeSourceAggregateSchedule_(aggregateSheet, aggregateRows);
    SpreadsheetApp.flush();

    return {
      cleanedHostCells: cleanedHostCells,
      cleanedSupportCells: cleanedSupportCells,
      aggregateRows: aggregateRows.length,
      mode: 'local_direct'
    };
  } finally {
    if (lock) lock.releaseLock();
  }
}

function findSourceScheduleSheetByNames_(spreadsheet, names) {
  for (let i = 0; i < names.length; i++) {
    const sheet = spreadsheet.getSheetByName(names[i]);
    if (sheet) return sheet;
  }

  return null;
}

function loadSourceHostInfo_(sheet) {
  const data = sheet.getDataRange().getValues();
  const headers = (data[0] || []).map(normalizeSourceHeader_);
  const hostIdCol = findSourceHeaderIndex_(headers, ['mã nhân viên', 'ma nhan vien'], 1);
  const hostNameCol = findSourceHeaderIndex_(
    headers,
    ['tên gọi khác', 'ten goi khac', 'tên', 'ten', 'full_name', 'full name'],
    2
  );
  const hostFullNameCol = findSourceHeaderIndex_(
    headers,
    ['họ và tên đầy đủ', 'ho va ten day du', 'họ và tên', 'ho va ten'],
    -1
  );
  const homeCol = findSourceHeaderIndex_(headers, ['live tại nhà', 'live tai nha'], -1);
  const studioCol = findSourceHeaderIndex_(headers, ['live tại studio', 'live tai studio'], -1);
  const validIds = new Set();
  const nameMap = {};
  const formatMap = {};

  for (let i = 1; i < data.length; i++) {
    const hostId = normalizeSourceStaffCode_(data[i][hostIdCol]);
    if (!hostId) continue;

    validIds.add(hostId);
    nameMap[hostId] =
      getFirstSourceTextByColumnIndexes_(data[i], [hostNameCol, hostFullNameCol]) || hostId;

    const homeChecked = homeCol !== -1 ? isSourceCheckedValue_(data[i][homeCol]) : false;
    const studioChecked = studioCol !== -1 ? isSourceCheckedValue_(data[i][studioCol]) : false;
    if (homeChecked && studioChecked) {
      formatMap[hostId] = 'Both';
    } else if (homeChecked) {
      formatMap[hostId] = 'Home';
    } else {
      formatMap[hostId] = 'Studio';
    }
  }

  return {
    validIds: validIds,
    nameMap: nameMap,
    formatMap: formatMap
  };
}

function getFirstSourceTextByColumnIndexes_(row, columnIndexes) {
  for (let i = 0; i < columnIndexes.length; i++) {
    const columnIndex = columnIndexes[i];
    if (columnIndex === -1) continue;

    const text = getSourceText_(row[columnIndex]);
    if (text) return text;
  }

  return '';
}

function loadSourceSupportIdSet_(sheet) {
  const data = sheet.getDataRange().getValues();
  const headers = (data[0] || []).map(normalizeSourceHeader_);
  const supportIdCol = findSourceHeaderIndex_(headers, ['mã nhân viên', 'ma nhan vien'], 1);
  const result = new Set();

  for (let i = 1; i < data.length; i++) {
    const supportId = normalizeSourceStaffCode_(data[i][supportIdCol]);
    if (supportId) {
      result.add(supportId);
    }
  }

  return result;
}

function cleanSourceScheduleGrid_(sheet, validIds) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < 2 || lastCol < 3) return 0;

  const range = sheet.getRange(2, 3, lastRow - 1, lastCol - 2);
  const values = range.getValues();
  let changedCells = 0;

  for (let row = 0; row < values.length; row++) {
    for (let col = 0; col < values[row].length; col++) {
      const currentValue = values[row][col];
      const nextValue = filterSourceStaffCellValue_(currentValue, validIds);

      if (getSourceText_(currentValue) !== getSourceText_(nextValue)) {
        values[row][col] = nextValue;
        changedCells++;
      }
    }
  }

  if (changedCells > 0) {
    range.setValues(values);
  }

  return changedCells;
}

function filterSourceStaffCellValue_(value, validIds) {
  const raw = getSourceText_(value);
  if (!raw) return '';

  const codes = splitSourceStaffCodes_(raw).filter(function(code) {
    return validIds.has(code);
  });
  const uniqueCodes = [];
  const seen = {};

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (!seen[code]) {
      seen[code] = true;
      uniqueCodes.push(code);
    }
  }

  if (uniqueCodes.length > 0) {
    return uniqueCodes.join(', ');
  }

  return '';
}

function buildSourceAggregateScheduleRows_(hostData, supportData, hostNameMap, hostFormatMap, timezone) {
  const result = [];
  const hostHeaders = hostData[0] || [];
  const supportHeaders = supportData[0] || [];
  const maxRows = Math.max(hostData.length, supportData.length);
  const maxCols = Math.max(hostHeaders.length, supportHeaders.length);

  for (let row = 1; row < maxRows; row++) {
    const hostRow = hostData[row] || [];
    const supportRow = supportData[row] || [];
    const thu = getSourceText_(hostRow[0]) || getSourceText_(supportRow[0]);
    const rawDate = !isSourceBlankValue_(hostRow[1]) ? hostRow[1] : supportRow[1];
    const dateInfo = getSourceDateInfo_(rawDate, timezone);

    if (!thu || !dateInfo.display) continue;

    for (let col = 2; col < maxCols; col++) {
      const slotLabel = getSourceSlotLabel_(hostHeaders[col] || supportHeaders[col]);
      if (!slotLabel) continue;

      const hostIds = splitSourceStaffCodes_(hostRow[col]);
      const supportIds = splitSourceStaffCodes_(supportRow[col]);
      const hostIdText = hostIds.join(', ');
      const supportIdText = supportIds.join(', ');

      if (!hostIdText && !supportIdText) continue;

      const hostNames = hostIds.map(function(hostId) {
        return hostNameMap[hostId] || hostId;
      }).join(', ');
      let formatValue = 'Studio';

      if (hostIds.length > 0 && hostFormatMap[hostIds[0]]) {
        formatValue = hostFormatMap[hostIds[0]];
      }

      result.push({
        dateSort: dateInfo.sort,
        slotSort: getSourceSlotSortValue_(slotLabel),
        thu: thu,
        ngay: dateInfo.display,
        khungGio: slotLabel,
        maHost: hostIdText,
        tenHost: hostNames,
        hinhThuc: formatValue,
        maSupport: supportIdText
      });
    }
  }

  result.sort(function(left, right) {
    if (left.dateSort !== right.dateSort) return left.dateSort - right.dateSort;
    if (left.slotSort !== right.slotSort) return left.slotSort - right.slotSort;
    return left.khungGio.localeCompare(right.khungGio);
  });

  return result;
}

function writeSourceAggregateSchedule_(sheet, rows) {
  const rowCount = Math.max(Math.max(sheet.getLastRow() - 1, 1), rows.length);
  const outputRange = sheet.getRange(2, 2, rowCount, 7);
  outputRange.clearDataValidations();
  outputRange.clearContent();

  if (rows.length === 0) return;

  const output = rows.map(function(row) {
    return [
      row.thu,
      row.ngay,
      row.khungGio,
      row.maHost,
      row.tenHost,
      row.hinhThuc,
      row.maSupport
    ];
  });

  sheet.getRange(2, 2, output.length, 7).setValues(output);
}

function findSourceHeaderIndex_(headers, candidates, fallbackIndex) {
  for (let i = 0; i < candidates.length; i++) {
    const index = headers.indexOf(normalizeSourceHeader_(candidates[i]));
    if (index !== -1) return index;
  }

  return fallbackIndex;
}

function normalizeSourceHeader_(value) {
  return getSourceText_(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeSourceStaffCode_(value) {
  const normalized = getSourceText_(value).toUpperCase();
  return SOURCE_SCHEDULE_STAFF_ID_ALIASES[normalized] || normalized;
}

function splitSourceStaffCodes_(value) {
  const raw = getSourceText_(value);
  if (!raw) return [];

  return raw
    .split(/[,;\n]+/)
    .map(normalizeSourceStaffCode_)
    .filter(function(item) {
      return item && item !== 'TRỐNG' && item !== 'TRONG';
    });
}

function getSourceSlotLabel_(value) {
  return getSourceText_(value).replace(/\*\*/g, '');
}

function getSourceSlotSortValue_(slotLabel) {
  const match = slotLabel.match(/(\d{1,2}):(\d{2})/);
  if (!match) return Number.MAX_SAFE_INTEGER;

  return Number(match[1]) * 60 + Number(match[2]);
}

function getSourceDateInfo_(value, timezone) {
  const parsed = parseFlexibleDateValue(value);
  if (parsed) {
    return {
      display: Utilities.formatDate(parsed, timezone, 'dd/MM/yyyy'),
      sort: new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime()
    };
  }

  const raw = getSourceText_(value);
  if (!raw) {
    return { display: '', sort: 0 };
  }

  return { display: raw, sort: Number.MAX_SAFE_INTEGER };
}

function getSourceText_(value) {
  if (value === null || value === undefined) return '';
  return value.toString().trim();
}

function isSourceBlankValue_(value) {
  return getSourceText_(value) === '';
}

function isSourceCheckedValue_(value) {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'boolean') return value;

  const text = value.toString().trim().toLowerCase();
  return text === 'true' || text === 'x' || text === 'có' || text === '1' || text === 'v';
}
