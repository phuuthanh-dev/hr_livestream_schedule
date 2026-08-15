import { getGoogleSheetsSpreadsheetId, createGoogleSheetsClient } from "@/lib/googleSheets";
import { listSchedulePeopleForAdmin } from "@/lib/employeeRoster";
import { getMongoDatabase } from "@/lib/mongodb";
import { DEFAULT_SCHEDULE_SLOTS } from "@/lib/scheduleConfig";
import { addDaysToScheduleDateKey, getScheduleWeekStartKey, isValidScheduleDateKey } from "@/lib/scheduleDate";
import type { AvailabilityLocationPreference, EmployeeRole } from "@/lib/types";

const HOST_TAB_NAME = "Collect lịch live chính";
const SUPPORT_TAB_NAME = "Collect lịch sp live";

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

type ParsedSheetRow = {
  dateKey: string;
  slots: Map<string, string[]>;
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

async function getSubmittedAvailabilityForWeek(weekStartKey: string) {
  const database = await getMongoDatabase();
  const weeks = database.collection<{
    personKey: string;
    status: string;
  }>("schedule_availability_weeks");
  const slots = database.collection<{
    role: EmployeeRole;
    employeeId: string;
    dateKey: string;
    slot: string;
    weekStartKey: string;
    personKey: string;
  }>("schedule_availability_slots");

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
  matrix: ReturnType<typeof buildCollectMatrix>
) {
  const spreadsheetId = getGoogleSheetsSpreadsheetId();
  const sheets = createGoogleSheetsClient();
  const rowMap = await readSheetDateRows(tabName);
  const data = matrix.map((row) => {
    const rowNumber = rowMap.get(row.dateKey);
    if (!rowNumber) {
      throw new Error(`Không tìm thấy ngày ${formatSheetDate(row.dateKey)} trong tab ${tabName}.`);
    }
    return {
      range: `'${tabName}'!C${rowNumber}:K${rowNumber}`,
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
  requestedWeekStartKey?: string
): Promise<SheetAvailabilityImportSummary> {
  const spreadsheetId = getGoogleSheetsSpreadsheetId();
  const [hostValues, supportValues] = await Promise.all([
    readCollectSheet(HOST_TAB_NAME),
    readCollectSheet(SUPPORT_TAB_NAME)
  ]);
  const hostParsed = parseCollectRows(hostValues);
  const supportParsed = parseCollectRows(supportValues);
  const targetWeekStartKey = requestedWeekStartKey ? getScheduleWeekStartKey(requestedWeekStartKey) : "";
  const targetWeekEndKey = targetWeekStartKey ? addDaysToScheduleDateKey(targetWeekStartKey, 6) : "";
  const roster = await listSchedulePeopleForAdmin();
  const rosterByKey = new Map(
    roster.map((person) => [`${person.role}:${person.id.toUpperCase()}`, person] as const)
  );

  const missingEmployees = new Set<string>();
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
  const weeks = database.collection("schedule_availability_weeks");
  const slots = database.collection("schedule_availability_slots");
  const now = new Date();

  let importedSlots = 0;

  for (const entry of availabilityByPersonWeek.values()) {
    const personKey = buildPersonKey(entry.role, entry.employeeId);
    const normalizedEmployeeId = entry.employeeId.toLowerCase();
    importedSlots += entry.slots.length;

    await weeks.updateOne(
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
    );

    await slots.deleteMany({ personKey, weekStartKey: entry.weekStartKey });

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

  return {
    success: true,
    spreadsheetId,
    importedWeeks: new Set(Array.from(availabilityByPersonWeek.values()).map((item) => item.weekStartKey)).size,
    importedPeople: availabilityByPersonWeek.size,
    importedSlots,
    skippedUnknownEmployees: Array.from(missingEmployees).sort(),
    skippedInvalidRows: [...hostParsed.invalidRows, ...supportParsed.invalidRows],
    message: `Đã import ${importedSlots} slot lịch rảnh từ 2 tab collect vào Mongo.`
  };
}

export async function syncAvailabilityWeekToCollectSheets(weekStartKey: string): Promise<SheetAvailabilitySyncSummary> {
  const spreadsheetId = getGoogleSheetsSpreadsheetId();
  const slotDocuments = await getSubmittedAvailabilityForWeek(weekStartKey);
  const hostMatrix = buildCollectMatrix("host", weekStartKey, slotDocuments);
  const supportMatrix = buildCollectMatrix("support", weekStartKey, slotDocuments);

  await Promise.all([
    updateCollectTabWeek(HOST_TAB_NAME, weekStartKey, hostMatrix),
    updateCollectTabWeek(SUPPORT_TAB_NAME, weekStartKey, supportMatrix)
  ]);

  return {
    success: true,
    spreadsheetId,
    weekStartKey,
    hostRowsUpdated: hostMatrix.length,
    supportRowsUpdated: supportMatrix.length,
    message: `Đã đồng bộ tuần ${formatSheetDate(weekStartKey)} lên 2 tab collect.`
  };
}
