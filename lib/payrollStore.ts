import { createHash, randomUUID } from "node:crypto";
import type { Collection } from "mongodb";
import { getSchedulePeopleFromMongo } from "@/lib/employeeRoster";
import { calculatePayroll } from "@/lib/payrollEngine";
import { parseTikTokReport, type TikTokReportFragment } from "@/lib/payrollImport";
import { addDaysToScheduleDateKey, getScheduleWeekStartKey, isValidScheduleDateKey } from "@/lib/scheduleDate";
import { getMongoDatabase } from "@/lib/mongodb";
import { getScheduleFromMongo } from "@/lib/scheduleStore";
import type {
  PayrollDashboardPayload,
  PayrollEntry,
  PayrollException,
  PayrollImportRecord,
  PayrollPersonHours,
  PayrollRateCard,
  PayrollSettings,
  PayrollSheetExportRecord
} from "@/lib/types";

type TikTokReportDocument = TikTokReportFragment & {
  firstImportedAt: Date;
  lastImportedAt: Date;
  lastImportBatchId: string;
  sourceFileName: string;
  importedBy: string;
};

type PayrollImportDocument = {
  batchId: string;
  checksum: string;
  fileName: string;
  importedAt: Date;
  importedBy: string;
  totalRows: number;
  inserted: number;
  duplicates: number;
  invalidRows: number;
  dateFrom?: string;
  dateTo?: string;
};

type PayrollRateDocument = PayrollRateCard & {
  updatedAt: Date;
  updatedBy: string;
};

type PayrollSettingsDocument = PayrollSettings & {
  settingsKey: "default";
  updatedAt: Date;
  updatedBy: string;
};

type PayrollPeriodDocument = {
  weekStartKey: string;
  weekEndKey: string;
  status: "draft" | "locked";
  generationId: string;
  generatedAt: Date;
  generatedBy: string;
  lockedAt?: Date;
  lockedBy?: string;
};

type PayrollEntryDocument = PayrollEntry & { generationId: string };
type PayrollExceptionDocument = PayrollException & { weekStartKey: string; generationId: string };

const DEFAULT_RATES: PayrollRateCard[] = [
  { id: "host:trial", role: "host", grade: "Thử việc", hourlyRate: 70_000, commissionMode: "fixed", commissionRate: 0.05, sortOrder: 10, active: true, note: "Cố định" },
  { id: "host:c", role: "host", grade: "C", hourlyRate: 100_000, commissionMode: "fixed", commissionRate: 0.07, sortOrder: 20, active: true, note: "Cố định" },
  { id: "host:b", role: "host", grade: "B", hourlyRate: 120_000, commissionMode: "fixed", commissionRate: 0.12, sortOrder: 30, active: true, note: "Cố định" },
  { id: "host:a", role: "host", grade: "A", hourlyRate: 200_000, commissionMode: "gmv_tier", commissionRate: 0.18, sortOrder: 40, active: true, note: "Mặc định 18% + theo bậc GMV" },
  { id: "host:s", role: "host", grade: "S", hourlyRate: 500_000, commissionMode: "gmv_tier", commissionRate: 0.2, sortOrder: 50, active: true, note: "Mặc định 20% + theo bậc GMV" },
  { id: "support:1", role: "support", grade: "Cấp 1", hourlyRate: 30_000, commissionMode: "none", commissionRate: 0, sortOrder: 110, active: true },
  { id: "support:2", role: "support", grade: "Cấp 2", hourlyRate: 50_000, commissionMode: "none", commissionRate: 0, sortOrder: 120, active: true },
  { id: "support:3", role: "support", grade: "Cấp 3", hourlyRate: 70_000, commissionMode: "none", commissionRate: 0, sortOrder: 130, active: true },
  { id: "support:4", role: "support", grade: "Cấp 4", hourlyRate: 120_000, commissionMode: "none", commissionRate: 0, sortOrder: 140, active: true }
];

