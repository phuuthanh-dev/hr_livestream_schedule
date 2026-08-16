import { randomUUID } from "node:crypto";
import { getGoogleSheetsSpreadsheetId, createGoogleSheetsClient } from "@/lib/googleSheets";
import { listSchedulePeopleForAdmin } from "@/lib/employeeRoster";
import { getMongoDatabase } from "@/lib/mongodb";
import { DEFAULT_SCHEDULE_SLOTS } from "@/lib/scheduleConfig";
import { addDaysToScheduleDateKey, getScheduleWeekStartKey, isValidScheduleDateKey } from "@/lib/scheduleDate";
import type {
  AvailabilityLocationPreference,
  AvailabilitySheetSyncConflict,
  AvailabilitySheetSyncConflictKind,
  AvailabilitySheetSyncDirection,
  AvailabilitySheetSyncLogsPayload,
  AvailabilitySheetSyncOperation,
  AvailabilitySheetSyncRun,
  EmployeeRole
} from "@/lib/types";

const HOST_TAB_NAME = "Collect lịch live chính";
const SUPPORT_TAB_NAME = "Collect lịch sp live";
const SYNC_RUNS_COLLECTION = "availability_sheet_sync_runs";
const SYNC_CONFLICTS_COLLECTION = "availability_sheet_sync_conflicts";

type ImportedAvailabilitySlot = {
  dateKey: string;
  slot: string;
  available: true;
  locationPreference?: AvailabilityLocationPreference;
};

type SheetAvailabilityImportSummary = {
  success: boolean;
  spreadsheetId: string;
  importedWeeks: number;
  importedPeople: number;
  importedSlots: number;
  skippedProtectedWeeks: number;
  skippedUnknownEmployees: string[];
  skippedInvalidRows: string[];
  message?: string;
};

export type SheetAvailabilitySyncSummary = {
  success: boolean;
  spreadsheetId: string;
  weekStartKey: string;
  hostRowsUpdated: number;
  supportRowsUpdated: number;
  message?: string;
};

type AvailabilityImportOptions = {
  force?: boolean;
};

type ParsedSheetRow = {
  dateKey: string;
  slots: Map<string, string[]>;
};

