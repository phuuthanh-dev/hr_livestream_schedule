import { randomUUID } from "node:crypto";
import {
  createGoogleSheetsClient,
  getGoogleHrMasterSpreadsheetId,
  getGoogleSheetsSpreadsheetId
} from "@/lib/googleSheets";
import { resolveEmployeeCompensation } from "@/lib/employeeCompensation";
import {
  employeeContractPersonKey,
  listEmployeeContractProfiles,
  upsertEmployeeContractProfileFields
} from "@/lib/employeeContract";
import {
  createSchedulePerson,
  deactivateSchedulePeopleMissingFromSheet,
  findSchedulePerson,
  type SchedulePersonMutation,
  updateSchedulePerson
} from "@/lib/employeeRoster";
import { getMongoDatabase } from "@/lib/mongodb";
import { listRecruitmentProfiles, upsertRecruitmentProfile } from "@/lib/recruitmentProfile";
import type {
  EmployeeRole,
  RecruitmentSheetSyncConflict,
  RecruitmentSheetSyncConflictKind,
  RecruitmentSheetSyncDirection,
  RecruitmentSheetSyncLogsPayload,
  RecruitmentSheetSyncRun
} from "@/lib/types";

const HOST_TAB_NAME = "Thông tin Mẫu Live";
const SUPPORT_TAB_NAME = "Thông tin Support Live";
const PORTFOLIO_MASTER_TAB_NAME = "Portfolio_Master";
const SUPPORT_MASTER_TAB_NAME = "Support_Master";
const SYNC_RUNS_COLLECTION = "recruitment_sheet_sync_runs";
const SYNC_CONFLICTS_COLLECTION = "recruitment_sheet_sync_conflicts";
const SYNC_LOCKS_COLLECTION = "recruitment_sheet_sync_locks";
const RECRUITMENT_SYNC_LOCK_KEY = "recruitment_sheet_sync";

type ImportSummary = {
  success: boolean;
  spreadsheetId: string;
  dryRun?: boolean;
  processedRows: number;
  updatedProfiles: number;
  updatedEmployees: number;
  createdEmployees: number;
  deactivatedEmployees: number;
  updatedContracts: number;
  skippedRows: number;
  message: string;
};

export type RecruitmentSheetPushSummary = {
  success: boolean;
  spreadsheetId: string;
  updatedSheetRows: number;
  appendedSheetRows: number;
  updatedMasterRows?: number;
  appendedMasterRows?: number;
  skippedRows: number;
  message: string;
};

type RecruitmentSheetPushTarget = {
  role: EmployeeRole;
  employeeId: string;
};

type SheetReadResult = {
  spreadsheetId: string;
  values: string[][];
};

type SheetRowMatch = {
  rowNumber: number;
  values: string[];
};

type SheetRowLookup = {
  rows: Map<string, SheetRowMatch>;
  duplicates: Map<string, SheetRowMatch[]>;
};

type SheetCellMapping = {
  aliases: string[];
  value: string;
};

const SUPPORT_CASH_OFFER_ROUND_TWO_ALIASES = [
  "cash offer (reality) lần ii",
  "cash offer (reality) lần 2",
  "cash offer (reality) lần ll"
];

const SUPPORT_DEAL_STATUS_ROUND_TWO_ALIASES = [
  "deal cast lần ii",
  "deal cast lần 2",
  "deal cast lần ll"
];

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function normalizeHeader(value: unknown) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
}

function parseBooleanCell(value: unknown) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "có";
}

function formatBooleanCell(value: boolean) {
  return value ? "Có" : "";
}

function buildHostWorkLocation(input: {
  canLiveHome: boolean;
  canLiveStudio: boolean;
  fallback?: string;
}) {
  if (input.canLiveHome && input.canLiveStudio) return "both";
  if (input.canLiveStudio) return "studio";
  if (input.canLiveHome) return "home";
  return normalizeText(input.fallback);
}

function buildLiveAccountType(input: {
  canUsePersonalAccount: boolean;
  canUseCompanyAccount: boolean;
  fallback?: string;
}) {
  if (input.canUsePersonalAccount && input.canUseCompanyAccount) return "Cá nhân + Công ty";
  if (input.canUseCompanyAccount) return "Công ty";
  if (input.canUsePersonalAccount) return "Cá nhân";
  return normalizeText(input.fallback);
}

function getColumn(row: string[], indexMap: Map<string, number>, ...names: string[]) {
  for (const name of names) {
    const index = indexMap.get(name);
    if (index !== undefined) return normalizeText(row[index]);
  }
  return "";
}

function getColumnAlias(row: string[], indexMap: Map<string, number>, aliases: string[]) {
  return getColumn(row, indexMap, ...aliases);
}

function firstExistingIndex(indexMap: Map<string, number>, aliases: string[]) {
  for (const alias of aliases) {
    const index = indexMap.get(alias);
    if (index !== undefined) return index;
  }
  return -1;
}

function setCellAlias(row: string[], indexMap: Map<string, number>, aliases: string[], value: string) {
  for (const alias of aliases) {
    const index = indexMap.get(alias);
    if (index === undefined) continue;
    while (row.length <= index) row.push("");
    row[index] = value;
    return;
  }
}

function getContractSheetFields(row: string[], indexMap: Map<string, number>) {
  return {
    gmail: getColumnAlias(row, indexMap, ["gmail", "email"]),
    dateOfBirth: getColumnAlias(row, indexMap, ["ngày sinh", "ngay sinh", "date of birth", "dob"]),
    citizenId: getColumnAlias(row, indexMap, ["cccd", "số cccd", "so cccd", "căn cước công dân", "can cuoc cong dan"]),
    citizenIdIssuedDate: getColumnAlias(row, indexMap, ["ngày cấp", "ngay cap", "cccd ngày cấp", "cccd ngay cap"]),
    citizenIdIssuedPlace: getColumnAlias(row, indexMap, ["nơi cấp", "noi cap", "cccd nơi cấp", "cccd noi cap"]),
    permanentAddress: getColumnAlias(row, indexMap, ["địa chỉ thường trú", "dia chi thuong tru", "thường trú", "thuong tru"]),
    temporaryAddress: getColumnAlias(row, indexMap, ["địa chỉ tạm trú", "dia chi tam tru", "tạm trú", "tam tru"]),
    bankAccountNumber: getColumnAlias(row, indexMap, ["stk", "số tài khoản", "so tai khoan"]),
    bankName: getColumnAlias(row, indexMap, ["bank", "ngân hàng", "ngan hang"])
  };
}

function hasAnyContractField(input: ReturnType<typeof getContractSheetFields>) {
  return Boolean(
    input.gmail
    || input.dateOfBirth
    || input.citizenId
    || input.citizenIdIssuedDate
    || input.citizenIdIssuedPlace
    || input.permanentAddress
    || input.temporaryAddress
    || input.bankAccountNumber
    || input.bankName
  );
}

function buildIndexMap(header: string[]) {
  return new Map(header.map((cell, index) => [normalizeHeader(cell), index] as const));
}

function assertRecruitmentImportSheet(input: {
  role: EmployeeRole;
  tabName: string;
  values: string[][];
}) {
  const header = input.values[0] || [];
  const indexMap = buildIndexMap(header);
  if (header.length === 0) {
    throw new Error(`Tab ${input.tabName} đang trống header. Dừng sync để tránh khóa nhầm toàn bộ nhân sự.`);
  }

  if (!indexMap.has("mã nhân viên")) {
    throw new Error(`Tab ${input.tabName} thiếu cột Mã nhân viên. Dừng sync để tránh khóa nhầm toàn bộ nhân sự.`);
  }

  const hasNameColumn = input.role === "host"
    ? indexMap.has("họ và tên đầy đủ") || indexMap.has("tên gọi khác")
    : indexMap.has("tên");
  if (!hasNameColumn) {
    throw new Error(`Tab ${input.tabName} thiếu cột tên nhân sự hợp lệ. Dừng sync để tránh khóa nhầm toàn bộ nhân sự.`);
  }
}

async function readSheet(tabName: string): Promise<SheetReadResult> {
  const sheets = createGoogleSheetsClient();
  const spreadsheetId = getGoogleSheetsSpreadsheetId();
  return readSheetFromSpreadsheet(spreadsheetId, tabName);
}