const DEFAULT_SETTINGS: PayrollSettings = {
  taxRate: 0.1,
  joinGapMinutes: 10,
  hostGmvTiers: [
    { minimumGmv: 5_000_000, commissionRate: 0.05 },
    { minimumGmv: 10_000_000, commissionRate: 0.07 },
    { minimumGmv: 20_000_000, commissionRate: 0.12 },
    { minimumGmv: 35_000_000, commissionRate: 0.18 },
    { minimumGmv: 50_000_000, commissionRate: 0.2 }
  ]
};

let payrollIndexesPromise: Promise<unknown> | null = null;

async function getCollections() {
  const database = await getMongoDatabase();
  const collections = {
    reports: database.collection<TikTokReportDocument>("tiktok_live_reports"),
    imports: database.collection<PayrollImportDocument>("tiktok_report_imports"),
    rates: database.collection<PayrollRateDocument>("payroll_rate_cards"),
    settings: database.collection<PayrollSettingsDocument>("payroll_settings"),
    periods: database.collection<PayrollPeriodDocument>("payroll_periods"),
    entries: database.collection<PayrollEntryDocument>("payroll_entries"),
    exceptions: database.collection<PayrollExceptionDocument>("payroll_exceptions")
  };
  if (!payrollIndexesPromise) {
    payrollIndexesPromise = Promise.all([
      collections.reports.createIndex({ fragmentKey: 1 }, { unique: true }),
      collections.reports.createIndex({ dateKey: 1, accountId: 1, startAt: 1 }),
      collections.imports.createIndex({ batchId: 1 }, { unique: true }),
      collections.imports.createIndex({ checksum: 1 }, { unique: true }),
      collections.rates.createIndex({ id: 1 }, { unique: true }),
      collections.settings.createIndex({ settingsKey: 1 }, { unique: true }),
      collections.periods.createIndex({ weekStartKey: 1 }, { unique: true }),
      collections.entries.createIndex({ entryKey: 1 }, { unique: true }),
      collections.entries.createIndex({ weekStartKey: 1, dateKey: 1, role: 1 }),
      collections.exceptions.createIndex({ exceptionKey: 1 }, { unique: true }),
      collections.exceptions.createIndex({ weekStartKey: 1, type: 1 })
    ]).catch((error) => {
      payrollIndexesPromise = null;
      throw error;
    });
  }
  await payrollIndexesPromise;
  return collections;
}

function assertWeekStart(weekStartKey: string) {
  if (!isValidScheduleDateKey(weekStartKey) || getScheduleWeekStartKey(weekStartKey) !== weekStartKey) {
    throw new Error("Tuần lương phải bắt đầu từ Thứ Hai.");
  }
}

function toImportRecord(document: PayrollImportDocument): PayrollImportRecord {
  return {
    batchId: document.batchId,
    fileName: document.fileName,
    importedAt: document.importedAt.toISOString(),
    importedBy: document.importedBy,
    totalRows: document.totalRows,
    inserted: document.inserted,
    duplicates: document.duplicates,
    invalidRows: document.invalidRows,
    dateFrom: document.dateFrom,
    dateTo: document.dateTo
  };
}

async function ensurePayrollConfiguration(actor = "system") {
  const { rates, settings } = await getCollections();
  const now = new Date();
  await Promise.all([
    rates.bulkWrite(DEFAULT_RATES.map((rate) => ({
      updateOne: {
        filter: { id: rate.id },
        update: { $setOnInsert: { ...rate, updatedAt: now, updatedBy: actor } },
        upsert: true
      }
    }))),
    settings.updateOne(
      { settingsKey: "default" },
      { $setOnInsert: { settingsKey: "default", ...DEFAULT_SETTINGS, updatedAt: now, updatedBy: actor } },
      { upsert: true }
    )
  ]);
}

export async function getPayrollConfiguration() {
  await ensurePayrollConfiguration();
  const { rates, settings } = await getCollections();
  const [rateRows, setting] = await Promise.all([
    rates.find({}).sort({ sortOrder: 1 }).toArray(),
    settings.findOne({ settingsKey: "default" })
  ]);
  return {
    rates: rateRows.map(({ updatedAt: _updatedAt, updatedBy: _updatedBy, ...rate }) => rate),
    settings: setting ? {
      taxRate: setting.taxRate,
      joinGapMinutes: setting.joinGapMinutes,
      hostGmvTiers: setting.hostGmvTiers
    } : DEFAULT_SETTINGS
  };
}