type StoredAvailabilitySlotDocument = {
  role: EmployeeRole;
  employeeId: string;
  dateKey: string;
  slot: string;
  weekStartKey: string;
  personKey: string;
  locationPreference?: string;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function normalizeSlotHeader(value: unknown) {
  return normalizeText(value).replace(/\*/g, "");
}

function parseDateCell(value: unknown) {
  const text = normalizeText(value);
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  const dateKey = `${match[3]}-${match[2]}-${match[1]}`;
  return isValidScheduleDateKey(dateKey) ? dateKey : "";
}

function formatSheetDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

function parseEmployeeIds(value: unknown) {
  return normalizeText(value)
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function buildPersonKey(role: EmployeeRole, employeeId: string) {
  return `${role}:${employeeId.trim().toLowerCase()}`;
}

function locationPreferenceFromWorkLocation(workLocation?: string): AvailabilityLocationPreference | undefined {
  const normalized = normalizeText(workLocation).toLowerCase();
  if (normalized === "home") return "home";
  if (normalized === "studio") return "studio";
  if (normalized === "both") return "home";
  return undefined;
}

async function readCollectSheet(tabName: string) {
  const spreadsheetId = getGoogleSheetsSpreadsheetId();
  const sheets = createGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A:K`
  });
  return response.data.values || [];
}

function parseCollectRows(values: string[][]) {
  if (values.length === 0) {
    throw new Error("Tab collect đang trống.");
  }

  const headerRow = values[0] || [];
  const slotHeaders = headerRow.slice(2).map(normalizeSlotHeader);
  const slotIndexes = slotHeaders
    .map((slot, index) => ({ slot, index: index + 2 }))
    .filter((item) => DEFAULT_SCHEDULE_SLOTS.includes(item.slot as (typeof DEFAULT_SCHEDULE_SLOTS)[number]));

  const parsedRows: ParsedSheetRow[] = [];
  const invalidRows: string[] = [];

  values.slice(1).forEach((row, rowIndex) => {
    const dateKey = parseDateCell(row[1]);
    if (!dateKey) {
      if (row.some((cell) => normalizeText(cell))) {
        invalidRows.push(`Dòng ${rowIndex + 2}: ngày không hợp lệ.`);
      }
      return;
    }

    const slots = new Map<string, string[]>();
    slotIndexes.forEach(({ slot, index }) => {
      const employeeIds = parseEmployeeIds(row[index]);
      if (employeeIds.length > 0) {
        slots.set(slot, employeeIds);
      }
    });
    parsedRows.push({ dateKey, slots });
  });

  return { parsedRows, invalidRows };
}

async function readSheetDateRows(tabName: string) {
  const values = await readCollectSheet(tabName);
  const rows = new Map<string, number>();
  values.slice(1).forEach((row, index) => {
    const dateKey = parseDateCell(row[1]);
    if (dateKey) {
      rows.set(dateKey, index + 2);
    }
  });
  return rows;
}

async function readSheetWeekRows(tabName: string, weekStartKey: string) {
  const values = await readCollectSheet(tabName);
  const targetDates = new Set(Array.from({ length: 7 }, (_, index) => addDaysToScheduleDateKey(weekStartKey, index)));
  const rows = new Map<string, { rowNumber: number; values: string[] }>();
  values.slice(1).forEach((row, index) => {
    const dateKey = parseDateCell(row[1]);
    if (dateKey && targetDates.has(dateKey)) {
      rows.set(dateKey, { rowNumber: index + 2, values: row.map((cell) => normalizeText(cell)) });
    }
  });
  return rows;
}

async function getSubmittedAvailabilityForWeek(weekStartKey: string) {
  const database = await getMongoDatabase();
  const weeks = database.collection<{
    personKey: string;
    status: string;
  }>("schedule_availability_weeks");
  const slots = database.collection<StoredAvailabilitySlotDocument>("schedule_availability_slots");

  const submittedWeeks = await weeks.find({
    weekStartKey,
    status: { $in: ["submitted", "locked"] }
  }).toArray();
  const personKeys = submittedWeeks.map((item) => item.personKey);
  if (personKeys.length === 0) {
    return [];
  }

  return slots.find({
    weekStartKey,
    personKey: { $in: personKeys }
  }).toArray();
}

async function ensureSyncIndexes() {
  const database = await getMongoDatabase();
  await Promise.all([
    database.collection(SYNC_RUNS_COLLECTION).createIndex({ finishedAt: -1 }),
    database.collection(SYNC_RUNS_COLLECTION).createIndex({ weekStartKey: 1, finishedAt: -1 }),
    database.collection(SYNC_CONFLICTS_COLLECTION).createIndex({ runId: 1, createdAt: -1 }),
    database.collection(SYNC_CONFLICTS_COLLECTION).createIndex({ weekStartKey: 1, createdAt: -1 })
  ]);
}

function slotSignature(slots: Array<{ dateKey: string; slot: string; locationPreference?: string }>) {
  return slots
    .map((item) => `${item.dateKey}|${item.slot}|${normalizeText(item.locationPreference)}`)
    .sort()
    .join(";");
}

function buildConflict(
  runId: string,
  direction: AvailabilitySheetSyncDirection,
  kind: AvailabilitySheetSyncConflictKind,
  details: string,
  input: Partial<Omit<AvailabilitySheetSyncConflict, "runId" | "direction" | "kind" | "details" | "createdAt">> = {}
): AvailabilitySheetSyncConflict {
  return {
    runId,
    direction,
    kind,
    details,
    createdAt: new Date().toISOString(),
    ...input
  };
}

async function persistSyncRun(input: {
  run: AvailabilitySheetSyncRun;
  conflicts: AvailabilitySheetSyncConflict[];
}) {
  await ensureSyncIndexes();
  const database = await getMongoDatabase();
  await database.collection<AvailabilitySheetSyncRun>(SYNC_RUNS_COLLECTION).insertOne(input.run);
  if (input.conflicts.length > 0) {
    await database.collection<AvailabilitySheetSyncConflict>(SYNC_CONFLICTS_COLLECTION).insertMany(input.conflicts);
  }
}

function buildCollectMatrix(
  role: EmployeeRole,
  weekStartKey: string,
  slotDocuments: Awaited<ReturnType<typeof getSubmittedAvailabilityForWeek>>
) {
  const rows = new Map<string, Map<string, string[]>>();
  slotDocuments
    .filter((item) => item.role === role)
    .forEach((item) => {
      const row = rows.get(item.dateKey) || new Map<string, string[]>();
      const bucket = row.get(item.slot) || [];
      if (!bucket.includes(item.employeeId)) {
        bucket.push(item.employeeId);
      }
      row.set(item.slot, bucket);
      rows.set(item.dateKey, row);
    });

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${weekStartKey}T12:00:00+07:00`);
    date.setDate(date.getDate() + index);
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const row = rows.get(dateKey) || new Map<string, string[]>();
    return {
      dateKey,
      values: DEFAULT_SCHEDULE_SLOTS.map((slot) =>
        (row.get(slot) || []).slice().sort((left, right) => left.localeCompare(right, "vi")).join(", ")
      )
    };
  });
}