async function readSheetFromSpreadsheet(spreadsheetId: string, tabName: string): Promise<SheetReadResult> {
  const sheets = createGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A:AZ`
  });
  return {
    spreadsheetId,
    values: response.data.values || []
  };
}

function buildConflict(
  runId: string,
  direction: RecruitmentSheetSyncDirection,
  kind: RecruitmentSheetSyncConflictKind,
  details: string,
  input: Partial<Omit<RecruitmentSheetSyncConflict, "runId" | "direction" | "kind" | "details" | "createdAt">> = {}
): RecruitmentSheetSyncConflict {
  return {
    runId,
    direction,
    kind,
    details,
    createdAt: new Date().toISOString(),
    ...input
  };
}

async function ensureSyncIndexes() {
  const database = await getMongoDatabase();
  await Promise.all([
    database.collection(SYNC_RUNS_COLLECTION).createIndex({ finishedAt: -1 }),
    database.collection(SYNC_RUNS_COLLECTION).createIndex({ direction: 1, finishedAt: -1 }),
    database.collection(SYNC_CONFLICTS_COLLECTION).createIndex({ runId: 1, createdAt: -1 }),
    database.collection(SYNC_CONFLICTS_COLLECTION).createIndex({ createdAt: -1 }),
    database.collection(SYNC_LOCKS_COLLECTION).createIndex({ key: 1 }, { unique: true }),
    database.collection(SYNC_LOCKS_COLLECTION).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  ]);
}

async function acquireRecruitmentSyncLock(actorAccountKey: string, runId: string) {
  await ensureSyncIndexes();
  const database = await getMongoDatabase();
  const collection = database.collection(SYNC_LOCKS_COLLECTION);
  const maxAttempts = 15;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000);
    const result = await collection.findOneAndUpdate(
      {
        key: RECRUITMENT_SYNC_LOCK_KEY,
        $or: [
          { expiresAt: { $lte: now } },
          { expiresAt: { $exists: false } }
        ]
      },
      {
        $set: {
          key: RECRUITMENT_SYNC_LOCK_KEY,
          actorAccountKey,
          runId,
          acquiredAt: now,
          expiresAt
        }
      },
      {
        upsert: true,
        returnDocument: "after"
      }
    ).catch(async (error) => {
      if (!(error instanceof Error) || !/duplicate key/i.test(error.message)) throw error;
      return null;
    });

    if (result && result.runId === runId) {
      return async () => {
        await collection.deleteOne({ key: RECRUITMENT_SYNC_LOCK_KEY, runId });
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("Luồng sync tuyển dụng đang bận. Vui lòng thử lại sau vài giây.");
}

async function persistSyncRun(input: {
  run: RecruitmentSheetSyncRun;
  conflicts: RecruitmentSheetSyncConflict[];
}) {
  await ensureSyncIndexes();
  const database = await getMongoDatabase();
  await database.collection<RecruitmentSheetSyncRun>(SYNC_RUNS_COLLECTION).insertOne(input.run);
  if (input.conflicts.length > 0) {
    await database.collection<RecruitmentSheetSyncConflict>(SYNC_CONFLICTS_COLLECTION).insertMany(input.conflicts);
  }
}

function rowMatchByEmployeeId(values: string[][], indexMap: Map<string, number>): SheetRowLookup {
  const rows = new Map<string, SheetRowMatch>();
  const duplicates = new Map<string, SheetRowMatch[]>();
  values.slice(1).forEach((row, index) => {
    const employeeId = getColumn(row, indexMap, "mã nhân viên").toUpperCase();
    if (!employeeId) return;
    const match = {
      rowNumber: index + 2,
      values: [...row]
    };
    const existing = rows.get(employeeId);
    if (existing) {
      duplicates.set(employeeId, [...(duplicates.get(employeeId) || [existing]), match]);
      return;
    }
    rows.set(employeeId, match);
  });
  return { rows, duplicates };
}

function getFirstColumnName(indexMap: Map<string, number>, names: string[]) {
  for (const name of names) {
    if (indexMap.has(name)) return name;
  }
  return "";
}

function rowMatchByAliases(values: string[][], indexMap: Map<string, number>, names: string[]): SheetRowLookup {
  const keyName = getFirstColumnName(indexMap, names);
  if (!keyName) {
    return {
      rows: new Map<string, SheetRowMatch>(),
      duplicates: new Map<string, SheetRowMatch[]>()
    };
  }

  const rows = new Map<string, SheetRowMatch>();
  const duplicates = new Map<string, SheetRowMatch[]>();
  values.slice(1).forEach((row, index) => {
    const employeeId = getColumn(row, indexMap, keyName).toUpperCase();
    if (!employeeId) return;
    const match = {
      rowNumber: index + 2,
      values: [...row]
    };
    const existing = rows.get(employeeId);
    if (existing) {
      duplicates.set(employeeId, [...(duplicates.get(employeeId) || [existing]), match]);
      return;
    }
    rows.set(employeeId, match);
  });
  return { rows, duplicates };
}

function compareAndTrackOverwrite(input: {
  nextRow: string[];
  currentRow: string[];
  indexMap: Map<string, number>;
  columns: string[];
  runId: string;
  role: EmployeeRole;
  employeeId: string;
  direction: RecruitmentSheetSyncDirection;
  tabName: string;
  rowNumber: number;
  conflicts: RecruitmentSheetSyncConflict[];
}) {
  input.columns.forEach((columnName) => {
    const index = input.indexMap.get(columnName);
    if (index === undefined) return;
    const currentValue = normalizeText(input.currentRow[index]);
    const nextValue = normalizeText(input.nextRow[index]);
    if (!currentValue || currentValue === nextValue) return;
    input.conflicts.push(buildConflict(
      input.runId,
      input.direction,
      "sheet_overwrite",
      `Ghi đè cột "${columnName}" của ${input.employeeId} trên tab ${input.tabName}: "${currentValue}" -> "${nextValue}".`,
      {
        role: input.role,
        employeeId: input.employeeId,
        tabName: input.tabName,
        rowNumber: input.rowNumber
      }
    ));
  });
}

function buildRowFromMappings(input: {
  header: string[];
  currentRow?: string[];
  mappings: SheetCellMapping[];
}) {
  const row = input.currentRow ? [...input.currentRow] : new Array(input.header.length).fill("");
  const indexMap = buildIndexMap(input.header);
  for (const mapping of input.mappings) {
    setCellAlias(row, indexMap, mapping.aliases, mapping.value);
  }
  return row;
}

function buildCellUpdates(input: {
  tabName: string;
  rowNumber: number;
  currentRow: string[];
  indexMap: Map<string, number>;
  mappings: SheetCellMapping[];
}) {
  const updates: Array<{ range: string; values: string[][] }> = [];
  for (const mapping of input.mappings) {
    const index = firstExistingIndex(input.indexMap, mapping.aliases);
    if (index < 0) continue;
    const currentValue = normalizeText(input.currentRow[index]);
    const nextValue = normalizeText(mapping.value);
    if (currentValue === nextValue) continue;
    const columnLetter = columnLetterFromIndex(index);
    updates.push({
      range: `'${input.tabName}'!${columnLetter}${input.rowNumber}:${columnLetter}${input.rowNumber}`,
      values: [[mapping.value]]
    });
  }
  return updates;
}

function setCell(row: string[], indexMap: Map<string, number>, columnName: string, value: string) {
  const index = indexMap.get(columnName);
  if (index === undefined) return;
  while (row.length <= index) row.push("");
  row[index] = value;
}

function setCellByIndex(row: string[], index: number, value: string) {
  if (index < 0) return;
  while (row.length <= index) row.push("");
  row[index] = value;
}

function columnLetterFromIndex(index: number) {
  let remaining = index + 1;
  let letters = "";
  while (remaining > 0) {
    const modulo = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + modulo) + letters;
    remaining = Math.floor((remaining - modulo) / 26);
  }
  return letters;
}

function buildHostEmployeeMutation(input: {
  employeeId: string;
  row: string[];
  indexMap: Map<string, number>;
  existing?: Awaited<ReturnType<typeof findSchedulePerson>> | null;
}): SchedulePersonMutation {
  const canLiveHome = parseBooleanCell(getColumn(input.row, input.indexMap, "live tại nhà"));
  const canLiveStudio = parseBooleanCell(getColumn(input.row, input.indexMap, "live tại studio"));
  const canUsePersonalAccount = parseBooleanCell(getColumn(input.row, input.indexMap, "live tk cá nhân"));
  const canUseCompanyAccount = parseBooleanCell(getColumn(input.row, input.indexMap, "live tk công ty"));
  return {
    id: input.employeeId,
    role: "host",
    name: getColumn(input.row, input.indexMap, "họ và tên đầy đủ")
      || getColumn(input.row, input.indexMap, "tên gọi khác")
      || input.existing?.name
      || input.employeeId,
    aliasName: getColumn(input.row, input.indexMap, "tên gọi khác") || input.existing?.aliasName || "",
    email: getColumn(input.row, input.indexMap, "gmail") || input.existing?.email || "",
    phone: getColumn(input.row, input.indexMap, "sđt") || input.existing?.phone || "",
    level: getColumn(input.row, input.indexMap, "đánh giá level") || input.existing?.level || "Thử việc",
    rating: getColumn(input.row, input.indexMap, "rating") || input.existing?.rating || "",
    workLocation: buildHostWorkLocation({
      canLiveHome,
      canLiveStudio,
      fallback: input.existing?.workLocation
    }),
    cvReference: getColumn(input.row, input.indexMap, "cv") || input.existing?.cvReference || "",
    experience: getColumn(input.row, input.indexMap, "kinh nghiệm") || input.existing?.experience || "",
    trainingStatus: parseBooleanCell(getColumn(input.row, input.indexMap, "đã tham gia training"))
      ? "Đã training"
      : input.existing?.trainingStatus || "Chưa training",
    notes: getColumn(input.row, input.indexMap, "note") || input.existing?.notes || "",
    achievements: getColumn(input.row, input.indexMap, "thành tích") || input.existing?.achievements || "",
    zaloStatus: parseBooleanCell(getColumn(input.row, input.indexMap, "tham gia zalo"))
      ? "Đã tham gia"
      : input.existing?.zaloStatus || "",
    liveAccountType: buildLiveAccountType({
      canUsePersonalAccount,
      canUseCompanyAccount,
      fallback: input.existing?.liveAccountType
    }),
    liveChannelId: getColumn(input.row, input.indexMap, "live_channel_id") || input.existing?.liveChannelId || "",
    active: true,
    source: "Google Sheet recruitment sync"
  };
}

function buildSupportEmployeeMutation(input: {
  employeeId: string;
  row: string[];
  indexMap: Map<string, number>;
  existing?: Awaited<ReturnType<typeof findSchedulePerson>> | null;
}): SchedulePersonMutation {
  return {
    id: input.employeeId,
    role: "support",
    name: getColumn(input.row, input.indexMap, "tên") || input.existing?.name || input.employeeId,
    aliasName: getColumn(input.row, input.indexMap, "tên gọi khác") || input.existing?.aliasName || "",
    email: getColumn(input.row, input.indexMap, "gmail") || input.existing?.email || "",
    phone: getColumn(input.row, input.indexMap, "sđt") || input.existing?.phone || "",
    level: getColumn(input.row, input.indexMap, "level") || input.existing?.level || "Cấp 1",
    rating: input.existing?.rating || "D",
    cvReference: getColumn(input.row, input.indexMap, "cv") || input.existing?.cvReference || "",
    experience: getColumn(input.row, input.indexMap, "kinh nghiệm") || input.existing?.experience || "",
    trainingStatus: parseBooleanCell(getColumn(input.row, input.indexMap, "đã tham gia training"))
      ? "Đã training"
      : input.existing?.trainingStatus || "Chưa training",
    notes: getColumn(input.row, input.indexMap, "kết quả đánh giá") || input.existing?.notes || "",
    active: true,
    source: "Google Sheet recruitment sync"
  };
}

async function syncEmployeeFromSheetRow(input: {
  role: EmployeeRole;
  employeeId: string;
  row: string[];
  indexMap: Map<string, number>;
  actorAccountKey: string;
}) {
  const existing = await findSchedulePerson(input.role, input.employeeId);
  const mutation = input.role === "host"
    ? buildHostEmployeeMutation({
      employeeId: input.employeeId,
      row: input.row,
      indexMap: input.indexMap,
      existing
    })
    : buildSupportEmployeeMutation({
      employeeId: input.employeeId,
      row: input.row,
      indexMap: input.indexMap,
      existing
    });
  if (!mutation.name) {
    throw new Error("Thiếu tên nhân viên để sync roster.");
  }
  if (input.role === "host" && !mutation.workLocation) {
    throw new Error("Thiếu cấu hình Home/Studio cho host.");
  }
  return existing
    ? { person: await updateSchedulePerson(mutation, input.actorAccountKey), created: false }
    : { person: await createSchedulePerson(mutation, input.actorAccountKey), created: true };
}

function buildHostSheetRow(input: {
  header: string[];
  currentRow?: string[];
  profile: Awaited<ReturnType<typeof listRecruitmentProfiles>>[number];
  contract?: Awaited<ReturnType<typeof listEmployeeContractProfiles>>[number];
}) {
  return buildRowFromMappings({
    header: input.header,
    currentRow: input.currentRow,
    mappings: buildHostSheetMappings(input.profile, input.contract)
  });
}

function buildSupportSheetRow(input: {
  header: string[];
  currentRow?: string[];
  profile: Awaited<ReturnType<typeof listRecruitmentProfiles>>[number];
  contract?: Awaited<ReturnType<typeof listEmployeeContractProfiles>>[number];
}) {
  return buildRowFromMappings({
    header: input.header,
    currentRow: input.currentRow,
    mappings: buildSupportSheetMappings(input.profile, input.contract)
  });
}

function buildPortfolioMasterRow(input: {
  header: string[];
  currentRow?: string[];
  profile: Awaited<ReturnType<typeof listRecruitmentProfiles>>[number];
}) {
  return buildRowFromMappings({
    header: input.header,
    currentRow: input.currentRow,
    mappings: buildPortfolioMasterMappings(input.profile)
  });
}

function buildSupportMasterRow(input: {
  header: string[];
  currentRow?: string[];
  profile: Awaited<ReturnType<typeof listRecruitmentProfiles>>[number];
}) {
  return buildRowFromMappings({
    header: input.header,
    currentRow: input.currentRow,
    mappings: buildSupportMasterMappings(input.profile)
  });
}

function buildHostSheetMappings(
  profile: Awaited<ReturnType<typeof listRecruitmentProfiles>>[number],
  contract?: Awaited<ReturnType<typeof listEmployeeContractProfiles>>[number]
): SheetCellMapping[] {
  return [
    { aliases: ["mã hđ"], value: profile.sheetContractCode || contract?.contractCode || "" },
    { aliases: ["mã nhân viên"], value: profile.employeeId },
    { aliases: ["họ và tên đầy đủ"], value: profile.fullName },
    { aliases: ["tên gọi khác"], value: profile.aliasName },
    { aliases: ["sđt"], value: profile.phone },
    { aliases: ["lương mong muốn"], value: profile.expectedSalary },
    { aliases: ["lương thỏa thuận"], value: profile.salaryOffered || "" },
    { aliases: ["phản hồi về lương thỏa thuận"], value: profile.salaryOfferFeedback || "" },
    { aliases: ["tham gia zalo"], value: formatBooleanCell(profile.zaloJoined) },
    { aliases: ["kinh nghiệm"], value: profile.experience },
    { aliases: ["đánh giá level"], value: profile.level },
    { aliases: ["thành tích"], value: profile.achievements },
    { aliases: ["cv"], value: profile.cvUrl },
    { aliases: ["link"], value: profile.introVideoUrl },
    { aliases: ["live tk cá nhân"], value: formatBooleanCell(profile.canUsePersonalAccount) },
    { aliases: ["live tk công ty"], value: formatBooleanCell(profile.canUseCompanyAccount) },
    { aliases: ["link tiktok"], value: profile.tiktokUrl },
    { aliases: ["lượt follow"], value: profile.followerCount || "" },
    { aliases: ["rating"], value: profile.rating },
    { aliases: ["live tại nhà"], value: formatBooleanCell(profile.canLiveHome) },
    { aliases: ["live tại studio"], value: formatBooleanCell(profile.canLiveStudio) },
    { aliases: ["đã tham gia training"], value: formatBooleanCell(profile.trainingJoined) },
    { aliases: ["note"], value: profile.notes },
    { aliases: ["live_channel_id"], value: profile.liveChannelId },
    { aliases: ["gmail", "email"], value: contract?.gmail || profile.email || "" },
    { aliases: ["ngày sinh"], value: contract?.dateOfBirth || "" },
    { aliases: ["cccd"], value: contract?.citizenId || "" },
    { aliases: ["ngày cấp"], value: contract?.citizenIdIssuedDate || "" },
    { aliases: ["nơi cấp"], value: contract?.citizenIdIssuedPlace || "" },
    { aliases: ["thường trú"], value: contract?.permanentAddress || "" },
    { aliases: ["tạm trú"], value: contract?.temporaryAddress || "" },
    { aliases: ["stk"], value: contract?.bankAccountNumber || "" },
    { aliases: ["bank"], value: contract?.bankName || "" }
  ];
}

function buildSupportSheetMappings(
  profile: Awaited<ReturnType<typeof listRecruitmentProfiles>>[number],
  contract?: Awaited<ReturnType<typeof listEmployeeContractProfiles>>[number]
): SheetCellMapping[] {
  return [
    { aliases: ["mã hđ"], value: profile.sheetContractCode || contract?.contractCode || "" },
    { aliases: ["mã nhân viên"], value: profile.employeeId },
    { aliases: ["tên"], value: profile.fullName },
    { aliases: ["sđt"], value: profile.phone },
    { aliases: ["level"], value: profile.level },
    { aliases: ["lương mong muốn theo giờ"], value: profile.expectedSalary },
    { aliases: ["kinh nghiệm"], value: profile.experience },
    { aliases: ["cv"], value: profile.cvUrl },
    { aliases: ["đã tham gia training"], value: formatBooleanCell(profile.trainingJoined) },
    { aliases: ["kết quả đánh giá"], value: profile.evaluationSummary || "" },
    { aliases: ["cash offer (by gem)"], value: profile.supportGemOffer || "" },
    { aliases: ["cash offer (reality) lần i"], value: profile.cashOfferReality || "" },
    { aliases: ["deal cast lần i"], value: profile.dealStatus || "" },
    { aliases: SUPPORT_CASH_OFFER_ROUND_TWO_ALIASES, value: profile.cashOfferRealityRoundTwo || "" },
    { aliases: SUPPORT_DEAL_STATUS_ROUND_TWO_ALIASES, value: profile.dealStatusRoundTwo || "" },
    { aliases: ["support chính mức offer"], value: profile.supportMainOfferNote || "" },
    { aliases: ["stk"], value: contract?.bankAccountNumber || "" },
    { aliases: ["bank"], value: contract?.bankName || "" }
  ];
}

function buildPortfolioMasterMappings(
  profile: Awaited<ReturnType<typeof listRecruitmentProfiles>>[number]
): SheetCellMapping[] {
  const compensation = resolveEmployeeCompensation("host", {
    rating: profile.rating,
    level: profile.level,
    cashOffer: profile.salaryOffered
  });
  const liveAccountType = profile.canUsePersonalAccount && profile.canUseCompanyAccount
    ? "Cá nhân + Công ty"
    : profile.canUseCompanyAccount
      ? "Công ty"
      : profile.canUsePersonalAccount
        ? "Cá nhân"
        : "";
  const trainingStatus = profile.trainingJoined ? "Rồi" : "Chưa";
  return [
    { aliases: ["streamer_id", "mã nhân viên"], value: profile.employeeId },
    { aliases: ["full_name", "họ và tên"], value: profile.fullName },
    { aliases: ["entry_grade", "grade"], value: compensation.level || profile.level || profile.rating || "" },
    { aliases: ["cash_offer"], value: compensation.cashOffer || "" },
    { aliases: ["experience"], value: profile.experience },
    { aliases: ["achievements"], value: profile.achievements },
    { aliases: ["live_account_type"], value: liveAccountType },
    { aliases: ["training_status"], value: trainingStatus },
    { aliases: ["live_channel_id"], value: profile.liveChannelId },
    { aliases: ["notes"], value: profile.notes }
  ];
}

function buildSupportMasterMappings(
  profile: Awaited<ReturnType<typeof listRecruitmentProfiles>>[number]
): SheetCellMapping[] {
  const compensation = resolveEmployeeCompensation("support", {
    rating: profile.rating,
    level: profile.level,
    cashOffer: profile.supportGemOffer
  });
  return [
    { aliases: ["mã support (support_id)", "support_id", "mã support"], value: profile.employeeId },
    { aliases: ["họ và tên", "họ và tên đầy đủ", "full_name"], value: profile.fullName },
    { aliases: ["cấp độ / level", "level", "cấp độ"], value: compensation.level || profile.level || "" },
    { aliases: ["cash offer", "cash_offer"], value: compensation.cashOffer || "" },
    { aliases: ["experience"], value: profile.experience },
    { aliases: ["training_status"], value: profile.trainingJoined ? "Rồi" : "Chưa" },
    { aliases: ["notes"], value: profile.evaluationSummary || profile.notes || "" }
  ];
}

async function applySheetUpdates(spreadsheetId: string, updates: Array<{ range: string; values: string[][] }>) {
  if (updates.length === 0) return;
  const sheets = createGoogleSheetsClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: updates
    }
  });
}

async function appendSheetRows(tabName: string, spreadsheetId: string, rows: string[][]) {
  if (rows.length === 0) return;
  const sheets = createGoogleSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${tabName}'!A:AZ`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows
    }
  });
}

