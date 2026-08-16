import type { AvailabilityLocationPreference, SchedulePerson, ScheduleSession } from "./types";
import { buildScheduleLaneKey, getScheduleSessionLane, type ScheduleLane } from "./scheduleLane.ts";

export type SubmittedScheduleSlot = {
  personKey: string;
  role: "host" | "support";
  employeeId: string;
  dateKey: string;
  slot: string;
  locationPreference?: AvailabilityLocationPreference;
};

export type ScheduleEngineInput = {
  weekStartKey: string;
  todayKey: string;
  slots: readonly string[];
  people: SchedulePerson[];
  availability: SubmittedScheduleSlot[];
  protectedSessions: ScheduleSession[];
};

type HostCandidate = {
  person: SchedulePerson;
  location: ScheduleLane;
};

type GeneratedItem = {
  row: ScheduleSession;
  host?: SchedulePerson;
};

const POSITIVE_TRAINING_VALUES = ["roi", "da training", "da train", "hoan thanh", "completed"];

function normalizeText(value: unknown) {
  return (typeof value === "string" ? value : value == null ? "" : String(value))
    .trim()
    .toLocaleLowerCase("vi")
    .replace(/[đĐ]/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function personKey(role: "host" | "support", employeeId: string) {
  return `${role}:${employeeId.trim().toLowerCase()}`;
}

function hasPositiveStatus(value: unknown, acceptedValues: string[]) {
  const normalized = normalizeText(value);
  return acceptedValues.some((accepted) => normalized === accepted || normalized.includes(accepted));
}

function isQualified(person: SchedulePerson) {
  return person.active !== false;
}

function trainingPriority(value: unknown) {
  return hasPositiveStatus(value, POSITIVE_TRAINING_VALUES) ? 1 : 0;
}

function parseCashOffer(value: unknown) {
  const text = String(value || "").trim();
  const match = text.match(/\d[\d.,]*/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const digits = match[0].replace(/\D/g, "");
  return digits ? Number(digits) : Number.MAX_SAFE_INTEGER;
}

function hostRank(value: unknown) {
  const level = normalizeText(value);
  if (/^s(?:\s|$)/.test(level)) return 5;
  if (/^a(?:\s|$)/.test(level)) return 4;
  if (/^b(?:\s|$)/.test(level)) return 3;
  if (/^c(?:\s|$)/.test(level)) return 2;
  if (level.includes("thu viec") || level.includes("trainee")) return 1;
  return 0;
}

function supportLevel(value: unknown) {
  const match = normalizeText(value).match(/(?:cap|level)?\s*(\d+)/);
  return match ? Number(match[1]) : 0;
}

function isSixHourSupport(person: SchedulePerson) {
  return /_6h$/i.test(person.id.trim());
}

function slotStartMinutes(slot: string) {
  const match = slot.match(/^\s*(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.MAX_SAFE_INTEGER;
}

function slotEndMinutes(slot: string) {
  const match = slot.match(/-\s*(\d{1,2}):(\d{2})\s*$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes === 0 ? 24 * 60 : minutes;
}

function slotsAreAdjacent(left: string, right: string) {
  return slotEndMinutes(left) === slotStartMinutes(right);
}

function dateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

function weekdayLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("vi-VN", { weekday: "long", timeZone: "Asia/Bangkok" })
    .format(new Date(Date.UTC(year, month - 1, day, 5)));
}

function isWeekend(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 5)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function addDateDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 5));
  return date.toISOString().slice(0, 10);
}

function sessionId(dateKey: string, slot: string, lane: ScheduleLane) {
  const start = slotStartMinutes(slot);
  const hours = String(Math.floor(start / 60)).padStart(2, "0");
  const minutes = String(start % 60).padStart(2, "0");
  return `AUTO_${dateKey.replace(/-/g, "")}_${hours}${minutes}_${lane.toUpperCase()}`;
}

function locationForHost(person: SchedulePerson, preference?: AvailabilityLocationPreference) {
  const configured = normalizeText(person.workLocation).replace(/\s+/g, "-");
  if (!configured) return undefined;
  if (configured === "home") return "home" as const;
  if (configured === "both") return preference === "studio" ? "studio" as const : "home" as const;
  return "studio" as const;
}

function formatLocation(person: SchedulePerson, location: "home" | "studio") {
  if (location === "home") return "Home";
  const configured = normalizeText(person.workLocation).replace(/\s+/g, "-");
  if (!configured || configured === "both" || configured === "studio") return "Studio";
  return configured
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, "vi", { sensitivity: "base" });
}

function buildEmptySession(dateKey: string, slot: string, lane: ScheduleLane): ScheduleSession {
  const isStudio = lane === "studio";
  return {
    rowNumber: 0,
    stt: "",
    sessionId: sessionId(dateKey, slot, lane),
    dateKey,
    dateLabel: dateLabel(dateKey),
    weekday: weekdayLabel(dateKey),
    slot,
    slotSortKey: String(slotStartMinutes(slot)).padStart(4, "0"),
    hostId: "",
    hostName: "",
    format: isStudio ? "Studio" : "Home",
    supportId: "",
    supportName: "",
    channel: "",
    scriptUrl: "",
    hostConfirm: "Chưa xác nhận",
    supportConfirm: "Chưa xác nhận",
    backupHostId: "",
    backupHostName: "",
    backupSupportId: "",
    backupSupportName: "",
    supportCandidatePool: "",
    status: "open",
    generatedBy: "website",
    isHostConfirmed: false,
    isSupportConfirmed: false,
    canConfirmHost: false,
    canConfirmSupport: false,
    supportRequired: isStudio,
    isSupportOnly: false,
    missingSupport: isStudio,
    warningLevel: "danger",
    warnings: []
  };
}

function addCount(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) || 0) + 1);
}