async function updateCollectTabWeek(
  tabName: string,
  weekStartKey: string,
  matrix: ReturnType<typeof buildCollectMatrix>,
  runId: string,
  conflicts: AvailabilitySheetSyncConflict[]
) {
  const spreadsheetId = getGoogleSheetsSpreadsheetId();
  const sheets = createGoogleSheetsClient();
  const rowMap = await readSheetWeekRows(tabName, weekStartKey);
  const data = matrix.map((row) => {
    const sheetRow = rowMap.get(row.dateKey);
    if (!sheetRow) {
      conflicts.push(buildConflict(
        runId,
        "website_to_sheet",
        "missing_sheet_row",
        `Không tìm thấy ngày ${formatSheetDate(row.dateKey)} trong tab ${tabName}.`,
        { weekStartKey, dateKey: row.dateKey, tabName }
      ));
      throw new Error(`Không tìm thấy ngày ${formatSheetDate(row.dateKey)} trong tab ${tabName}.`);
    }
    const currentValues = sheetRow.values.slice(2, 11).map((value) => normalizeText(value));
    const desiredValues = row.values.map((value) => normalizeText(value));
    desiredValues.forEach((value, index) => {
      if (currentValues[index] !== value) {
        conflicts.push(buildConflict(
          runId,
          "website_to_sheet",
          "sheet_overwrite",
          `Website ghi đè ô ${DEFAULT_SCHEDULE_SLOTS[index]} ngày ${formatSheetDate(row.dateKey)} từ "${currentValues[index] || "(trống)"}" thành "${value || "(trống)"}".`,
          {
            weekStartKey,
            dateKey: row.dateKey,
            slot: DEFAULT_SCHEDULE_SLOTS[index],
            tabName,
            rowNumber: sheetRow.rowNumber
          }
        ));
      }
    });
    return {
      range: `'${tabName}'!C${sheetRow.rowNumber}:K${sheetRow.rowNumber}`,
      values: [row.values]
    };
  });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data
    }
  });
}

