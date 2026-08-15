import { randomUUID } from "node:crypto";
import { createGoogleSheetsClient, getGoogleSheetsSpreadsheetId } from "@/lib/googleSheets";
import {
  employeeContractPersonKey,
  listEmployeeContractProfiles,
  upsertEmployeeContractProfileFields
} from "@/lib/employeeContract";
import {
  createSchedulePerson,
  findSchedulePerson,
  type SchedulePersonMutation,
  updateSchedulePerson
} from "@/lib/employeeRoster";
import { getMongoDatabase } from "@/lib/mongodb";
import { listPeopleApplications } from "@/lib/peopleApplication";
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
const SYNC_RUNS_COLLECTION = "recruitment_sheet_sync_runs";
const SYNC_CONFLICTS_COLLECTION = "recruitment_sheet_sync_conflicts";

type ImportSummary = {
  success: boolean;
  spreadsheetId: string;
  dryRun?: boolean;
  processedRows: number;
  updatedProfiles: number;
  updatedEmployees: number;
  createdEmployees: number;
  updatedContracts: number;
  skippedRows: number;
  message: string;
};

export type RecruitmentSheetPushSummary = {
  success: boolean;
  spreadsheetId: string;
  updatedSheetRows: number;
  appendedSheetRows: number;
  skippedRows: number;
  message: string;
};

type SheetReadResult = {
  spreadsheetId: string;
  values: string[][];
};

type SheetRowMatch = {
  rowNumber: number;
  values: string[];
};

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

function getColumnByIndex(row: string[], index: number) {
  return normalizeText(row[index]);
}

async function readSheet(tabName: string): Promise<SheetReadResult> {
  const sheets = createGoogleSheetsClient();
  const spreadsheetId = getGoogleSheetsSpreadsheetId();
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
    database.collection(SYNC_CONFLICTS_COLLECTION).createIndex({ createdAt: -1 })
  ]);
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

function rowMatchByEmployeeId(values: string[][], indexMap: Map<string, number>) {
  const rows = new Map<string, SheetRowMatch>();
  values.slice(1).forEach((row, index) => {
    const employeeId = getColumn(row, indexMap, "mã nhân viên").toUpperCase();
    if (!employeeId) return;
    rows.set(employeeId, {
      rowNumber: index + 2,
      values: [...row]
    });
  });
  return rows;
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
    name: getColumn(input.row, input.indexMap, "tên gọi khác")
      || getColumn(input.row, input.indexMap, "họ và tên đầy đủ")
      || input.existing?.name
      || input.employeeId,
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
    active: input.existing?.active !== false,
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
    phone: getColumn(input.row, input.indexMap, "sđt") || input.existing?.phone || "",
    level: getColumn(input.row, input.indexMap, "level") || input.existing?.level || "Thử việc",
    cvReference: getColumn(input.row, input.indexMap, "cv") || input.existing?.cvReference || "",
    experience: getColumn(input.row, input.indexMap, "kinh nghiệm") || input.existing?.experience || "",
    trainingStatus: parseBooleanCell(getColumn(input.row, input.indexMap, "đã tham gia training"))
      ? "Đã training"
      : input.existing?.trainingStatus || "Chưa training",
    notes: getColumn(input.row, input.indexMap, "kết quả đánh giá") || input.existing?.notes || "",
    active: input.existing?.active !== false,
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
  const row = input.currentRow ? [...input.currentRow] : new Array(input.header.length).fill("");
  const indexMap = buildIndexMap(input.header);
  setCell(row, indexMap, "mã hđ", input.profile.sheetContractCode || "");
  setCell(row, indexMap, "mã nhân viên", input.profile.employeeId);
  setCell(row, indexMap, "họ và tên đầy đủ", input.profile.fullName);
  setCell(row, indexMap, "tên gọi khác", input.profile.aliasName);
  setCell(row, indexMap, "sđt", input.profile.phone);
  setCell(row, indexMap, "lương mong muốn", input.profile.expectedSalary);
  setCell(row, indexMap, "lương thỏa thuận", input.profile.salaryOffered || "");
  setCell(row, indexMap, "phản hồi về lương thỏa thuận", input.profile.salaryOfferFeedback || "");
  setCell(row, indexMap, "tham gia zalo", formatBooleanCell(input.profile.zaloJoined));
  setCell(row, indexMap, "kinh nghiệm", input.profile.experience);
  setCell(row, indexMap, "đánh giá level", input.profile.level);
  setCell(row, indexMap, "thành tích", input.profile.achievements);
  setCell(row, indexMap, "cv", input.profile.cvUrl);
  setCell(row, indexMap, "link", input.profile.introVideoUrl);
  setCell(row, indexMap, "live tk cá nhân", formatBooleanCell(input.profile.canUsePersonalAccount));
  setCell(row, indexMap, "live tk công ty", formatBooleanCell(input.profile.canUseCompanyAccount));
  setCell(row, indexMap, "link tiktok", input.profile.tiktokUrl);
  setCell(row, indexMap, "lượt follow", input.profile.followerCount || "");
  setCell(row, indexMap, "rating", input.profile.rating);
  setCell(row, indexMap, "live tại nhà", formatBooleanCell(input.profile.canLiveHome));
  setCell(row, indexMap, "live tại studio", formatBooleanCell(input.profile.canLiveStudio));
  setCell(row, indexMap, "đã tham gia training", formatBooleanCell(input.profile.trainingJoined));
  setCell(row, indexMap, "note", input.profile.notes);
  setCell(row, indexMap, "live_channel_id", input.profile.liveChannelId);
  setCell(row, indexMap, "gmail", input.contract?.gmail || input.profile.email || "");
  setCell(row, indexMap, "ngày sinh", input.contract?.dateOfBirth || "");
  setCell(row, indexMap, "cccd", input.contract?.citizenId || "");
  setCell(row, indexMap, "ngày cấp", input.contract?.citizenIdIssuedDate || "");
  setCell(row, indexMap, "nơi cấp", input.contract?.citizenIdIssuedPlace || "");
  setCell(row, indexMap, "thường trú", input.contract?.permanentAddress || "");
  setCell(row, indexMap, "tạm trú", input.contract?.temporaryAddress || "");
  setCell(row, indexMap, "stk", input.contract?.bankAccountNumber || "");
  setCell(row, indexMap, "bank", input.contract?.bankName || "");
  return row;
}