function getCount(map: Map<string, number>, key: string) {
  return map.get(key) || 0;
}

function partitionStudioRun(length: number, weekend: boolean) {
  if (!weekend) return Array.from({ length: Math.floor(length / 2) }, () => 2);
  if (length < 2) return [];
  if (length % 2 === 0) return Array.from({ length: length / 2 }, () => 2);
  if (length === 3) return [3];
  return [3, ...Array.from({ length: (length - 3) / 2 }, () => 2)];
}

export function generateSchedule(input: ScheduleEngineInput): ScheduleSession[] {
  const peopleByKey = new Map(input.people.map((person) => [personKey(person.role, person.id), person]));
  const allowedSlots = new Set(input.slots);
  const weekEndKey = addDateDays(input.weekStartKey, 6);
  const submittedSlots = input.availability.filter((item) =>
    item.dateKey > input.todayKey
    && item.dateKey >= input.weekStartKey
    && item.dateKey <= weekEndKey
    && allowedSlots.has(item.slot)
  );
  const hostSlots = new Map<string, SubmittedScheduleSlot[]>();
  const supportAvailability = new Set<string>();
  const supportSlotKeys = new Set<string>();

  submittedSlots.forEach((item) => {
    if (item.role === "host") {
      const person = peopleByKey.get(personKey("host", item.employeeId));
      if (!person || person.role !== "host" || !isQualified(person)) return;
      const location = locationForHost(person, item.locationPreference);
      if (!location) return;
      const key = buildScheduleLaneKey(item.dateKey, item.slot, location);
      const bucket = hostSlots.get(key) || [];
      bucket.push(item);
      hostSlots.set(key, bucket);
    } else {
      const slotKey = buildScheduleLaneKey(item.dateKey, item.slot, "studio");
      supportAvailability.add(`${personKey("support", item.employeeId)}__${item.dateKey}__${item.slot}`);
      supportSlotKeys.add(slotKey);
    }
  });

  const protectedSlotKeys = new Set(
    input.protectedSessions.map((row) => buildScheduleLaneKey(
      row.dateKey,
      row.slot,
      getScheduleSessionLane(row)
    ))
  );
  const hostWeekCounts = new Map<string, number>();
  const hostDayCounts = new Map<string, number>();
  const occupiedHosts = new Set<string>();
  const supportWeekCounts = new Map<string, number>();
  const supportUsedDays = new Set<string>();
  const occupiedSupports = new Set<string>();

  input.protectedSessions.forEach((row) => {
    if (row.hostId) {
      const key = personKey("host", row.hostId);
      addCount(hostWeekCounts, key);
      addCount(hostDayCounts, `${key}__${row.dateKey}`);
      occupiedHosts.add(`${key}__${row.dateKey}__${row.slot}`);
    }
    if (row.supportId) {
      const key = personKey("support", row.supportId);
      addCount(supportWeekCounts, key);
      supportUsedDays.add(`${key}__${row.dateKey}`);
      occupiedSupports.add(`${key}__${row.dateKey}__${row.slot}`);
    }
  });

  const demandKeys = new Set([...hostSlots.keys(), ...supportSlotKeys]);
  const demands = Array.from(demandKeys)
    .filter((key) => !protectedSlotKeys.has(key))
    .map((key) => {
      const entries = hostSlots.get(key) || [];
      const [dateKey, slot, laneValue] = key.split("__");
      const lane: ScheduleLane = laneValue === "home" ? "home" : "studio";
      const candidatesByPerson = new Map<string, HostCandidate>();
      entries.forEach((entry) => {
          const person = peopleByKey.get(personKey("host", entry.employeeId));
          if (!person || person.role !== "host" || !isQualified(person)) return;
          const location = locationForHost(person, entry.locationPreference);
          if (!location || location !== lane) return;
          candidatesByPerson.set(personKey("host", person.id), {
            person,
            location
          });
        });
      const candidates = Array.from(candidatesByPerson.values());
      return { dateKey, slot, lane, candidates, hasSupportAvailability: supportSlotKeys.has(key) };
    })
    .sort((left, right) => {
      if (left.candidates.length !== right.candidates.length) return left.candidates.length - right.candidates.length;
      if (left.dateKey !== right.dateKey) return left.dateKey.localeCompare(right.dateKey);
      return slotStartMinutes(left.slot) - slotStartMinutes(right.slot);
    });

  const generated: GeneratedItem[] = [];
  demands.forEach((demand) => {
    const eligible = demand.candidates
      .filter(({ person }) => {
        const key = personKey("host", person.id);
        return getCount(hostDayCounts, `${key}__${demand.dateKey}`) < 2
          && !occupiedHosts.has(`${key}__${demand.dateKey}__${demand.slot}`);
      })
      .sort((left, right) => {
        const rankDifference = hostRank(right.person.level) - hostRank(left.person.level);
        if (rankDifference) return rankDifference;
        const trainingDifference = trainingPriority(right.person.trainingStatus) - trainingPriority(left.person.trainingStatus);
        if (trainingDifference) return trainingDifference;
        const countDifference = getCount(hostWeekCounts, personKey("host", left.person.id))
          - getCount(hostWeekCounts, personKey("host", right.person.id));
        if (countDifference) return countDifference;
        const cashDifference = parseCashOffer(left.person.cashOffer) - parseCashOffer(right.person.cashOffer);
        if (cashDifference) return cashDifference;
        const nameDifference = compareText(left.person.name, right.person.name);
        return nameDifference || compareText(left.person.id, right.person.id);
      });

    const primary = eligible[0];
    const backup = eligible[1];
    const row = buildEmptySession(demand.dateKey, demand.slot, demand.lane);
    if (!primary) {
      row.warnings.push("OPEN_HOST: Không có Host đủ điều kiện để xếp ca.");
      generated.push({ row });
      return;
    }

    const hostKey = personKey("host", primary.person.id);
    row.hostId = primary.person.id;
    row.hostName = primary.person.name;
    row.format = formatLocation(primary.person, primary.location);
    row.channel = primary.person.liveChannelId || "";
    row.canConfirmHost = true;
    row.supportRequired = primary.location === "studio";
    row.missingSupport = row.supportRequired;
    row.backupHostId = backup?.person.id || "";
    row.backupHostName = backup?.person.name || "";
    if (!backup) row.warnings.push("BACKUP_HOST: Chưa có Host dự phòng phù hợp.");
    addCount(hostWeekCounts, hostKey);
    addCount(hostDayCounts, `${hostKey}__${demand.dateKey}`);
    occupiedHosts.add(`${hostKey}__${demand.dateKey}__${demand.slot}`);
    generated.push({ row, host: primary.person });
  });

  const chronological = generated.slice().sort((left, right) => {
    if (left.row.dateKey !== right.row.dateKey) return left.row.dateKey.localeCompare(right.row.dateKey);
    return slotStartMinutes(left.row.slot) - slotStartMinutes(right.row.slot);
  });
  const studioByDate = new Map<string, GeneratedItem[]>();
  chronological.forEach((item) => {
    if (!item.row.supportRequired) return;
    const bucket = studioByDate.get(item.row.dateKey) || [];
    bucket.push(item);
    studioByDate.set(item.row.dateKey, bucket);
  });

  studioByDate.forEach((items, dateKey) => {
    const runs: GeneratedItem[][] = [];
    items.forEach((item) => {
      const current = runs[runs.length - 1];
      if (!current || !slotsAreAdjacent(current[current.length - 1].row.slot, item.row.slot)) {
        runs.push([item]);
      } else {
        current.push(item);
      }
    });

    runs.forEach((run) => {
      let offset = 0;
      const blockSizes = partitionStudioRun(run.length, isWeekend(dateKey));
      blockSizes.forEach((blockSize) => {
        const block = run.slice(offset, offset + blockSize);
        offset += blockSize;
        const hostHasHighRank = block.some((item) => hostRank(item.host?.level) >= 4);
        const candidates = input.people
          .filter((person) => person.role === "support" && isQualified(person))
          .filter((person) => {
            const sixHour = isSixHourSupport(person);
            if (isWeekend(dateKey) && blockSize === 3 && !sixHour) return false;
            if (isWeekend(dateKey) && blockSize === 2 && sixHour) return false;
            const key = personKey("support", person.id);
            if (supportUsedDays.has(`${key}__${dateKey}`)) return false;
            return block.every((item) => supportAvailability.has(`${key}__${dateKey}__${item.row.slot}`)
              && !occupiedSupports.has(`${key}__${dateKey}__${item.row.slot}`));
          })
          .sort((left, right) => {
            const trainingDifference = trainingPriority(right.trainingStatus) - trainingPriority(left.trainingStatus);
            if (trainingDifference) return trainingDifference;
            const cashDifference = parseCashOffer(left.cashOffer) - parseCashOffer(right.cashOffer);
            if (cashDifference) return cashDifference;
            if (hostHasHighRank) {
              const levelDifference = supportLevel(right.level) - supportLevel(left.level);
              if (levelDifference) return levelDifference;
            }
            const countDifference = getCount(supportWeekCounts, personKey("support", left.id))
              - getCount(supportWeekCounts, personKey("support", right.id));
            if (countDifference) return countDifference;
            const nameDifference = compareText(left.name, right.name);
            return nameDifference || compareText(left.id, right.id);
          });

        const primary = candidates[0];
        const backup = candidates[1];
        if (!primary) {
          block.forEach((item) => {
            item.row.warnings.push(
              blockSize === 3
                ? "OPEN_SUPPORT_6H: Không có Support _6H rảnh trọn block 6 giờ cuối tuần."
                : "OPEN_SUPPORT: Không có Support rảnh trọn block 4 giờ."
            );
          });
          return;
        }

        const primaryKey = personKey("support", primary.id);
        supportUsedDays.add(`${primaryKey}__${dateKey}`);
        block.forEach((item) => {
          item.row.supportId = primary.id;
          item.row.supportName = primary.name;
          item.row.backupSupportId = backup?.id || "";
          item.row.backupSupportName = backup?.name || "";
          item.row.supportCandidatePool = candidates.map((person) => person.id).join(", ");
          item.row.canConfirmSupport = true;
          item.row.missingSupport = false;
          addCount(supportWeekCounts, primaryKey);
          occupiedSupports.add(`${primaryKey}__${dateKey}__${item.row.slot}`);
          if (!backup) item.row.warnings.push("BACKUP_SUPPORT: Chưa có Support dự phòng phù hợp.");
        });
      });

      run.slice(offset).forEach((item) => {
        item.row.warnings.push("SUPPORT_SINGLETON: Ca Studio không ghép được block Support liên tục.");
      });
    });
  });

  generated.forEach(({ row }) => {
    row.isSupportOnly = Boolean(!row.hostId && row.supportId);
    row.status = !row.hostId || row.missingSupport ? "open" : "published";
    row.warningLevel = row.status === "open" ? "danger" : row.warnings.length ? "info" : "ok";
  });

  return generated
    .map((item) => item.row)
    .sort((left, right) => {
      if (left.dateKey !== right.dateKey) return left.dateKey.localeCompare(right.dateKey);
      const slotDifference = slotStartMinutes(left.slot) - slotStartMinutes(right.slot);
      if (slotDifference) return slotDifference;
      return getScheduleSessionLane(left).localeCompare(getScheduleSessionLane(right));
    })
    .map((row, index) => ({ ...row, rowNumber: index + 1, stt: String(index + 1) }));
}
