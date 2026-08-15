import { randomUUID } from "node:crypto";
import { createGoogleSheetsClient, getGoogleSheetsSpreadsheetId } from "@/lib/googleSheets";
import {
  employeeContractPersonKey,
  listEmployeeContractProfiles,
  upsertEmployeeContractProfileFields
} from "@/lib/employeeContract";
import { findSchedulePerson } from "@/lib/employeeRoster";
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
  processedRows: number;
  updatedProfiles: number;
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

function getColumn(row: string[], indexMap: Map<string, number>, ...names: string[]) {
  for (const name of names) {
    const index = indexMap.get(name);
    if (index !== undefined) return normalizeText(row[index]);
  }
  return "";
}

function buildIndexMap(header: string[]) {
  return new Map(header.map((cell, index) => [normalizeHeader(cell), index] as const));
}

async function readSheet(tabName: string): Promise<SheetReadResult> {
  const sheets = createGoogleSheetsClient();
  const spreadsheetId = getGoogleSheetsSpreadsheetId();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A:Z`
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

function buildHostSheetRow(input: {
  header: string[];
  currentRow?: string[];
  profile: Awaited<ReturnType<typeof listRecruitmentProfiles>>[number];
  contract?: Awaited<ReturnType<typeof listEmployeeContractProfiles>>[number];
}) {
  const row = input.currentRow ? [...input.currentRow] : new Array(input.header.length).fill("");
  const indexMap = buildIndexMap(input.header);
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
  setCell(row, indexMap, "rating", input.profile.rating);
  setCell(row, indexMap, "live tại nhà", formatBooleanCell(input.profile.canLiveHome));
  setCell(row, indexMap, "live tại studio", formatBooleanCell(input.profile.canLiveStudio));
  setCell(row, indexMap, "đã tham gia training", formatBooleanCell(input.profile.trainingJoined));
  setCell(row, indexMap, "note", input.profile.notes);
  setCell(row, indexMap, "live_channel_id", input.profile.liveChannelId);
  setCell(row, indexMap, "gmail", input.contract?.gmail || input.profile.email || "");
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
    range: `'${tabName}'!A:Z`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows
    }
  });
}

export async function importRecruitmentProfilesFromSheets(actorAccountKey: string): Promise<ImportSummary> {
  const runId = randomUUID();
  const startedAt = new Date();
  const conflicts: RecruitmentSheetSyncConflict[] = [];

  try {
    const [{ spreadsheetId, values: hostValues }, { values: supportValues }] = await Promise.all([
      readSheet(HOST_TAB_NAME),
      readSheet(SUPPORT_TAB_NAME)
    ]);

    let processedRows = 0;
    let updatedProfiles = 0;
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
        const person = await findSchedulePerson("host", employeeId);
        if (!person) {
          skippedRows += 1;
          conflicts.push(buildConflict(
            runId,
            "sheet_to_website",
            "unknown_employee",
            `Không tìm thấy host ${employeeId} trong website khi kéo từ sheet.`,
            { role: "host", employeeId, tabName: HOST_TAB_NAME, rowNumber }
          ));
          continue;
        }

        await upsertRecruitmentProfile({
          role: "host",
          employeeId,
          actorAccountKey,
          values: {
            fullName: getColumn(row, indexMap, "họ và tên đầy đủ") || person.name,
            aliasName: getColumn(row, indexMap, "tên gọi khác"),
            phone: getColumn(row, indexMap, "sđt") || person.phone || "",
            email: getColumn(row, indexMap, "gmail"),
            cvUrl: getColumn(row, indexMap, "cv"),
            experience: getColumn(row, indexMap, "kinh nghiệm"),
            achievements: getColumn(row, indexMap, "thành tích"),
            expectedSalary: getColumn(row, indexMap, "lương mong muốn"),
            introVideoUrl: getColumn(row, indexMap, "link"),
            tiktokUrl: getColumn(row, indexMap, "link tiktok"),
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
        updatedProfiles += 1;

        const gmail = getColumn(row, indexMap, "gmail");
        if (gmail) {
          await upsertEmployeeContractProfileFields({
            person,
            actorAccountKey,
            gmail
          });
          updatedContracts += 1;
        } else {
          conflicts.push(buildConflict(
            runId,
            "sheet_to_website",
            "missing_contract_profile",
            `Host ${employeeId} chưa có Gmail để cập nhật hồ sơ hợp đồng.`,
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
        const person = await findSchedulePerson("support", employeeId);
        if (!person) {
          skippedRows += 1;
          conflicts.push(buildConflict(
            runId,
            "sheet_to_website",
            "unknown_employee",
            `Không tìm thấy support ${employeeId} trong website khi kéo từ sheet.`,
            { role: "support", employeeId, tabName: SUPPORT_TAB_NAME, rowNumber }
          ));
          continue;
        }

        await upsertRecruitmentProfile({
          role: "support",
          employeeId,
          actorAccountKey,
          values: {
            fullName: getColumn(row, indexMap, "tên") || person.name,
            aliasName: "",
            phone: getColumn(row, indexMap, "sđt") || person.phone || "",
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
            supportMainOfferNote: getColumn(row, indexMap, "support chính mức offer"),
            notes: "",
            sourceTab: SUPPORT_TAB_NAME
          }
        });
        updatedProfiles += 1;

        const bankAccountNumber = getColumn(row, indexMap, "stk");
        const bankName = getColumn(row, indexMap, "bank");
        if (bankAccountNumber || bankName) {
          await upsertEmployeeContractProfileFields({
            person,
            actorAccountKey,
            bankAccountNumber,
            bankName
          });
          updatedContracts += 1;
        } else {
          conflicts.push(buildConflict(
            runId,
            "sheet_to_website",
            "missing_contract_profile",
            `Support ${employeeId} chưa có STK/Bank để cập nhật hồ sơ hợp đồng.`,
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
      processedRows,
      updatedProfiles,
      updatedContracts,
      skippedRows,
      message: `Đã kéo ${updatedProfiles} hồ sơ tuyển dụng từ 2 tab nguồn vào website.`
    };

    await persistSyncRun({
      run: {
        runId,
        direction: "sheet_to_website",
        operation: "import_profiles",
        spreadsheetId,
        actorAccountKey,
        success: true,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        processedRows,
        updatedProfiles,
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
          operation: "import_profiles",
          spreadsheetId,
          actorAccountKey,
          success: false,
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          processedRows: 0,
          updatedProfiles: 0,
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
            range: `'${tabName}'!A${existingRow.rowNumber}:Z${existingRow.rowNumber}`,
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
            range: `'${tabName}'!A${existingRow.rowNumber}:Z${existingRow.rowNumber}`,
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