export async function updateRecruitmentSheetContractCode(input: {
  role: EmployeeRole;
  employeeId: string;
  contractCode: string;
}) {
  const tabName = input.role === "host" ? HOST_TAB_NAME : SUPPORT_TAB_NAME;
  const { spreadsheetId, values } = await readSheet(tabName);
  const header = values[0] || [];
  const indexMap = buildIndexMap(header);
  const employeeIdIndex = indexMap.get("mã nhân viên");
  const contractCodeIndex = indexMap.get("mã hđ");
  if (employeeIdIndex === undefined) {
    throw new Error(`Tab ${tabName} thiếu cột Mã nhân viên.`);
  }
  if (contractCodeIndex === undefined) {
    throw new Error(`Tab ${tabName} thiếu cột Mã HĐ.`);
  }

  const normalizedEmployeeId = normalizeText(input.employeeId).toUpperCase();
  const matches = values.slice(1)
    .map((row, index) => ({
      row,
      rowNumber: index + 2,
      employeeId: normalizeText(row[employeeIdIndex]).toUpperCase()
    }))
    .filter((item) => item.employeeId === normalizedEmployeeId);

  if (matches.length === 0) {
    return {
      success: false,
      spreadsheetId,
      tabName,
      rowNumber: 0,
      message: `Không tìm thấy ${input.employeeId} trong tab ${tabName} để ghi Mã HĐ.`
    };
  }
  if (matches.length > 1) {
    throw new Error(`Tab ${tabName} có nhiều dòng trùng mã ${input.employeeId}, chưa ghi Mã HĐ để tránh sai dòng.`);
  }

  const columnLetter = columnLetterFromIndex(contractCodeIndex);
  const rowNumber = matches[0].rowNumber;
  await applySheetUpdates(spreadsheetId, [{
    range: `'${tabName}'!${columnLetter}${rowNumber}:${columnLetter}${rowNumber}`,
    values: [[input.contractCode]]
  }]);

  return {
    success: true,
    spreadsheetId,
    tabName,
    rowNumber,
    message: `Đã ghi Mã HĐ ${input.contractCode} vào ${tabName} dòng ${rowNumber}.`
  };
}

