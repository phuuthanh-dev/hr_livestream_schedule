import type { AvailabilityLocationPreference, SchedulePerson, ScheduleSession } from "./types";
import { buildScheduleLaneKey, getScheduleSessionLane, type ScheduleLane } from "./scheduleLane.ts";
import { buildScheduleSessionCode, buildScheduleSessionKey } from "./scheduleSessionCode.ts";

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
  hostCandidates?: HostCandidate[];
};

type SupportSelectionOptions = {
  block: GeneratedItem[];
  dateKey: string;
  weekend: boolean;
  blockSize: number;
  requireSixHour: boolean;
  allowUsedDay: boolean;
  people: SchedulePerson[];
  supportAvailability: Set<string>;
  supportWeekCounts: Map<string, number>;
  supportUsedDays: Set<string>;
  occupiedSupports: Set<string>;
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

function isCriticalHostDemand(slot: string, lane: ScheduleLane) {
  if (lane !== "studio") return false;
  const start = slotStartMinutes(slot);
  return start >= 18 * 60;
}

function buildHostSelectionScore(
  person: SchedulePerson,
  lane: ScheduleLane,
  slot: string,
  weekCount: number,
  dayCount: number
) {
  const rank = hostRank(person.level);
  const training = trainingPriority(person.trainingStatus);
  const cashValue = parseCashOffer(person.cashOffer);
  const noWeeklyLoad = weekCount === 0 ? 1 : 0;
  const underAssigned = weekCount <= 1 ? 1 : 0;
  const freshDay = dayCount === 0 ? 1 : 0;
  const critical = isCriticalHostDemand(slot, lane);

  if (critical) {
    return [
      rank,
      training,
      noWeeklyLoad,
      underAssigned,
      freshDay,
      -weekCount,
      -dayCount,
      -cashValue
    ];
  }

  return [
    noWeeklyLoad,
    underAssigned,
    freshDay,
    -weekCount,
    rank,
    training,
    -dayCount,
    -cashValue
  ];
}

function buildEmptySession(dateKey: string, slot: string, lane: ScheduleLane): ScheduleSession {
  const isStudio = lane === "studio";
  return {
    rowNumber: 0,
    stt: "",
    sessionId: buildScheduleSessionKey(dateKey, slot, lane),
    sessionCode: buildScheduleSessionCode({ dateKey, slot, lane }),
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

function removeCount(map: Map<string, number>, key: string) {
  const next = (map.get(key) || 0) - 1;
  if (next > 0) {
    map.set(key, next);
    return;
  }
  map.delete(key);
}

function partitionStudioRun(length: number, weekend: boolean) {
  if (!weekend) return length >= 2 ? [2] : [];
  // Legacy note:
  // Weekend từng ưu tiên block 3 slot (6 giờ) để ép Support _6H ôm trọn ca dài.
  // Rule đó đã bị tắt vì vận hành mới yêu cầu mọi Support _6H, kể cả cuối tuần,
  // chỉ được xếp tối đa 2 slot liên tiếp (4 giờ). Nếu sau này cần bật lại logic cũ,
  // có thể đổi về thứ tự ưu tiên [3, 2, 1] và khôi phục requireSixHour cho block 3.
  if (length <= 1) return [1];
  return length >= 3 ? [2, 1] : [2];
}

function buildSupportCandidates(options: SupportSelectionOptions) {
  const { block, dateKey, weekend, blockSize, requireSixHour, allowUsedDay, people, supportAvailability, supportWeekCounts, supportUsedDays, occupiedSupports } = options;
  const hostHasHighRank = block.some((item) => hostRank(item.host?.level) >= 4);

  return people
    .filter((person) => person.role === "support" && isQualified(person))
    .filter((person) => {
      const key = personKey("support", person.id);
      const usedDay = supportUsedDays.has(`${key}__${dateKey}`);
      if (!allowUsedDay && usedDay) return false;
      if (requireSixHour && !isSixHourSupport(person)) return false;
      return block.every((item) => supportAvailability.has(`${key}__${dateKey}__${item.row.slot}`)
        && !occupiedSupports.has(`${key}__${dateKey}__${item.row.slot}`));
    })
    .sort((left, right) => {
      const leftKey = personKey("support", left.id);
      const rightKey = personKey("support", right.id);
      const usedDayDifference = Number(supportUsedDays.has(`${leftKey}__${dateKey}`))
        - Number(supportUsedDays.has(`${rightKey}__${dateKey}`));
      if (usedDayDifference) return usedDayDifference;
      const trainingDifference = trainingPriority(right.trainingStatus) - trainingPriority(left.trainingStatus);
      if (trainingDifference) return trainingDifference;
      if (weekend && blockSize === 1) {
        const levelDifference = supportLevel(right.level) - supportLevel(left.level);
        if (levelDifference) return levelDifference;
      }
      const cashDifference = parseCashOffer(left.cashOffer) - parseCashOffer(right.cashOffer);
      if (cashDifference) return cashDifference;
      if (hostHasHighRank) {
        const levelDifference = supportLevel(right.level) - supportLevel(left.level);
        if (levelDifference) return levelDifference;
      }
      const countDifference = getCount(supportWeekCounts, leftKey) - getCount(supportWeekCounts, rightKey);
      if (countDifference) return countDifference;
      const nameDifference = compareText(left.name, right.name);
      return nameDifference || compareText(left.id, right.id);
    });
}

function assignSupportBlock(
  block: GeneratedItem[],
  candidates: SchedulePerson[],
  dateKey: string,
  supportWeekCounts: Map<string, number>,
  supportUsedDays: Set<string>,
  occupiedSupports: Set<string>
) {
  const primary = candidates[0];
  const backup = candidates[1];
  if (!primary) return false;

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
  return true;
}

function assignHostToGeneratedItem(item: GeneratedItem, candidate: HostCandidate) {
  item.host = candidate.person;
  item.row.hostId = candidate.person.id;
  item.row.hostName = candidate.person.name;
  item.row.format = formatLocation(candidate.person, candidate.location);
  item.row.channel = candidate.person.liveChannelId || "";
  item.row.supportRequired = candidate.location === "studio";
  item.row.missingSupport = item.row.supportRequired;
}

function rebalanceHosts(
  generated: GeneratedItem[],
  hostWeekCounts: Map<string, number>,
  hostDayCounts: Map<string, number>,
  occupiedHosts: Set<string>
) {
  const assignedItems = generated
    .filter((item) => item.row.hostId && item.host && item.hostCandidates && item.hostCandidates.length > 1)
    .sort((left, right) => {
      const leftCritical = Number(isCriticalHostDemand(left.row.slot, getScheduleSessionLane(left.row)));
      const rightCritical = Number(isCriticalHostDemand(right.row.slot, getScheduleSessionLane(right.row)));
      if (leftCritical !== rightCritical) return leftCritical - rightCritical;
      if (left.row.dateKey !== right.row.dateKey) return left.row.dateKey.localeCompare(right.row.dateKey);
      return slotStartMinutes(left.row.slot) - slotStartMinutes(right.row.slot);
    });

  assignedItems.forEach((item) => {
    const lane = getScheduleSessionLane(item.row);
    if (isCriticalHostDemand(item.row.slot, lane)) return;
    const currentHost = item.host;
    if (!currentHost) return;
    const hostCandidates = item.hostCandidates || [];
    if (hostCandidates.length < 2) return;

    const currentKey = personKey("host", currentHost.id);
    const currentWeekCount = getCount(hostWeekCounts, currentKey);
    const currentDayKey = `${currentKey}__${item.row.dateKey}`;
    const currentDayCount = getCount(hostDayCounts, currentDayKey);
    const currentRank = hostRank(currentHost.level);

    const replacement = hostCandidates
      .filter((candidate) => candidate.person.id !== currentHost.id)
      .map((candidate) => {
        const candidateKey = personKey("host", candidate.person.id);
        const candidateWeekCount = getCount(hostWeekCounts, candidateKey);
        const candidateDayCount = getCount(hostDayCounts, `${candidateKey}__${item.row.dateKey}`);
        const candidateRank = hostRank(candidate.person.level);
        const qualityDrop = currentRank - candidateRank;

        if (candidateDayCount >= 2) return null;
        if (occupiedHosts.has(`${candidateKey}__${item.row.dateKey}__${item.row.slot}`)) return null;
        if (candidateWeekCount + 1 >= currentWeekCount) return null;
        if (qualityDrop > 1) return null;

        return {
          candidate,
          candidateWeekCount,
          candidateDayCount,
          candidateRank
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((left, right) => {
        if (left.candidateWeekCount !== right.candidateWeekCount) return left.candidateWeekCount - right.candidateWeekCount;
        if (left.candidateDayCount !== right.candidateDayCount) return left.candidateDayCount - right.candidateDayCount;
        if (left.candidateRank !== right.candidateRank) return right.candidateRank - left.candidateRank;
        const leftTraining = trainingPriority(left.candidate.person.trainingStatus);
        const rightTraining = trainingPriority(right.candidate.person.trainingStatus);
        if (leftTraining !== rightTraining) return rightTraining - leftTraining;
        return compareText(left.candidate.person.name, right.candidate.person.name) || compareText(left.candidate.person.id, right.candidate.person.id);
      })[0];

    if (!replacement) return;

    removeCount(hostWeekCounts, currentKey);
    removeCount(hostDayCounts, currentDayKey);
    occupiedHosts.delete(`${currentKey}__${item.row.dateKey}__${item.row.slot}`);

    const nextKey = personKey("host", replacement.candidate.person.id);
    addCount(hostWeekCounts, nextKey);
    addCount(hostDayCounts, `${nextKey}__${item.row.dateKey}`);
    occupiedHosts.add(`${nextKey}__${item.row.dateKey}__${item.row.slot}`);

    assignHostToGeneratedItem(item, replacement.candidate);
    item.row.warnings.push(`HOST_REBALANCED: Chuyển ca để san đều tải tuần từ ${currentHost.id} sang ${replacement.candidate.person.id}.`);
  });
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
        const leftKey = personKey("host", left.person.id);
        const rightKey = personKey("host", right.person.id);
        const leftWeekCount = getCount(hostWeekCounts, leftKey);
        const rightWeekCount = getCount(hostWeekCounts, rightKey);
        const leftDayCount = getCount(hostDayCounts, `${leftKey}__${demand.dateKey}`);
        const rightDayCount = getCount(hostDayCounts, `${rightKey}__${demand.dateKey}`);
        const leftScore = buildHostSelectionScore(left.person, demand.lane, demand.slot, leftWeekCount, leftDayCount);
        const rightScore = buildHostSelectionScore(right.person, demand.lane, demand.slot, rightWeekCount, rightDayCount);

        for (let index = 0; index < leftScore.length; index += 1) {
          const difference = rightScore[index] - leftScore[index];
          if (difference) return difference;
        }

        const nameDifference = compareText(left.person.name, right.person.name);
        return nameDifference || compareText(left.person.id, right.person.id);
      });

    const primary = eligible[0];
    const backup = eligible[1];
    const row = buildEmptySession(demand.dateKey, demand.slot, demand.lane);
    if (!primary) {
      row.warnings.push("OPEN_HOST: Không có Host đủ điều kiện để xếp ca.");
      generated.push({ row, hostCandidates: demand.candidates });
      return;
    }

    const hostKey = personKey("host", primary.person.id);
    assignHostToGeneratedItem({ row }, primary);
    row.canConfirmHost = true;
    row.backupHostId = backup?.person.id || "";
    row.backupHostName = backup?.person.name || "";
    if (!backup) row.warnings.push("BACKUP_HOST: Chưa có Host dự phòng phù hợp.");
    addCount(hostWeekCounts, hostKey);
    addCount(hostDayCounts, `${hostKey}__${demand.dateKey}`);
    occupiedHosts.add(`${hostKey}__${demand.dateKey}__${demand.slot}`);
    generated.push({ row, host: primary.person, hostCandidates: demand.candidates });
  });

  rebalanceHosts(generated, hostWeekCounts, hostDayCounts, occupiedHosts);

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
    const weekend = isWeekend(dateKey);
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
      while (offset < run.length) {
        const remaining = run.length - offset;
        const preferredBlockSizes = partitionStudioRun(remaining, weekend);
        const blockHasHostDemand = (block: GeneratedItem[]) => block.every((item) => Boolean(item.row.hostId));

        let assigned = false;
        preferredBlockSizes.forEach((blockSize) => {
          if (assigned) return;
          const block = run.slice(offset, offset + blockSize);
          const requireSixHour = false;
          const strictCandidates = buildSupportCandidates({
            block,
            dateKey,
            weekend,
            blockSize,
            requireSixHour,
            allowUsedDay: false,
            people: input.people,
            supportAvailability,
            supportWeekCounts,
            supportUsedDays,
            occupiedSupports
          });
          const allowRelaxedWeekday = !weekend && blockHasHostDemand(block);
          const relaxedCandidates = strictCandidates.length > 0 || (!weekend && !allowRelaxedWeekday)
            ? strictCandidates
            : buildSupportCandidates({
              block,
              dateKey,
              weekend,
              blockSize,
              requireSixHour,
              allowUsedDay: true,
              people: input.people,
              supportAvailability,
              supportWeekCounts,
              supportUsedDays,
              occupiedSupports
            });

          if (assignSupportBlock(block, relaxedCandidates, dateKey, supportWeekCounts, supportUsedDays, occupiedSupports)) {
            if (weekend && blockSize === 1) {
              block.forEach((item) => item.row.warnings.push("WEEKEND_SUPPORT_FALLBACK_SINGLE: Cuối tuần không ghép được block dài, đã fallback xếp từng slot."));
            }
            assigned = true;
            offset += blockSize;
            return;
          }
        });

        if (assigned) continue;

        const current = run[offset];
        if (!weekend && !current.row.hostId) {
          current.row.warnings.push("SUPPORT_SINGLETON: Ca Studio không ghép được block Support liên tục.");
          offset += 1;
          continue;
        }

        const singleCandidates = buildSupportCandidates({
          block: [current],
          dateKey,
          weekend,
          blockSize: 1,
          requireSixHour: false,
          allowUsedDay: true,
          people: input.people,
          supportAvailability,
          supportWeekCounts,
          supportUsedDays,
          occupiedSupports
        });

        if (assignSupportBlock([current], singleCandidates, dateKey, supportWeekCounts, supportUsedDays, occupiedSupports)) {
          current.row.warnings.push(
            weekend
              ? "WEEKEND_SUPPORT_FALLBACK_SINGLE: Cuối tuần không ghép được block dài, đã fallback xếp từng slot."
              : "WEEKDAY_SUPPORT_FALLBACK_SINGLE: Ngày thường không ghép được block Support liên tục, đã fallback xếp từng slot."
          );
        } else {
          current.row.warnings.push(
            weekend
              ? "OPEN_SUPPORT: Có Host nhưng chưa tìm được Support phù hợp cho slot cuối tuần này."
              : "SUPPORT_SINGLETON: Ca Studio không ghép được block Support liên tục."
          );
        }
        offset += 1;
      }
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