export async function importTikTokPayrollReport(
  buffer: Buffer,
  fileName: string,
  actorAccountKey: string
): Promise<PayrollImportRecord & { alreadyImported?: boolean }> {
  if (buffer.length === 0) throw new Error("File tải lên đang trống.");
  if (buffer.length > 10 * 1024 * 1024) throw new Error("File vượt quá giới hạn 10 MB.");
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const parsed = await parseTikTokReport(buffer, fileName);
  const parsedDateKeys = parsed.rows.map((row) => row.dateKey).sort();
  const parsedDateFrom = parsedDateKeys[0];
  const parsedDateTo = parsedDateKeys[parsedDateKeys.length - 1];
  const collections = await getCollections();
  const previous = await collections.imports.findOne({ checksum });
  if (previous) {
    const linkedRows = await collections.reports.countDocuments({
      $or: [
        { lastImportBatchId: previous.batchId },
        { sourceFileName: previous.fileName }
      ]
    });
    const matchesParsedSnapshot = previous.totalRows === parsed.rows.length
      && previous.invalidRows === parsed.invalidRows
      && previous.dateFrom === parsedDateFrom
      && previous.dateTo === parsedDateTo;
    if (linkedRows > 0 && matchesParsedSnapshot) {
      return { ...toImportRecord(previous), alreadyImported: true };
    }

    await Promise.all([
      collections.reports.deleteMany({
        $or: [
          { lastImportBatchId: previous.batchId },
          { sourceFileName: previous.fileName }
        ]
      }),
      collections.imports.deleteOne({ batchId: previous.batchId })
    ]);
  }

  const batchId = randomUUID();
  const importedAt = new Date();
  const result = await collections.reports.bulkWrite(parsed.rows.map((row) => ({
    updateOne: {
      filter: { fragmentKey: row.fragmentKey },
      update: {
        $set: {
          ...row,
          lastImportedAt: importedAt,
          lastImportBatchId: batchId,
          sourceFileName: fileName,
          importedBy: actorAccountKey
        },
        $setOnInsert: { firstImportedAt: importedAt }
      },
      upsert: true
    }
  })), { ordered: false });
  const dateKeys = parsed.rows.map((row) => row.dateKey).sort();
  const document: PayrollImportDocument = {
    batchId,
    checksum,
    fileName,
    importedAt,
    importedBy: actorAccountKey,
    totalRows: parsed.rows.length,
    inserted: result.upsertedCount,
    duplicates: parsed.rows.length - result.upsertedCount,
    invalidRows: parsed.invalidRows,
    dateFrom: dateKeys[0],
    dateTo: dateKeys[dateKeys.length - 1]
  };
  await collections.imports.insertOne(document);
  return toImportRecord(document);
}

