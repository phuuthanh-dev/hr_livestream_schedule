import { createHash } from "node:crypto";
import { readSheet, type Row } from "read-excel-file/node";
import { formatScheduleDateKey } from "./scheduleDate.ts";

export type TikTokReportFragment = {
  fragmentKey: string;
  title: string;
  tiktokLiveId: string;
  accountId: string;
  startAt: Date;
  endAt: Date;
  dateKey: string;
  grossGmv: number;
  returnedGmv: number;
  grossOrders: number;
  rowNumber: number;
};

export type ParsedTikTokReport = {
  rows: TikTokReportFragment[];
  invalidRows: number;
  sourceRows: number;
};

type Cell = Row[number];

type ReportDateRange = {
  from: string;
  to: string;
};

function cleanText(value: Cell) {
  return value == null ? "" : String(value).trim().replace(/^\uFEFF/, "");
}

function normalizeHeader(value: Cell) {
  return cleanText(value)
    .toLocaleLowerCase("vi")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseVnd(value: Cell) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const digits = cleanText(value).replace(/[^0-9-]/g, "");
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function parseCount(value: Cell) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const parsed = Number(cleanText(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function parseBangkokDate(value: Cell) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return null;
}

function parseDateKeyFromCompact(value: string) {
  if (!/^\d{8}$/.test(value)) return "";
  const year = value.slice(0, 4);
  const month = value.slice(4, 6);
  const day = value.slice(6, 8);
  return `${year}-${month}-${day}`;
}

function parseReportDateRange(fileName: string): ReportDateRange | null {
  const match = fileName.match(/(\d{8})-(\d{8})/);
  if (!match) return null;
  const from = parseDateKeyFromCompact(match[1]);
  const to = parseDateKeyFromCompact(match[2]);
  if (!from || !to) return null;
  return { from, to };
}

function buildUtcDate(year: number, month: number, day: number, hour: number, minute: number, second: number) {
  const date = new Date(Date.UTC(year, month - 1, day, hour - 7, minute, second));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateWithinRange(date: Date, range: ReportDateRange) {
  const dateKey = formatScheduleDateKey(date, "Asia/Bangkok");
  return dateKey >= range.from && dateKey <= range.to;
}

function parseBangkokDateText(text: string, range?: ReportDateRange | null) {
  const match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;
  const [, first, second, year, hour = "0", minute = "0", secondValue = "0"] = match;
  const firstNumber = Number(first);
  const secondNumber = Number(second);
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  const secondNumberValue = Number(secondValue);
  const ddMm = buildUtcDate(Number(year), secondNumber, firstNumber, hourNumber, minuteNumber, secondNumberValue);
  const mmDd = buildUtcDate(Number(year), firstNumber, secondNumber, hourNumber, minuteNumber, secondNumberValue);

  if (range) {
    const ddMmMatches = ddMm ? dateWithinRange(ddMm, range) : false;
    const mmDdMatches = mmDd ? dateWithinRange(mmDd, range) : false;
    if (ddMmMatches && !mmDdMatches) return ddMm;
    if (mmDdMatches && !ddMmMatches) return mmDd;
  }

  if (firstNumber > 12 && ddMm) return ddMm;
  if (secondNumber > 12 && mmDd) return mmDd;
  return ddMm || mmDd;
}

function findColumn(headers: string[], candidates: string[]) {
  return headers.findIndex((header) => candidates.some((candidate) => header === candidate || header.includes(candidate)));
}

function parseCsv(text: string): Row[] {
  const rows: Row[] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

async function readRows(buffer: Buffer, fileName: string): Promise<Row[]> {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "csv") return parseCsv(buffer.toString("utf8"));
  if (extension === "xlsx") return readSheet(buffer);
  throw new Error("Chỉ hỗ trợ file .xlsx hoặc .csv. Với file .xls, hãy lưu lại thành .xlsx trước khi tải lên.");
}

export async function parseTikTokReport(buffer: Buffer, fileName: string): Promise<ParsedTikTokReport> {
  const rows = await readRows(buffer, fileName);
  const reportDateRange = parseReportDateRange(fileName);
  const headerIndex = rows.slice(0, 10).findIndex((row) => {
    const headers = row.map(normalizeHeader);
    return headers.some((header) => header.includes("id buoi live"))
      && headers.some((header) => header.includes("thoi gian bat dau live"));
  });
  if (headerIndex < 0) {
    throw new Error("Không nhận diện được hàng tiêu đề TikTok Shop trong file báo cáo.");
  }

  const headers = rows[headerIndex].map(normalizeHeader);
  const columns = {
    title: findColumn(headers, ["tieu de buoi live", "live title"]),
    liveId: findColumn(headers, ["id buoi live", "live id"]),
    start: findColumn(headers, ["thoi gian bat dau live", "live start time", "start time"]),
    end: findColumn(headers, ["thoi gian ket thuc live", "live end time", "end time"]),
    account: findColumn(headers, ["ten nha sang tao", "creator name", "account id"]),
    grossGmv: findColumn(headers, ["gmv nho buoi live cua nha sang tao", "gross gmv", "gmv"]),
    returnedGmv: findColumn(headers, ["hoan tien", "returned gmv", "refund"]),
    orders: findColumn(headers, ["don hang nho buoi live", "gross orders", "orders"])
  };
  if ([columns.liveId, columns.start, columns.end, columns.account, columns.grossGmv].some((index) => index < 0)) {
    throw new Error("File thiếu một trong các cột bắt buộc: Live ID, thời gian, creator hoặc GMV.");
  }

  const fragments: TikTokReportFragment[] = [];
  let invalidRows = 0;
  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const rowNumber = headerIndex + offset + 2;
    const liveId = cleanText(row[columns.liveId]);
    const accountId = cleanText(row[columns.account]);
    const startAt = parseBangkokDate(row[columns.start]) || parseBangkokDateText(cleanText(row[columns.start]), reportDateRange);
    const endAt = parseBangkokDate(row[columns.end]) || parseBangkokDateText(cleanText(row[columns.end]), reportDateRange);
    if (!liveId || !accountId || !startAt || !endAt || endAt <= startAt) {
      if (row.some((value) => cleanText(value))) invalidRows += 1;
      return;
    }
    const signature = [liveId, accountId.toLowerCase(), startAt.toISOString(), endAt.toISOString()].join("|");
    fragments.push({
      fragmentKey: createHash("sha256").update(signature).digest("hex"),
      title: columns.title >= 0 ? cleanText(row[columns.title]) : "",
      tiktokLiveId: liveId,
      accountId,
      startAt,
      endAt,
      dateKey: formatScheduleDateKey(startAt, "Asia/Bangkok"),
      grossGmv: parseVnd(row[columns.grossGmv]),
      returnedGmv: columns.returnedGmv >= 0 ? parseVnd(row[columns.returnedGmv]) : 0,
      grossOrders: columns.orders >= 0 ? parseCount(row[columns.orders]) : 0,
      rowNumber
    });
  });

  if (fragments.length === 0) throw new Error("File không có dòng báo cáo TikTok hợp lệ.");
  return { rows: fragments, invalidRows, sourceRows: Math.max(0, rows.length - headerIndex - 1) };
}