export async function importAvailabilityFromCollectSheets(
  actorAccountKey: string,
  requestedWeekStartKey?: string,
  options: AvailabilityImportOptions = {}
): Promise<SheetAvailabilityImportSummary> {
  const runId = randomUUID();
  const startedAt = new Date();
  const spreadsheetId = getGoogleSheetsSpreadsheetId();
  const targetWeekStartKey = requestedWeekStartKey ? getScheduleWeekStartKey(requestedWeekStartKey) : "";
  const conflicts: AvailabilitySheetSyncConflict[] = [];

  try {
    const [hostValues, supportValues] = await Promise.all([
      readCollectSheet(HOST_TAB_NAME),
      readCollectSheet(SUPPORT_TAB_NAME)
    ]);
    const hostParsed = parseCollectRows(hostValues);
    const supportParsed = parseCollectRows(supportValues);
    const targetWeekEndKey = targetWeekStartKey ? addDaysToScheduleDateKey(targetWeekStartKey, 6) : "";
    const roster = await listSchedulePeopleForAdmin();
    const rosterByKey = new Map(
      roster.map((person) => [`${person.role}:${person.id.toUpperCase()}`, person] as const)
    );
    [...hostParsed.invalidRows, ...supportParsed.invalidRows].forEach((details) => {
      conflicts.push(buildConflict(runId, "sheet_to_website", "invalid_row", details, {
        weekStartKey: targetWeekStartKey || undefined
      }));
    });

    const missingEmployees = new Set<string>();
    const protectedWeeks = new Set<string>();
    const availabilityByPersonWeek = new Map<string, {
      role: EmployeeRole;
      employeeId: string;
      weekStartKey: string;
      slots: ImportedAvailabilitySlot[];
    }>();

    async function addSheetRows(role: EmployeeRole, rows: ParsedSheetRow[]) {
      for (const row of rows) {
        const weekStartKey = getScheduleWeekStartKey(row.dateKey);
        if (targetWeekStartKey && (weekStartKey < targetWeekStartKey || weekStartKey > targetWeekEndKey)) {
          continue;
        }
        for (const [slot, employeeIds] of row.slots.entries()) {
          for (const employeeId of employeeIds) {
            const person = rosterByKey.get(`${role}:${employeeId}`);
            if (!person) {
              missingEmployees.add(`${role}:${employeeId}`);
              conflicts.push(buildConflict(
                runId,
                "sheet_to_website",
                "unknown_employee",
                `Không tìm thấy ${role} ${employeeId} trong website khi import từ sheet.`,
                { weekStartKey, role, employeeId, dateKey: row.dateKey, slot }
              ));
              continue;
            }

            const key = `${role}:${person.id}:${weekStartKey}`;
            const bucket = availabilityByPersonWeek.get(key) || {
              role,
              employeeId: person.id,
              weekStartKey,
              slots: []
            };

            const slotKey = `${row.dateKey}__${slot}`;
            if (!bucket.slots.some((item) => `${item.dateKey}__${item.slot}` === slotKey)) {
              bucket.slots.push({
                dateKey: row.dateKey,
                slot,
                available: true,
                locationPreference: role === "host"
                  ? locationPreferenceFromWorkLocation(person.workLocation)
                  : undefined
              });
            }

            availabilityByPersonWeek.set(key, bucket);
          }
        }
      }
    }

    await addSheetRows("host", hostParsed.parsedRows);
    await addSheetRows("support", supportParsed.parsedRows);

    const database = await getMongoDatabase();
    const weeks = database.collection<{
      personKey: string;
      weekStartKey: string;
      status?: string;
      submittedAt?: Date;
      lockedAt?: Date | null;
    }>("schedule_availability_weeks");
    const slots = database.collection<StoredAvailabilitySlotDocument>("schedule_availability_slots");
    const now = new Date();

    let importedSlots = 0;
    let importedPeople = 0;

    async function writeImportedWeek(entry: {
      role: EmployeeRole;
      employeeId: string;
      weekStartKey: string;
      slots: ImportedAvailabilitySlot[];
    }, personKey: string, normalizedEmployeeId: string) {
      await Promise.all([
        weeks.updateOne(
          { personKey, weekStartKey: entry.weekStartKey },
          {
            $set: {
              role: entry.role,
              employeeId: entry.employeeId,
              normalizedEmployeeId,
              status: "submitted",
              submittedAt: now,
              lockedAt: null,
              lockedReason: "",
              updatedAt: now,
              updatedBy: actorAccountKey
            }
          },
          { upsert: true }
        ),
        slots.deleteMany({ personKey, weekStartKey: entry.weekStartKey })
      ]);

      if (entry.slots.length > 0) {
        await slots.insertMany(
          entry.slots.map((slot) => ({
            personKey,
            role: entry.role,
            employeeId: entry.employeeId,
            normalizedEmployeeId,
            weekStartKey: entry.weekStartKey,
            dateKey: slot.dateKey,
            slot: slot.slot,
            available: true,
            locationPreference: slot.locationPreference,
            updatedAt: now,
            updatedBy: actorAccountKey
          }))
        );
      }
    }

    for (const entry of availabilityByPersonWeek.values()) {
      const personKey = buildPersonKey(entry.role, entry.employeeId);
      const normalizedEmployeeId = entry.employeeId.toLowerCase();
      const [existingWeek, existingSlots] = await Promise.all([
        weeks.findOne({ personKey, weekStartKey: entry.weekStartKey }),
        slots.find({ personKey, weekStartKey: entry.weekStartKey }).toArray()
      ]);
      const existingSignature = slotSignature(existingSlots);
      const importedSignature = slotSignature(entry.slots);
      const hasWebsiteData = Boolean(existingWeek) || existingSlots.length > 0;

      if (hasWebsiteData) {
        if (existingSignature !== importedSignature) {
          if (options.force === true) {
            conflicts.push(buildConflict(
              runId,
              "sheet_to_website",
              "force_import",
              `Force import tuần ${entry.weekStartKey} của ${entry.employeeId}: sheet ghi đè dữ liệu website.`,
              { weekStartKey: entry.weekStartKey, role: entry.role, employeeId: entry.employeeId }
            ));
            await writeImportedWeek(entry, personKey, normalizedEmployeeId);
            importedSlots += entry.slots.length;
            importedPeople += 1;
            continue;
          }

          protectedWeeks.add(`${personKey}:${entry.weekStartKey}`);
          conflicts.push(buildConflict(
            runId,
            "sheet_to_website",
            "import_blocked",
            `Bỏ qua import tuần ${entry.weekStartKey} của ${entry.employeeId} vì website đã có dữ liệu khác sheet.`,
            { weekStartKey: entry.weekStartKey, role: entry.role, employeeId: entry.employeeId }
          ));
          continue;
        }

        conflicts.push(buildConflict(
          runId,
          "sheet_to_website",
          "website_overwrite",
          `Bỏ qua import tuần ${entry.weekStartKey} của ${entry.employeeId} vì website đã có cùng dữ liệu và là nguồn chính.`,
          { weekStartKey: entry.weekStartKey, role: entry.role, employeeId: entry.employeeId }
        ));
        continue;
      }

      importedSlots += entry.slots.length;
      importedPeople += 1;
      await writeImportedWeek(entry, personKey, normalizedEmployeeId);
    }

    const result = {
      success: true,
      spreadsheetId,
      importedWeeks: new Set(
        Array.from(availabilityByPersonWeek.values())
          .filter((item) => !protectedWeeks.has(`${buildPersonKey(item.role, item.employeeId)}:${item.weekStartKey}`))
          .map((item) => item.weekStartKey)
      ).size,
      importedPeople,
      importedSlots,
      skippedProtectedWeeks: protectedWeeks.size,
      skippedUnknownEmployees: Array.from(missingEmployees).sort(),
      skippedInvalidRows: [...hostParsed.invalidRows, ...supportParsed.invalidRows],
      message: options.force === true
        ? `Đã force import ${importedSlots} slot lịch rảnh từ 2 tab collect vào Mongo.`
        : protectedWeeks.size > 0
          ? `Đã import ${importedSlots} slot lịch rảnh từ 2 tab collect vào Mongo. Bỏ qua ${protectedWeeks.size} tuần đã có dữ liệu trên website.`
          : `Đã import ${importedSlots} slot lịch rảnh từ 2 tab collect vào Mongo.`
    };
    await persistSyncRun({
      run: {
        runId,
        direction: "sheet_to_website",
        operation: "import_week",
        weekStartKey: targetWeekStartKey || undefined,
        spreadsheetId,
        actorAccountKey,
        success: true,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        importedWeeks: result.importedWeeks,
        importedPeople: result.importedPeople,
        importedSlots: result.importedSlots,
        conflictCount: conflicts.length,
        message: result.message
      },
      conflicts
    });
    return result;
  } catch (error) {
    try {
      await persistSyncRun({
        run: {
          runId,
          direction: "sheet_to_website",
          operation: "import_week",
          weekStartKey: targetWeekStartKey || undefined,
          spreadsheetId,
          actorAccountKey,
          success: false,
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          importedWeeks: 0,
          importedPeople: 0,
          importedSlots: 0,
          conflictCount: conflicts.length,
          error: error instanceof Error ? error.message : "Không import được lịch rảnh từ Google Sheet."
        },
        conflicts
      });
    } catch {
      // If audit logging also fails, preserve the original import error.
    }
    throw error;
  }
}