export async function generatePayrollWeek(weekStartKey: string, actorAccountKey: string) {
  assertWeekStart(weekStartKey);
  const weekEndKey = addDaysToScheduleDateKey(weekStartKey, 6);
  const collections = await getCollections();
  const existingPeriod = await collections.periods.findOne({ weekStartKey });
  if (existingPeriod?.status === "locked") throw new Error("Tuần lương đã khóa, không thể tính lại.");

  const [{ rates, settings }, schedule, roster, reportDocuments] = await Promise.all([
    getPayrollConfiguration(),
    getScheduleFromMongo({ from: weekStartKey, to: weekEndKey }),
    getSchedulePeopleFromMongo(),
    collections.reports.find({ dateKey: { $gte: weekStartKey, $lte: weekEndKey } }).sort({ startAt: 1 }).toArray()
  ]);
  const generatedAt = new Date();
  const generationId = randomUUID();
  const calculation = calculatePayroll({
    weekStartKey,
    weekEndKey,
    sessions: schedule.rows || [],
    people: [...(roster.hosts || []), ...(roster.supports || [])],
    fragments: reportDocuments,
    rates,
    settings,
    generatedAt
  });

  if (calculation.entries.length > 0) {
    await collections.entries.bulkWrite(calculation.entries.map((entry) => ({
      updateOne: {
        filter: { entryKey: entry.entryKey },
        update: { $set: { ...entry, generationId } },
        upsert: true
      }
    })), { ordered: false });
  }
  if (calculation.exceptions.length > 0) {
    await collections.exceptions.bulkWrite(calculation.exceptions.map((exception) => ({
      updateOne: {
        filter: { exceptionKey: exception.exceptionKey },
        update: { $set: { ...exception, weekStartKey, generationId } },
        upsert: true
      }
    })), { ordered: false });
  }
  await Promise.all([
    collections.entries.deleteMany({ weekStartKey, generationId: { $ne: generationId } }),
    collections.exceptions.deleteMany({ weekStartKey, generationId: { $ne: generationId } }),
    collections.periods.updateOne(
      { weekStartKey },
      { $set: { weekEndKey, status: "draft", generationId, generatedAt, generatedBy: actorAccountKey }, $unset: { lockedAt: "", lockedBy: "" } },
      { upsert: true }
    )
  ]);
  return getPayrollDashboard(weekStartKey);
}

export async function getPayrollDashboard(weekStartKey: string): Promise<PayrollDashboardPayload> {
  assertWeekStart(weekStartKey);
  const weekEndKey = addDaysToScheduleDateKey(weekStartKey, 6);
  const collections = await getCollections();
  const database = await getMongoDatabase();
  const [{ rates, settings }, period, entryDocuments, exceptionDocuments, importDocuments, lastExport] = await Promise.all([
    getPayrollConfiguration(),
    collections.periods.findOne({ weekStartKey }),
    collections.entries.find({ weekStartKey }).sort({ dateKey: 1, employeeName: 1 }).toArray(),
    collections.exceptions.find({ weekStartKey }).sort({ dateKey: 1, type: 1 }).toArray(),
    collections.imports.find({
      $or: [
        { dateFrom: { $gte: weekStartKey, $lte: weekEndKey } },
        { dateTo: { $gte: weekStartKey, $lte: weekEndKey } },
        { dateFrom: { $lte: weekStartKey }, dateTo: { $gte: weekEndKey } }
      ]
    }).sort({ importedAt: -1 }).limit(10).toArray(),
    database.collection<PayrollSheetExportRecord & { _id?: unknown }>("payroll_sheet_exports")
      .findOne({ weekStartKey, dryRun: false }, { sort: { exportedAt: -1 } })
      .catch(() => null)
  ]);
  const entries = entryDocuments.map(({ generationId: _generationId, ...entry }) => entry);
  const exceptions = exceptionDocuments.map(({ weekStartKey: _weekStart, generationId: _generationId, ...exception }) => exception);
  const summary = entries.reduce((totals, entry) => ({
    employeeCount: 0,
    entryCount: totals.entryCount + 1,
    scheduledHours: totals.scheduledHours + entry.scheduledHours,
    grossGmv: totals.grossGmv,
    basePay: totals.basePay + entry.basePay,
    commissionPay: totals.commissionPay + entry.commissionPay,
    taxAmount: totals.taxAmount + entry.taxAmount,
    netPay: totals.netPay + entry.netPay,
    exceptionCount: exceptionDocuments.length
  }), {
    employeeCount: 0,
    entryCount: 0,
    scheduledHours: 0,
    grossGmv: 0,
    basePay: 0,
    commissionPay: 0,
    taxAmount: 0,
    netPay: 0,
    exceptionCount: exceptionDocuments.length
  });
  summary.employeeCount = new Set(entries.map((entry) => `${entry.role}:${entry.employeeId.toLowerCase()}`)).size;
  summary.grossGmv = Array.from(new Map(entries.map((entry) => [
    `${entry.dateKey}|${entry.accountId.toLowerCase()}|${entry.tiktokLiveIds.slice().sort().join(",")}`,
    entry.grossGmv
  ])).values()).reduce((total, grossGmv) => total + grossGmv, 0);

  const personHoursMap = new Map<string, PayrollPersonHours>();
  entries.forEach((entry) => {
    const key = `${entry.role}:${entry.employeeId.toLowerCase()}`;
    const current = personHoursMap.get(key) || {
      employeeId: entry.employeeId,
      employeeName: entry.employeeName,
      role: entry.role,
      grade: entry.grade,
      sessionCount: 0,
      scheduledHours: 0,
      netPay: 0
    };
    current.sessionCount += entry.sessionIds.length;
    current.scheduledHours += entry.scheduledHours;
    current.netPay += entry.netPay;
    if (!current.grade && entry.grade) current.grade = entry.grade;
    personHoursMap.set(key, current);
  });
  const personHours = Array.from(personHoursMap.values()).sort((left, right) =>
    right.scheduledHours - left.scheduledHours || left.employeeName.localeCompare(right.employeeName, "vi")
  );

  return {
    success: true,
    weekStartKey,
    weekEndKey,
    periodStatus: period?.status || "draft",
    generatedAt: period?.generatedAt?.toISOString(),
    summary,
    entries,
    personHours,
    exceptions,
    rates,
    settings,
    imports: importDocuments.map(toImportRecord),
    sheetExport: lastExport ? (({ _id: _ignored, ...record }) => record)(lastExport) : null,
    message: period ? undefined : "Tuần này chưa được tính lương."
  };
}