function buildSupportSheetRow(input: {
  header: string[];
  currentRow?: string[];
  profile: Awaited<ReturnType<typeof listRecruitmentProfiles>>[number];
  contract?: Awaited<ReturnType<typeof listEmployeeContractProfiles>>[number];
}) {
  const row = input.currentRow ? [...input.currentRow] : new Array(input.header.length).fill("");
  const indexMap = buildIndexMap(input.header);
  setCell(row, indexMap, "mã nhân viên", input.profile.employeeId);
  setCell(row, indexMap, "tên", input.profile.fullName);
  setCell(row, indexMap, "sđt", input.profile.phone);
  setCell(row, indexMap, "level", input.profile.level);
  setCell(row, indexMap, "lương mong muốn theo giờ", input.profile.expectedSalary);
  setCell(row, indexMap, "kinh nghiệm", input.profile.experience);
  setCell(row, indexMap, "cv", input.profile.cvUrl);
  setCell(row, indexMap, "đã tham gia training", formatBooleanCell(input.profile.trainingJoined));
  setCell(row, indexMap, "kết quả đánh giá", input.profile.evaluationSummary || "");
  setCell(row, indexMap, "cash offer (by gem)", input.profile.supportGemOffer || "");
  setCell(row, indexMap, "cash offer (reality) lần i", input.profile.cashOfferReality || "");
  setCell(row, indexMap, "deal cast lần i", input.profile.dealStatus || "");
  setCellByIndex(row, 13, input.profile.cashOfferRealityRoundTwo || "");
  setCellByIndex(row, 14, input.profile.dealStatusRoundTwo || "");
  setCell(row, indexMap, "support chính mức offer", input.profile.supportMainOfferNote || "");
  setCell(row, indexMap, "stk", input.contract?.bankAccountNumber || "");
  setCell(row, indexMap, "bank", input.contract?.bankName || "");
  return row;
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

    let processedRows = 0;
    let updatedProfiles = 0;
    let updatedEmployees = 0;
    let createdEmployees = 0;
    let updatedContracts = 0;
    let skippedRows = 0;

    async function importHostRows() {
      const header = hostValues[0] || [];
      const indexMap = buildIndexMap(header);
      for (const [index, row] of hostValues.slice(1).entries()) {
        const rowNumber = index + 2;
        const employeeId = getColumn(row, indexMap, "mã nhân viên");
        if (!employeeId) continue;
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
              sheetContractCode: "",
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
              cashOfferRealityRoundTwo: getColumnByIndex(row, 13),
              dealStatusRoundTwo: getColumnByIndex(row, 14),
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

    const result = {
      success: true,
      spreadsheetId,
      dryRun,
      processedRows,
      updatedProfiles,
      updatedEmployees,
      createdEmployees,
      updatedContracts,
      skippedRows,
      message: dryRun
        ? `Dry run: sẽ sync ${updatedProfiles} hồ sơ tuyển dụng, ${updatedEmployees} nhân viên cập nhật, ${createdEmployees} nhân viên tạo mới từ 2 tab nguồn.`
        : `Đã sync ${updatedProfiles} hồ sơ tuyển dụng, ${updatedEmployees} nhân viên cập nhật, ${createdEmployees} nhân viên tạo mới từ 2 tab nguồn.`
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

export async function syncRecruitmentProfilesToSheets(actorAccountKey: string): Promise<RecruitmentSheetPushSummary> {
  const runId = randomUUID();
  const startedAt = new Date();
  const conflicts: RecruitmentSheetSyncConflict[] = [];

  try {
    const [{ spreadsheetId, values: hostValues }, { values: supportValues }, profiles, contractProfiles, applications] = await Promise.all([
      readSheet(HOST_TAB_NAME),
      readSheet(SUPPORT_TAB_NAME),
      listRecruitmentProfiles(),
      listEmployeeContractProfiles(),
      listPeopleApplications()
    ]);

    const contractByKey = new Map(
      contractProfiles.map((item) => [item.personKey, item] as const)
    );
    const appByKey = new Map(
      applications.map((item) => [`${item.role}:${item.employeeId || ""}`.toLowerCase(), item] as const)
    );

    const hostHeader = hostValues[0] || [];
    const supportHeader = supportValues[0] || [];
    const hostIndexMap = buildIndexMap(hostHeader);
    const supportIndexMap = buildIndexMap(supportHeader);
    const hostRows = rowMatchByEmployeeId(hostValues, hostIndexMap);
    const supportRows = rowMatchByEmployeeId(supportValues, supportIndexMap);

    const updatePayloads: Array<{ range: string; values: string[][] }> = [];
    const appendHostRows: string[][] = [];
    const appendSupportRows: string[][] = [];
    let updatedSheetRows = 0;
    let appendedSheetRows = 0;
    let skippedRows = 0;

    profiles.forEach((profile) => {
      const key = employeeContractPersonKey(profile.role, profile.employeeId);
      const contract = contractByKey.get(key);
      const application = appByKey.get(`${profile.role}:${profile.employeeId}`.toLowerCase());
      const tabName = profile.role === "host" ? HOST_TAB_NAME : SUPPORT_TAB_NAME;
      const rowMap = profile.role === "host" ? hostRows : supportRows;
      const header = profile.role === "host" ? hostHeader : supportHeader;
      const indexMap = profile.role === "host" ? hostIndexMap : supportIndexMap;
      const existingRow = rowMap.get(profile.employeeId.toUpperCase());

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
        const nextRow = buildHostSheetRow({ header, currentRow: existingRow?.values, profile, contract });
        if (existingRow) {
          compareAndTrackOverwrite({
            nextRow,
            currentRow: existingRow.values,
            indexMap,
            columns: [
              "họ và tên đầy đủ",
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
              "gmail"
            ],
            runId,
            role: profile.role,
            employeeId: profile.employeeId,
            direction: "website_to_sheet",
            tabName,
            rowNumber: existingRow.rowNumber,
            conflicts
          });
          updatePayloads.push({
            range: `'${tabName}'!A${existingRow.rowNumber}:AZ${existingRow.rowNumber}`,
            values: [nextRow]
          });
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
      } else {
        const nextRow = buildSupportSheetRow({ header, currentRow: existingRow?.values, profile, contract });
        if (existingRow) {
          compareAndTrackOverwrite({
            nextRow,
            currentRow: existingRow.values,
            indexMap,
            columns: [
              "tên",
              "sđt",
              "level",
              "lương mong muốn theo giờ",
              "kinh nghiệm",
              "kết quả đánh giá",
              "cash offer (by gem)",
              "cash offer (reality) lần i",
              "deal cast lần i",
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
          updatePayloads.push({
            range: `'${tabName}'!A${existingRow.rowNumber}:AZ${existingRow.rowNumber}`,
            values: [nextRow]
          });
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
      }

      if (!application && !contract && !profile.phone) {
        skippedRows += 1;
      }
    });

    await applySheetUpdates(spreadsheetId, updatePayloads);
    await Promise.all([
      appendSheetRows(HOST_TAB_NAME, spreadsheetId, appendHostRows),
      appendSheetRows(SUPPORT_TAB_NAME, spreadsheetId, appendSupportRows)
    ]);

    const result = {
      success: true,
      spreadsheetId,
      updatedSheetRows,
      appendedSheetRows,
      skippedRows,
      message: appendedSheetRows > 0
        ? `Đã đẩy ${updatedSheetRows} dòng và tạo mới ${appendedSheetRows} dòng tuyển dụng lên sheet nguồn.`
        : `Đã đẩy ${updatedSheetRows} dòng tuyển dụng lên sheet nguồn.`
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