export async function syncAvailabilityWeekToCollectSheets(
  weekStartKey: string,
  actorAccountKey = "system"
): Promise<SheetAvailabilitySyncSummary> {
  const runId = randomUUID();
  const startedAt = new Date();
  const spreadsheetId = getGoogleSheetsSpreadsheetId();
  const slotDocuments = await getSubmittedAvailabilityForWeek(weekStartKey);
  const hostMatrix = buildCollectMatrix("host", weekStartKey, slotDocuments);
  const supportMatrix = buildCollectMatrix("support", weekStartKey, slotDocuments);
  const conflicts: AvailabilitySheetSyncConflict[] = [];

  try {
    await Promise.all([
      updateCollectTabWeek(HOST_TAB_NAME, weekStartKey, hostMatrix, runId, conflicts),
      updateCollectTabWeek(SUPPORT_TAB_NAME, weekStartKey, supportMatrix, runId, conflicts)
    ]);

    const result = {
      success: true,
      spreadsheetId,
      weekStartKey,
      hostRowsUpdated: hostMatrix.length,
      supportRowsUpdated: supportMatrix.length,
      message: `Đã đồng bộ tuần ${formatSheetDate(weekStartKey)} lên 2 tab collect.`
    };
    await persistSyncRun({
      run: {
        runId,
        direction: "website_to_sheet",
        operation: "sync_week",
        weekStartKey,
        spreadsheetId,
        actorAccountKey,
        success: true,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        hostRowsUpdated: result.hostRowsUpdated,
        supportRowsUpdated: result.supportRowsUpdated,
        conflictCount: conflicts.length,
        message: result.message
      },
      conflicts
    });
    return result;
  } catch (error) {
    await persistSyncRun({
      run: {
        runId,
        direction: "website_to_sheet",
        operation: "sync_week",
        weekStartKey,
        spreadsheetId,
        actorAccountKey,
        success: false,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        hostRowsUpdated: 0,
        supportRowsUpdated: 0,
        conflictCount: conflicts.length,
        error: error instanceof Error ? error.message : "Không sync được lịch rảnh sang Google Sheet."
      },
      conflicts
    });
    throw error;
  }
}

export async function listAvailabilitySheetSyncLogs(weekStartKey?: string): Promise<AvailabilitySheetSyncLogsPayload> {
  await ensureSyncIndexes();
  const database = await getMongoDatabase();
  const runsQuery = weekStartKey ? { weekStartKey } : {};
  const runs = await database
    .collection<AvailabilitySheetSyncRun>(SYNC_RUNS_COLLECTION)
    .find(runsQuery)
    .sort({ finishedAt: -1 })
    .limit(12)
    .toArray();
  const runIds = runs.map((run) => run.runId);
  const conflicts = runIds.length === 0
    ? []
    : await database
      .collection<AvailabilitySheetSyncConflict>(SYNC_CONFLICTS_COLLECTION)
      .find({ runId: { $in: runIds } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

  return {
    success: true,
    weekStartKey,
    runs,
    conflicts
  };
}