export async function updatePayrollConfiguration(
  input: { rates: PayrollRateCard[]; settings: PayrollSettings },
  actorAccountKey: string
) {
  if (!Array.isArray(input.rates) || input.rates.length === 0) throw new Error("Bảng giá không được để trống.");
  if (!input.settings || input.settings.taxRate < 0 || input.settings.taxRate > 1) throw new Error("Thuế suất không hợp lệ.");
  if (!Number.isInteger(input.settings.joinGapMinutes) || input.settings.joinGapMinutes < 0 || input.settings.joinGapMinutes > 60) {
    throw new Error("Khoảng nối phiên phải từ 0 đến 60 phút.");
  }
  input.rates.forEach((rate) => {
    if (!rate.id || !["host", "support"].includes(rate.role) || !rate.grade.trim()) throw new Error("Bảng giá có dòng thiếu thông tin.");
    if (!Number.isFinite(rate.hourlyRate) || rate.hourlyRate < 0) throw new Error(`Lương giờ của ${rate.grade} không hợp lệ.`);
    if (!Number.isFinite(rate.commissionRate) || rate.commissionRate < 0 || rate.commissionRate > 1) throw new Error(`Hoa hồng của ${rate.grade} không hợp lệ.`);
  });
  input.settings.hostGmvTiers.forEach((tier) => {
    if (!Number.isFinite(tier.minimumGmv) || tier.minimumGmv < 0 || !Number.isFinite(tier.commissionRate) || tier.commissionRate < 0 || tier.commissionRate > 1) {
      throw new Error("Bậc GMV không hợp lệ.");
    }
  });
  const { rates, settings } = await getCollections();
  const now = new Date();
  await Promise.all([
    rates.bulkWrite(input.rates.map((rate) => ({
      updateOne: {
        filter: { id: rate.id },
        update: { $set: { ...rate, hourlyRate: Math.round(rate.hourlyRate), updatedAt: now, updatedBy: actorAccountKey } },
        upsert: true
      }
    }))),
    settings.updateOne(
      { settingsKey: "default" },
      { $set: { ...input.settings, settingsKey: "default", updatedAt: now, updatedBy: actorAccountKey } },
      { upsert: true }
    )
  ]);
  return getPayrollConfiguration();
}

export async function lockPayrollWeek(weekStartKey: string, actorAccountKey: string) {
  assertWeekStart(weekStartKey);
  const { periods } = await getCollections();
  const result = await periods.updateOne(
    { weekStartKey },
    { $set: { status: "locked", lockedAt: new Date(), lockedBy: actorAccountKey } }
  );
  if (result.matchedCount === 0) throw new Error("Hãy tính lương tuần trước khi khóa.");
  return getPayrollDashboard(weekStartKey);
}