export async function importRecruitmentProfilesFromSheets(actorAccountKey: string): Promise<ImportSummary> {
  return importRecruitmentProfilesFromSheetsWithMode(actorAccountKey, { dryRun: false });
}

export async function importRecruitmentProfilesFromSheetsWithMode(
  actorAccountKey: string,
  options: { dryRun?: boolean } = {}
): Promise<ImportSummary> {
  const runId = randomUUID();
  const startedAt = new Date();
  const conflicts: RecruitmentSheetSyncConflict[] = [];
  const dryRun = options.dryRun === true;

  try {
    const [{ spreadsheetId, values: hostValues }, { values: supportValues }] = await Promise.all([
      readSheet(HOST_TAB_NAME),
      readSheet(SUPPORT_TAB_NAME)
    ]);
    assertRecruitmentImportSheet({ role: "host", tabName: HOST_TAB_NAME, values: hostValues });
    assertRecruitmentImportSheet({ role: "support", tabName: SUPPORT_TAB_NAME, values: supportValues });

    let processedRows = 0;
    let updatedProfiles = 0;
    let updatedEmployees = 0;
    let createdEmployees = 0;
    let deactivatedEmployees = 0;
    let updatedContracts = 0;
    let skippedRows = 0;
    const seenHostEmployeeIds = new Set<string>();
    const seenSupportEmployeeIds = new Set<string>();

    async function importHostRows() {
      const header = hostValues[0] || [];
      const indexMap = buildIndexMap(header);
      for (const [index, row] of hostValues.slice(1).entries()) {
        const rowNumber = index + 2;
        const employeeId = getColumn(row, indexMap, "mã nhân viên");
        if (!employeeId) continue;
        seenHostEmployeeIds.add(employeeId);
        processedRows += 1;
        let person = await findSchedulePerson("host", employeeId);
        if (!person) {
          conflicts.push(buildConflict(
            runId,
            "sheet_to_website",
            "unknown_employee",
            `Host ${employeeId} chưa có trong roster; hệ thống sẽ tạo mới từ sheet.`,
            { role: "host", employeeId, tabName: HOST_TAB_NAME, rowNumber }
          ));
        }
        try {
          if (dryRun) {
            const rosterMutation = buildHostEmployeeMutation({ employeeId, row, indexMap, existing: person });
            if (!rosterMutation.name) throw new Error("Thiếu tên nhân viên để sync roster.");
            if (!rosterMutation.workLocation) throw new Error("Thiếu cấu hình Home/Studio cho host.");
            if (person) updatedEmployees += 1;
            else createdEmployees += 1;
          } else {
            const synced = await syncEmployeeFromSheetRow({
              role: "host",
              employeeId,
              row,
              indexMap,
              actorAccountKey
            });
            person = synced.person;
            if (synced.created) createdEmployees += 1;
            else updatedEmployees += 1;
          }
        } catch (error) {
          skippedRows += 1;
          conflicts.push(buildConflict(
            runId,
            "sheet_to_website",
            "invalid_row",
            `Không sync được roster cho host ${employeeId}: ${error instanceof Error ? error.message : "Dữ liệu không hợp lệ."}`,
            { role: "host", employeeId, tabName: HOST_TAB_NAME, rowNumber }
          ));
        }

        if (!dryRun) {
          await upsertRecruitmentProfile({
            role: "host",
            employeeId,
            actorAccountKey,
            values: {
              sheetContractCode: getColumn(row, indexMap, "mã hđ"),
              fullName: getColumn(row, indexMap, "họ và tên đầy đủ") || getColumn(row, indexMap, "tên gọi khác") || person?.name || employeeId,
              aliasName: getColumn(row, indexMap, "tên gọi khác"),
              phone: getColumn(row, indexMap, "sđt") || person?.phone || "",
              email: getColumn(row, indexMap, "gmail"),
              cvUrl: getColumn(row, indexMap, "cv"),
              experience: getColumn(row, indexMap, "kinh nghiệm"),
              achievements: getColumn(row, indexMap, "thành tích"),
              expectedSalary: getColumn(row, indexMap, "lương mong muốn"),
              introVideoUrl: getColumn(row, indexMap, "link"),
              tiktokUrl: getColumn(row, indexMap, "link tiktok"),
              followerCount: getColumn(row, indexMap, "lượt follow"),
              zaloJoined: parseBooleanCell(getColumn(row, indexMap, "tham gia zalo")),
              level: getColumn(row, indexMap, "đánh giá level"),
              rating: getColumn(row, indexMap, "rating"),
              trainingJoined: parseBooleanCell(getColumn(row, indexMap, "đã tham gia training")),
              liveChannelId: getColumn(row, indexMap, "live_channel_id"),
              canLiveHome: parseBooleanCell(getColumn(row, indexMap, "live tại nhà")),
              canLiveStudio: parseBooleanCell(getColumn(row, indexMap, "live tại studio")),
              canUsePersonalAccount: parseBooleanCell(getColumn(row, indexMap, "live tk cá nhân")),
              canUseCompanyAccount: parseBooleanCell(getColumn(row, indexMap, "live tk công ty")),
              liveLocationPreference: parseBooleanCell(getColumn(row, indexMap, "live tại studio"))
                ? "studio"
                : parseBooleanCell(getColumn(row, indexMap, "live tại nhà"))
                  ? "home"
                  : "",
              liveAccountPreference: parseBooleanCell(getColumn(row, indexMap, "live tk công ty"))
                ? "company"
                : parseBooleanCell(getColumn(row, indexMap, "live tk cá nhân"))
                  ? "personal"
                  : "",
              salaryOffered: getColumn(row, indexMap, "lương thỏa thuận"),
              salaryOfferFeedback: getColumn(row, indexMap, "phản hồi về lương thỏa thuận"),
              notes: getColumn(row, indexMap, "note"),
              sourceTab: HOST_TAB_NAME
            }
          });
        }
        updatedProfiles += 1;

        const contractFields = getContractSheetFields(row, indexMap);
        if (person && hasAnyContractField(contractFields)) {
          if (!dryRun) {
            await upsertEmployeeContractProfileFields({
              person,
              actorAccountKey,
              gmail: contractFields.gmail,
              dateOfBirth: contractFields.dateOfBirth,
              citizenId: contractFields.citizenId,
              citizenIdIssuedDate: contractFields.citizenIdIssuedDate,
              citizenIdIssuedPlace: contractFields.citizenIdIssuedPlace,
              permanentAddress: contractFields.permanentAddress,
              temporaryAddress: contractFields.temporaryAddress,
              bankAccountNumber: contractFields.bankAccountNumber,
              bankName: contractFields.bankName
            });
          }
          updatedContracts += 1;
        } else if (!person) {
          conflicts.push(buildConflict(
            runId,
            "sheet_to_website",
            "missing_contract_profile",
            `Host ${employeeId} chưa sync được roster nên chưa cập nhật Gmail vào hồ sơ hợp đồng.`,
            { role: "host", employeeId, tabName: HOST_TAB_NAME, rowNumber }
          ));
        } else {
          conflicts.push(buildConflict(
            runId,
            "sheet_to_website",
            "missing_contract_profile",
            `Host ${employeeId} chưa có cột contract hợp lệ trong sheet để cập nhật hồ sơ hợp đồng.`,
            { role: "host", employeeId, tabName: HOST_TAB_NAME, rowNumber }
          ));
        }
      }
    }

    async function importSupportRows() {
      const header = supportValues[0] || [];
      const indexMap = buildIndexMap(header);
      for (const [index, row] of supportValues.slice(1).entries()) {
        const rowNumber = index + 2;
        const employeeId = getColumn(row, indexMap, "mã nhân viên");
        if (!employeeId) continue;
        seenSupportEmployeeIds.add(employeeId);
        processedRows += 1;
        let person = await findSchedulePerson("support", employeeId);
        if (!person) {
          conflicts.push(buildConflict(
            runId,
            "sheet_to_website",
            "unknown_employee",
            `Support ${employeeId} chưa có trong roster; hệ thống sẽ tạo mới từ sheet.`,
            { role: "support", employeeId, tabName: SUPPORT_TAB_NAME, rowNumber }
          ));
        }
        try {
          if (dryRun) {
            const rosterMutation = buildSupportEmployeeMutation({ employeeId, row, indexMap, existing: person });
            if (!rosterMutation.name) throw new Error("Thiếu tên nhân viên để sync roster.");
            if (person) updatedEmployees += 1;
            else createdEmployees += 1;
          } else {
            const synced = await syncEmployeeFromSheetRow({
              role: "support",
              employeeId,
              row,
              indexMap,
              actorAccountKey
            });
            person = synced.person;
            if (synced.created) createdEmployees += 1;
            else updatedEmployees += 1;
          }
        } catch (error) {
          skippedRows += 1;
          conflicts.push(buildConflict(
            runId,
            "sheet_to_website",
            "invalid_row",
            `Không sync được roster cho support ${employeeId}: ${error instanceof Error ? error.message : "Dữ liệu không hợp lệ."}`,
            { role: "support", employeeId, tabName: SUPPORT_TAB_NAME, rowNumber }
          ));
        }

        if (!dryRun) {
          await upsertRecruitmentProfile({
            role: "support",
            employeeId,
            actorAccountKey,
            values: {
              sheetContractCode: getColumn(row, indexMap, "mã hđ"),
              fullName: getColumn(row, indexMap, "tên") || person?.name || employeeId,
              aliasName: "",
              phone: getColumn(row, indexMap, "sđt") || person?.phone || "",
              email: "",
              cvUrl: getColumn(row, indexMap, "cv"),
              experience: getColumn(row, indexMap, "kinh nghiệm"),
              achievements: "",
              expectedSalary: getColumn(row, indexMap, "lương mong muốn theo giờ"),
              introVideoUrl: "",
              tiktokUrl: "",
              zaloJoined: false,
              level: getColumn(row, indexMap, "level"),
              rating: "",
              trainingJoined: parseBooleanCell(getColumn(row, indexMap, "đã tham gia training")),
              liveChannelId: "",
              canLiveHome: false,
              canLiveStudio: false,
              canUsePersonalAccount: false,
              canUseCompanyAccount: false,
              liveLocationPreference: "",
              liveAccountPreference: "",
              evaluationSummary: getColumn(row, indexMap, "kết quả đánh giá"),
              supportGemOffer: getColumn(row, indexMap, "cash offer (by gem)"),
              cashOfferReality: getColumn(row, indexMap, "cash offer (reality) lần i"),
              dealStatus: getColumn(row, indexMap, "deal cast lần i"),
              cashOfferRealityRoundTwo: getColumnAlias(row, indexMap, SUPPORT_CASH_OFFER_ROUND_TWO_ALIASES),
              dealStatusRoundTwo: getColumnAlias(row, indexMap, SUPPORT_DEAL_STATUS_ROUND_TWO_ALIASES),
              supportMainOfferNote: getColumn(row, indexMap, "support chính mức offer"),
              notes: "",
              sourceTab: SUPPORT_TAB_NAME
            }
          });
        }
        updatedProfiles += 1;

        const contractFields = getContractSheetFields(row, indexMap);
        if (person && hasAnyContractField(contractFields)) {
          if (!dryRun) {
            await upsertEmployeeContractProfileFields({
              person,
              actorAccountKey,
              gmail: contractFields.gmail,
              dateOfBirth: contractFields.dateOfBirth,
              citizenId: contractFields.citizenId,
              citizenIdIssuedDate: contractFields.citizenIdIssuedDate,
              citizenIdIssuedPlace: contractFields.citizenIdIssuedPlace,
              permanentAddress: contractFields.permanentAddress,
              temporaryAddress: contractFields.temporaryAddress,
              bankAccountNumber: contractFields.bankAccountNumber,
              bankName: contractFields.bankName
            });
          }
          updatedContracts += 1;
        } else if (!person) {
          conflicts.push(buildConflict(
            runId,
            "sheet_to_website",
            "missing_contract_profile",
            `Support ${employeeId} chưa sync được roster nên chưa cập nhật STK/Bank vào hồ sơ hợp đồng.`,
            { role: "support", employeeId, tabName: SUPPORT_TAB_NAME, rowNumber }
          ));
        } else {
          conflicts.push(buildConflict(
            runId,
            "sheet_to_website",
            "missing_contract_profile",
            `Support ${employeeId} chưa có cột contract hợp lệ trong sheet để cập nhật hồ sơ hợp đồng.`,
            { role: "support", employeeId, tabName: SUPPORT_TAB_NAME, rowNumber }
          ));
        }
      }
    }

    await importHostRows();
    await importSupportRows();

    if (!dryRun) {
      if (seenHostEmployeeIds.size === 0) {
        throw new Error(`Tab ${HOST_TAB_NAME} không có mã nhân viên hợp lệ. Đã dừng sync để tránh khóa nhầm toàn bộ host.`);
      }
      if (seenSupportEmployeeIds.size === 0) {
        throw new Error(`Tab ${SUPPORT_TAB_NAME} không có mã nhân viên hợp lệ. Đã dừng sync để tránh khóa nhầm toàn bộ support.`);
      }
      const [hostDeactivation, supportDeactivation] = await Promise.all([
        deactivateSchedulePeopleMissingFromSheet({
          role: "host",
          keepEmployeeIds: seenHostEmployeeIds,
          actorAccountKey
        }),
        deactivateSchedulePeopleMissingFromSheet({
          role: "support",
          keepEmployeeIds: seenSupportEmployeeIds,
          actorAccountKey
        })
      ]);
      deactivatedEmployees = hostDeactivation.deactivated + supportDeactivation.deactivated;
    }

    const result = {
      success: true,
      spreadsheetId,
      dryRun,
      processedRows,
      updatedProfiles,
      updatedEmployees,
      createdEmployees,
      deactivatedEmployees,
      updatedContracts,
      skippedRows,
      message: dryRun
        ? `Dry run: sẽ sync ${updatedProfiles} hồ sơ tuyển dụng, ${updatedEmployees} nhân viên cập nhật, ${createdEmployees} nhân viên tạo mới từ 2 tab nguồn.`
        : `Đã sync ${updatedProfiles} hồ sơ tuyển dụng, ${updatedEmployees} nhân viên cập nhật, ${createdEmployees} nhân viên tạo mới và ${deactivatedEmployees} nhân viên mất khỏi sheet đã bị khóa từ 2 tab nguồn.`
    };

    await persistSyncRun({
      run: {
        runId,
        direction: "sheet_to_website",
        operation: dryRun ? "import_profiles_dry_run" : "import_profiles",
        spreadsheetId,
        actorAccountKey,
        success: true,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        processedRows,
        updatedProfiles,
        updatedEmployees,
        createdEmployees,
        deactivatedEmployees,
        updatedContracts,
        skippedRows,
        conflictCount: conflicts.length,
        message: result.message
      },
      conflicts
    });
    return result;
  } catch (error) {
    const spreadsheetId = getGoogleSheetsSpreadsheetId();
    try {
      await persistSyncRun({
        run: {
          runId,
          direction: "sheet_to_website",
          operation: dryRun ? "import_profiles_dry_run" : "import_profiles",
          spreadsheetId,
          actorAccountKey,
          success: false,
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          processedRows: 0,
          updatedProfiles: 0,
          updatedEmployees: 0,
          createdEmployees: 0,
          deactivatedEmployees: 0,
          updatedContracts: 0,
          skippedRows: 0,
          conflictCount: conflicts.length,
          error: error instanceof Error ? error.message : "Không kéo được dữ liệu tuyển dụng từ Google Sheet."
        },
        conflicts
      });
    } catch {
      // Preserve original error.
    }
    throw error;
  }
}

export async function syncRecruitmentProfilesToSheets(
  actorAccountKey: string,
  target?: RecruitmentSheetPushTarget
): Promise<RecruitmentSheetPushSummary> {
  const runId = randomUUID();
  const startedAt = new Date();
  const conflicts: RecruitmentSheetSyncConflict[] = [];
  const releaseLock = await acquireRecruitmentSyncLock(actorAccountKey, runId);

  try {
    const masterSpreadsheetId = getGoogleHrMasterSpreadsheetId();
    const [
      { spreadsheetId, values: hostValues },
      { values: supportValues },
      { values: portfolioMasterValues },
      { values: supportMasterValues },
      profiles,
      contractProfiles
    ] = await Promise.all([
      readSheet(HOST_TAB_NAME),
      readSheet(SUPPORT_TAB_NAME),
      readSheetFromSpreadsheet(masterSpreadsheetId, PORTFOLIO_MASTER_TAB_NAME),
      readSheetFromSpreadsheet(masterSpreadsheetId, SUPPORT_MASTER_TAB_NAME),
      listRecruitmentProfiles(),
      listEmployeeContractProfiles()
    ]);

    const contractByKey = new Map(
      contractProfiles.map((item) => [item.personKey, item] as const)
    );
    const normalizedTargetEmployeeId = target?.employeeId.trim().toUpperCase() || "";
    const profilesToSync = target
      ? profiles.filter((profile) =>
        profile.role === target.role && profile.employeeId.trim().toUpperCase() === normalizedTargetEmployeeId
      )
      : profiles;

    const hostHeader = hostValues[0] || [];
    const supportHeader = supportValues[0] || [];
    const hostIndexMap = buildIndexMap(hostHeader);
    const supportIndexMap = buildIndexMap(supportHeader);
    const hostLookup = rowMatchByEmployeeId(hostValues, hostIndexMap);
    const supportLookup = rowMatchByEmployeeId(supportValues, supportIndexMap);
    const hostRows = hostLookup.rows;
    const supportRows = supportLookup.rows;
    const duplicateHostIds = new Set(hostLookup.duplicates.keys());
    const duplicateSupportIds = new Set(supportLookup.duplicates.keys());
    const portfolioMasterHeader = portfolioMasterValues[0] || [];
    const supportMasterHeader = supportMasterValues[0] || [];
    const portfolioMasterIndexMap = buildIndexMap(portfolioMasterHeader);
    const supportMasterIndexMap = buildIndexMap(supportMasterHeader);
    const portfolioLookup = rowMatchByAliases(portfolioMasterValues, portfolioMasterIndexMap, ["streamer_id", "mã nhân viên"]);
    const supportMasterLookup = rowMatchByAliases(supportMasterValues, supportMasterIndexMap, ["mã support (support_id)", "support_id", "mã support"]);
    const portfolioRows = portfolioLookup.rows;
    const supportMasterRows = supportMasterLookup.rows;
    const duplicatePortfolioIds = new Set(portfolioLookup.duplicates.keys());
    const duplicateSupportMasterIds = new Set(supportMasterLookup.duplicates.keys());

    hostLookup.duplicates.forEach((matches, employeeId) => {
      conflicts.push(buildConflict(
        runId,
        "website_to_sheet",
        "invalid_row",
        `Tab ${HOST_TAB_NAME} đang có trùng mã nhân viên ${employeeId} ở các dòng ${matches.map((item) => item.rowNumber).join(", ")}. Bỏ qua push từ website cho hồ sơ này để tránh ghi đè sai dòng.`,
        { role: "host", employeeId, tabName: HOST_TAB_NAME, rowNumber: matches[0]?.rowNumber }
      ));
    });

    supportLookup.duplicates.forEach((matches, employeeId) => {
      conflicts.push(buildConflict(
        runId,
        "website_to_sheet",
        "invalid_row",
        `Tab ${SUPPORT_TAB_NAME} đang có trùng mã nhân viên ${employeeId} ở các dòng ${matches.map((item) => item.rowNumber).join(", ")}. Bỏ qua push từ website cho hồ sơ này để tránh ghi đè sai dòng.`,
        { role: "support", employeeId, tabName: SUPPORT_TAB_NAME, rowNumber: matches[0]?.rowNumber }
      ));
    });

    portfolioLookup.duplicates.forEach((matches, employeeId) => {
      conflicts.push(buildConflict(
        runId,
        "website_to_sheet",
        "invalid_row",
        `Tab ${PORTFOLIO_MASTER_TAB_NAME} đang có trùng mã nhân viên ${employeeId} ở các dòng ${matches.map((item) => item.rowNumber).join(", ")}. Bỏ qua sync master cho hồ sơ này để tránh ghi đè sai dòng.`,
        { role: "host", employeeId, tabName: PORTFOLIO_MASTER_TAB_NAME, rowNumber: matches[0]?.rowNumber }
      ));
    });

    supportMasterLookup.duplicates.forEach((matches, employeeId) => {
      conflicts.push(buildConflict(
        runId,
        "website_to_sheet",
        "invalid_row",
        `Tab ${SUPPORT_MASTER_TAB_NAME} đang có trùng mã nhân viên ${employeeId} ở các dòng ${matches.map((item) => item.rowNumber).join(", ")}. Bỏ qua sync master cho hồ sơ này để tránh ghi đè sai dòng.`,
        { role: "support", employeeId, tabName: SUPPORT_MASTER_TAB_NAME, rowNumber: matches[0]?.rowNumber }
      ));
    });

    const updatePayloads: Array<{ range: string; values: string[][] }> = [];
    const appendHostRows: string[][] = [];
    const appendSupportRows: string[][] = [];
    const masterUpdatePayloads: Array<{ range: string; values: string[][] }> = [];
    const appendPortfolioMasterRows: string[][] = [];
    const appendSupportMasterRows: string[][] = [];
    let updatedSheetRows = 0;
    let appendedSheetRows = 0;
    let updatedMasterRows = 0;
    let appendedMasterRows = 0;
    let skippedRows = 0;

    profilesToSync.forEach((profile) => {
      const key = employeeContractPersonKey(profile.role, profile.employeeId);
      const contract = contractByKey.get(key);
      const tabName = profile.role === "host" ? HOST_TAB_NAME : SUPPORT_TAB_NAME;
      const rowMap = profile.role === "host" ? hostRows : supportRows;
      const header = profile.role === "host" ? hostHeader : supportHeader;
      const indexMap = profile.role === "host" ? hostIndexMap : supportIndexMap;
      const duplicateIds = profile.role === "host" ? duplicateHostIds : duplicateSupportIds;
      const existingRow = rowMap.get(profile.employeeId.toUpperCase());

      if (duplicateIds.has(profile.employeeId.toUpperCase())) {
        skippedRows += 1;
        return;
      }

      if (!contract) {
        conflicts.push(buildConflict(
          runId,
          "website_to_sheet",
          "missing_contract_profile",
          `${profile.employeeId} chưa có hồ sơ hợp đồng trên website; vẫn sync các trường tuyển dụng còn lại.`,
          { role: profile.role, employeeId: profile.employeeId, tabName }
        ));
      }

      if (profile.role === "host") {
        const sheetMappings = buildHostSheetMappings(profile, contract);
        const nextRow = buildHostSheetRow({ header, currentRow: existingRow?.values, profile, contract });
        if (existingRow) {
          compareAndTrackOverwrite({
            nextRow,
            currentRow: existingRow.values,
            indexMap,
            columns: [
              "họ và tên đầy đủ",
              "mã hđ",
              "tên gọi khác",
              "sđt",
              "lương mong muốn",
              "lương thỏa thuận",
              "kinh nghiệm",
              "đánh giá level",
              "thành tích",
              "live tk cá nhân",
              "live tk công ty",
              "link tiktok",
              "live tại nhà",
              "live tại studio",
              "gmail",
              "ngày sinh",
              "cccd",
              "ngày cấp",
              "nơi cấp",
              "thường trú",
              "tạm trú",
              "stk",
              "bank"
            ],
            runId,
            role: profile.role,
            employeeId: profile.employeeId,
            direction: "website_to_sheet",
            tabName,
            rowNumber: existingRow.rowNumber,
            conflicts
          });
          updatePayloads.push(...buildCellUpdates({
            tabName,
            rowNumber: existingRow.rowNumber,
            currentRow: existingRow.values,
            indexMap,
            mappings: sheetMappings
          }));
          updatedSheetRows += 1;
        } else {
          appendHostRows.push(nextRow);
          appendedSheetRows += 1;
          conflicts.push(buildConflict(
            runId,
            "website_to_sheet",
            "sheet_row_created",
            `Không thấy dòng sheet của host ${profile.employeeId}; đã tạo mới từ website master.`,
            { role: profile.role, employeeId: profile.employeeId, tabName }
          ));
        }

        if (!duplicatePortfolioIds.has(profile.employeeId.toUpperCase())) {
          const existingMasterRow = portfolioRows.get(profile.employeeId.toUpperCase());
          const masterMappings = buildPortfolioMasterMappings(profile);
          const nextMasterRow = buildPortfolioMasterRow({
            header: portfolioMasterHeader,
            currentRow: existingMasterRow?.values,
            profile
          });
          if (existingMasterRow) {
            compareAndTrackOverwrite({
              nextRow: nextMasterRow,
              currentRow: existingMasterRow.values,
              indexMap: portfolioMasterIndexMap,
              columns: [
                "streamer_id",
                "full_name",
                "entry_grade",
                "cash_offer",
                "experience",
                "achievements",
                "live_account_type",
                "training_status",
                "live_channel_id",
                "notes"
              ],
              runId,
              role: "host",
              employeeId: profile.employeeId,
              direction: "website_to_sheet",
              tabName: PORTFOLIO_MASTER_TAB_NAME,
              rowNumber: existingMasterRow.rowNumber,
              conflicts
            });
            masterUpdatePayloads.push(...buildCellUpdates({
              tabName: PORTFOLIO_MASTER_TAB_NAME,
              rowNumber: existingMasterRow.rowNumber,
              currentRow: existingMasterRow.values,
              indexMap: portfolioMasterIndexMap,
              mappings: masterMappings
            }));
            updatedMasterRows += 1;
          } else {
            appendPortfolioMasterRows.push(nextMasterRow);
            appendedMasterRows += 1;
            conflicts.push(buildConflict(
              runId,
              "website_to_sheet",
              "sheet_row_created",
              `Không thấy dòng ${PORTFOLIO_MASTER_TAB_NAME} của host ${profile.employeeId}; đã tạo mới từ website master.`,
              { role: "host", employeeId: profile.employeeId, tabName: PORTFOLIO_MASTER_TAB_NAME }
            ));
          }
        } else {
          skippedRows += 1;
        }
      } else {
        const sheetMappings = buildSupportSheetMappings(profile, contract);
        const nextRow = buildSupportSheetRow({ header, currentRow: existingRow?.values, profile, contract });
        if (existingRow) {
          compareAndTrackOverwrite({
            nextRow,
            currentRow: existingRow.values,
            indexMap,
            columns: [
              "tên",
              "mã hđ",
              "sđt",
              "level",
              "lương mong muốn theo giờ",
              "kinh nghiệm",
              "kết quả đánh giá",
              "cash offer (by gem)",
              "cash offer (reality) lần i",
              "deal cast lần i",
              ...SUPPORT_CASH_OFFER_ROUND_TWO_ALIASES,
              ...SUPPORT_DEAL_STATUS_ROUND_TWO_ALIASES,
              "support chính mức offer",
              "stk",
              "bank"
            ],
            runId,
            role: profile.role,
            employeeId: profile.employeeId,
            direction: "website_to_sheet",
            tabName,
            rowNumber: existingRow.rowNumber,
            conflicts
          });
          updatePayloads.push(...buildCellUpdates({
            tabName,
            rowNumber: existingRow.rowNumber,
            currentRow: existingRow.values,
            indexMap,
            mappings: sheetMappings
          }));
          updatedSheetRows += 1;
        } else {
          appendSupportRows.push(nextRow);
          appendedSheetRows += 1;
          conflicts.push(buildConflict(
            runId,
            "website_to_sheet",
            "sheet_row_created",
            `Không thấy dòng sheet của support ${profile.employeeId}; đã tạo mới từ website master.`,
            { role: profile.role, employeeId: profile.employeeId, tabName }
          ));
        }

        if (!duplicateSupportMasterIds.has(profile.employeeId.toUpperCase())) {
          const existingMasterRow = supportMasterRows.get(profile.employeeId.toUpperCase());
          const masterMappings = buildSupportMasterMappings(profile);
          const nextMasterRow = buildSupportMasterRow({
            header: supportMasterHeader,
            currentRow: existingMasterRow?.values,
            profile
          });
          if (existingMasterRow) {
            compareAndTrackOverwrite({
              nextRow: nextMasterRow,
              currentRow: existingMasterRow.values,
              indexMap: supportMasterIndexMap,
              columns: [
                "mã support (support_id)",
                "support_id",
                "mã support",
                "họ và tên",
                "full_name",
                "cấp độ / level",
                "level",
                "cash offer",
                "cash_offer",
                "experience",
                "training_status",
                "notes"
              ],
              runId,
              role: "support",
              employeeId: profile.employeeId,
              direction: "website_to_sheet",
              tabName: SUPPORT_MASTER_TAB_NAME,
              rowNumber: existingMasterRow.rowNumber,
              conflicts
            });
            masterUpdatePayloads.push(...buildCellUpdates({
              tabName: SUPPORT_MASTER_TAB_NAME,
              rowNumber: existingMasterRow.rowNumber,
              currentRow: existingMasterRow.values,
              indexMap: supportMasterIndexMap,
              mappings: masterMappings
            }));
            updatedMasterRows += 1;
          } else {
            appendSupportMasterRows.push(nextMasterRow);
            appendedMasterRows += 1;
            conflicts.push(buildConflict(
              runId,
              "website_to_sheet",
              "sheet_row_created",
              `Không thấy dòng ${SUPPORT_MASTER_TAB_NAME} của support ${profile.employeeId}; đã tạo mới từ website master.`,
              { role: "support", employeeId: profile.employeeId, tabName: SUPPORT_MASTER_TAB_NAME }
            ));
          }
        } else {
          skippedRows += 1;
        }
      }
    });

    await applySheetUpdates(spreadsheetId, updatePayloads);
    await applySheetUpdates(masterSpreadsheetId, masterUpdatePayloads);
    await Promise.all([
      appendSheetRows(HOST_TAB_NAME, spreadsheetId, appendHostRows),
      appendSheetRows(SUPPORT_TAB_NAME, spreadsheetId, appendSupportRows),
      appendSheetRows(PORTFOLIO_MASTER_TAB_NAME, masterSpreadsheetId, appendPortfolioMasterRows),
      appendSheetRows(SUPPORT_MASTER_TAB_NAME, masterSpreadsheetId, appendSupportMasterRows)
    ]);

    const result = {
      success: true,
      spreadsheetId,
      updatedSheetRows,
      appendedSheetRows,
      updatedMasterRows,
      appendedMasterRows,
      skippedRows,
      message: target
        ? `Đã sync hồ sơ ${target.employeeId}: nguồn ${updatedSheetRows} cập nhật / ${appendedSheetRows} tạo mới; master ${updatedMasterRows} cập nhật / ${appendedMasterRows} tạo mới.`
        : `Đã sync tuyển dụng: nguồn ${updatedSheetRows} cập nhật / ${appendedSheetRows} tạo mới; master ${updatedMasterRows} cập nhật / ${appendedMasterRows} tạo mới.`
    };

    await persistSyncRun({
      run: {
        runId,
        direction: "website_to_sheet",
        operation: "sync_profiles",
        spreadsheetId,
        actorAccountKey,
        success: true,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        updatedSheetRows,
        appendedSheetRows,
        skippedRows,
        conflictCount: conflicts.length,
        message: result.message
      },
      conflicts
    });
    return result;
  } catch (error) {
    const spreadsheetId = getGoogleSheetsSpreadsheetId();
    await persistSyncRun({
      run: {
        runId,
        direction: "website_to_sheet",
        operation: "sync_profiles",
        spreadsheetId,
        actorAccountKey,
        success: false,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        updatedSheetRows: 0,
        appendedSheetRows: 0,
        skippedRows: 0,
        conflictCount: conflicts.length,
        error: error instanceof Error ? error.message : "Không đẩy được hồ sơ tuyển dụng lên Google Sheet."
      },
      conflicts
    });
    throw error;
  } finally {
    await releaseLock().catch(() => undefined);
  }
}

export async function listRecruitmentSheetSyncLogs(): Promise<RecruitmentSheetSyncLogsPayload> {
  await ensureSyncIndexes();
  const database = await getMongoDatabase();
  const runs = await database
    .collection<RecruitmentSheetSyncRun>(SYNC_RUNS_COLLECTION)
    .find({})
    .sort({ finishedAt: -1 })
    .limit(12)
    .toArray();
  const runIds = runs.map((item) => item.runId);
  const conflicts = runIds.length === 0
    ? []
    : await database
      .collection<RecruitmentSheetSyncConflict>(SYNC_CONFLICTS_COLLECTION)
      .find({ runId: { $in: runIds } })
      .sort({ createdAt: -1 })
      .limit(60)
      .toArray();

  return {
    success: true,
    runs,
    conflicts
  };
}
