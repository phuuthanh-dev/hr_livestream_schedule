import { createHash } from "node:crypto";
import type { TikTokReportFragment } from "./payrollImport.ts";
import { getScheduleSessionLane } from "./scheduleLane.ts";
import { getScheduleSessionCode } from "./scheduleSessionCode.ts";
import type {
  PayrollEntry,
  PayrollException,
  PayrollRateCard,
  PayrollRole,
  PayrollSettings,
  SchedulePerson,
  ScheduleSession
} from "./types.ts";

type LogicalLive = {
  key: string;
  dateKey: string;
  accountId: string;
  startAt: Date;
  endAt: Date;
  grossGmv: number;
  returnedGmv: number;
  tiktokLiveIds: string[];
  fragments: TikTokReportFragment[];
};

export type PayrollCalculationInput = {
  weekStartKey: string;
  weekEndKey: string;
  sessions: ScheduleSession[];
  people: SchedulePerson[];
  fragments: TikTokReportFragment[];
  rates: PayrollRateCard[];
  settings: PayrollSettings;
  generatedAt?: Date;
};

type TemporaryPayrollHourAdjustment = {
  weekStartKey: string;
  role: PayrollRole;
  employeeId: string;
  extraHours: number;
  location?: "home" | "studio";
  reason: string;
};

// Temporary payroll compensation for the first two approved weeks only.
// Remove these rows after HR finishes the manual catch-up for failed fixed-deal shifts.
const TEMPORARY_PAYROLL_HOUR_ADJUSTMENTS: TemporaryPayrollHourAdjustment[] = [
  {
    weekStartKey: "2026-08-03",
    role: "support",
    employeeId: "HRSL02_6H",
    extraHours: 2,
    location: "studio",
    reason: "Deal-fix fail compensation approved by HR"
  },
  {
    weekStartKey: "2026-08-03",
    role: "support",
    employeeId: "HRSL01_6H",
    extraHours: 2,
    location: "studio",
    reason: "Deal-fix fail compensation approved by HR"
  },
  {
    weekStartKey: "2026-08-10",
    role: "support",
    employeeId: "HRSL02_6H",
    extraHours: 2,
    location: "studio",
    reason: "Deal-fix fail compensation approved by HR"
  },
  {
    weekStartKey: "2026-08-10",
    role: "support",
    employeeId: "HRSL01_6H",
    extraHours: 2,
    location: "studio",
    reason: "Deal-fix fail compensation approved by HR"
  }
];

function normalizeText(value: unknown) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("vi")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeAccount(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "");
}

function hashKey(parts: Array<string | number>) {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function personKey(role: PayrollRole, employeeId: string) {
  return `${role}:${employeeId.trim().toLowerCase()}`;
}

export function parseSlotRange(dateKey: string, slot: string) {
  const match = slot.match(/^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/);
  if (!match) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  const startMinutes = Number(match[1]) * 60 + Number(match[2]);
  let endMinutes = Number(match[3]) * 60 + Number(match[4]);
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  const base = Date.UTC(year, month - 1, day, -7, 0, 0, 0);
  return {
    startAt: new Date(base + startMinutes * 60_000),
    endAt: new Date(base + endMinutes * 60_000),
    hours: (endMinutes - startMinutes) / 60
  };
}

function overlapMilliseconds(
  left: { startAt: Date; endAt: Date },
  right: { startAt: Date; endAt: Date }
) {
  return Math.max(0, Math.min(left.endAt.getTime(), right.endAt.getTime()) - Math.max(left.startAt.getTime(), right.startAt.getTime()));
}

function buildLogicalLive(fragments: TikTokReportFragment[]): LogicalLive {
  const sorted = fragments.slice().sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
  const first = sorted[0];
  return sorted.slice(1).reduce<LogicalLive>((live, fragment) => {
    live.endAt = new Date(Math.max(live.endAt.getTime(), fragment.endAt.getTime()));
    live.grossGmv += fragment.grossGmv;
    live.returnedGmv += fragment.returnedGmv;
    if (!live.tiktokLiveIds.includes(fragment.tiktokLiveId)) live.tiktokLiveIds.push(fragment.tiktokLiveId);
    live.fragments.push(fragment);
    return live;
  }, {
    key: hashKey([first.dateKey, normalizeAccount(first.accountId), first.tiktokLiveId, first.startAt.toISOString()]),
    dateKey: first.dateKey,
    accountId: first.accountId,
    startAt: first.startAt,
    endAt: first.endAt,
    grossGmv: first.grossGmv,
    returnedGmv: first.returnedGmv,
    tiktokLiveIds: [first.tiktokLiveId],
    fragments: [first]
  });
}

function joinFragments(fragments: TikTokReportFragment[], gapMinutes: number): LogicalLive[] {
  const buckets = new Map<string, TikTokReportFragment[]>();
  fragments.forEach((fragment) => {
    const key = `${fragment.dateKey}__${normalizeAccount(fragment.accountId)}`;
    const bucket = buckets.get(key) || [];
    bucket.push(fragment);
    buckets.set(key, bucket);
  });

  const lives: LogicalLive[] = [];
  buckets.forEach((bucket) => {
    const sorted = bucket.slice().sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
    let currentFragments: TikTokReportFragment[] = [];
    sorted.forEach((fragment) => {
      const previous = currentFragments[currentFragments.length - 1];
      const withinGap = previous
        && fragment.startAt.getTime() - previous.endAt.getTime() <= gapMinutes * 60_000;
      if (!withinGap) {
        if (currentFragments.length > 0) lives.push(buildLogicalLive(currentFragments));
        currentFragments = [fragment];
        return;
      }
      currentFragments.push(fragment);
    });
    if (currentFragments.length > 0) lives.push(buildLogicalLive(currentFragments));
  });
  return lives.sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
}

function matchSessionsToLives(
  sessions: ScheduleSession[],
  lives: LogicalLive[],
  sessionRanges: Map<string, ReturnType<typeof parseSlotRange>>
) {
  const sessionsByLive = new Map<string, ScheduleSession[]>();
  const matchedSessionIds = new Set<string>();
  sessions.forEach((session) => {
    const range = sessionRanges.get(session.sessionId);
    if (!range) return;
    const candidates = lives
      .filter((live) => live.dateKey === session.dateKey && normalizeAccount(live.accountId) === normalizeAccount(session.channel))
      .map((live) => ({
        live,
        overlap: overlapMilliseconds(range, live),
        minimumOverlap: Math.min(30 * 60_000, (live.endAt.getTime() - live.startAt.getTime()) / 2)
      }))
      .filter((candidate) => candidate.overlap >= candidate.minimumOverlap)
      .sort((left, right) => right.overlap - left.overlap);
    const best = candidates[0];
    if (!best) return;
    const bucket = sessionsByLive.get(best.live.key) || [];
    bucket.push(session);
    sessionsByLive.set(best.live.key, bucket);
    matchedSessionIds.add(session.sessionId);
  });
  return { sessionsByLive, matchedSessionIds };
}

function canonicalGrade(role: PayrollRole, value: string) {
  const normalized = normalizeText(value);
  if (role === "support") {
    const level = normalized.match(/(\d+)/)?.[1];
    return level ? `cap ${level}` : normalized;
  }
  if (normalized.includes("thu viec") || normalized.includes("trial") || normalized.includes("trainee")) return "thu viec";
  return normalized.match(/^[sabc](?:\s|$)/)?.[0].trim() || normalized;
}

function findRate(rates: PayrollRateCard[], role: PayrollRole, grade: string) {
  const canonical = canonicalGrade(role, grade);
  return rates.find((rate) => rate.active && rate.role === role && canonicalGrade(role, rate.grade) === canonical);
}

function commissionRateFor(rate: PayrollRateCard, eligibleGmv: number, settings: PayrollSettings) {
  if (rate.commissionMode === "none") return 0;
  if (rate.commissionMode === "fixed") return rate.commissionRate;
  return settings.hostGmvTiers
    .slice()
    .sort((left, right) => left.minimumGmv - right.minimumGmv)
    .reduce((selected, tier) => eligibleGmv >= tier.minimumGmv ? Math.max(selected, tier.commissionRate) : selected, rate.commissionRate);
}

function resolveHourlyRateOverride(value: unknown) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  const match = raw.match(/(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(k|ngh|ngan|ngàn)?/i);
  if (!match) return null;
  const numericToken = match[1];
  const suffix = match[2] || "";
  let parsed = 0;

  if (/[.,]\d{3}/.test(numericToken)) {
    parsed = Number(numericToken.replace(/[.,]/g, ""));
  } else {
    parsed = Number(numericToken.replace(",", "."));
    if (suffix) parsed *= 1000;
  }

  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

function applyTemporaryHourAdjustments(
  entries: PayrollEntry[],
  exceptions: PayrollException[],
  input: PayrollCalculationInput,
  peopleByKey: Map<string, SchedulePerson>
) {
  const applicableAdjustments = TEMPORARY_PAYROLL_HOUR_ADJUSTMENTS.filter(
    (item) => item.weekStartKey === input.weekStartKey && item.extraHours > 0
  );
  if (applicableAdjustments.length === 0) return;

  applicableAdjustments.forEach((adjustment) => {
    const employeeKey = personKey(adjustment.role, adjustment.employeeId);
    const person = peopleByKey.get(employeeKey);
    const targetEntry = entries
      .filter((entry) => entry.role === adjustment.role && entry.employeeId.toLowerCase() === adjustment.employeeId.toLowerCase())
      .sort((left, right) => left.dateKey.localeCompare(right.dateKey))[0];

    const hourlyRate = targetEntry?.hourlyRate
      || resolveHourlyRateOverride(person?.cashOffer)
      || (() => {
        const grade = person?.level || "";
        const rate = findRate(input.rates, adjustment.role, grade);
        return rate?.hourlyRate || 0;
      })();

    if (!hourlyRate) {
      exceptions.push({
        exceptionKey: hashKey(["temporary_adjustment_missing_rate", input.weekStartKey, adjustment.role, adjustment.employeeId]),
        type: "missing_rate",
        dateKey: input.weekStartKey,
        employeeId: adjustment.employeeId,
        message: `Không thể áp dụng bù công tạm thời cho ${person?.name || adjustment.employeeId} vì chưa xác định được lương giờ.`
      });
      return;
    }

    const extraBasePay = Math.round(adjustment.extraHours * hourlyRate);

    if (targetEntry) {
      targetEntry.scheduledHours += adjustment.extraHours;
      targetEntry.basePay += extraBasePay;
      targetEntry.grossPay += extraBasePay;
      targetEntry.netPay = targetEntry.grossPay - targetEntry.taxAmount;
      return;
    }

    const grade = person?.level || "";
    const employeeName = person?.name || adjustment.employeeId;
    entries.push({
      entryKey: hashKey([input.weekStartKey, "temporary_adjustment", adjustment.role, adjustment.employeeId.toLowerCase()]),
      weekStartKey: input.weekStartKey,
      weekEndKey: input.weekEndKey,
      dateKey: input.weekStartKey,
      role: adjustment.role,
      employeeId: adjustment.employeeId,
      employeeName,
      grade,
      location: adjustment.location || "studio",
      accountId: `TEMP_ADJUSTMENT:${adjustment.reason}`,
      sessionIds: [],
      tiktokLiveIds: [],
      scheduledHours: adjustment.extraHours,
      hourlyRate,
      grossGmv: 0,
      returnedGmv: 0,
      eligibleGmv: 0,
      commissionRate: 0,
      basePay: extraBasePay,
      commissionPay: 0,
      adjustments: 0,
      grossPay: extraBasePay,
      taxRate: adjustment.role === "support" ? 0 : input.settings.taxRate,
      taxAmount: 0,
      netPay: extraBasePay,
      generatedAt: (input.generatedAt || new Date()).toISOString()
    });
  });
}

export function calculatePayroll(input: PayrollCalculationInput) {
  const generatedAt = input.generatedAt || new Date();
  const peopleByKey = new Map(input.people.map((person) => [personKey(person.role, person.id), person]));
  const lives = joinFragments(input.fragments, input.settings.joinGapMinutes);
  const exceptions: PayrollException[] = [];
  const usableSessions = input.sessions.filter((session) => session.status !== "canceled" && session.hostId);
  const sessionRanges = new Map<string, ReturnType<typeof parseSlotRange>>();
  usableSessions.forEach((session) => sessionRanges.set(session.sessionId, parseSlotRange(session.dateKey, session.slot)));

  usableSessions.forEach((session) => {
    if (session.channel.trim()) return;
    exceptions.push({
      exceptionKey: hashKey(["missing_account", session.sessionId]),
      type: "missing_account",
      dateKey: session.dateKey,
      sessionId: session.sessionId,
      employeeId: session.hostId,
      message: `${session.hostName || session.hostId} chưa có TikTok account để đối chiếu báo cáo.`
    });
  });

  const liveByKey = new Map(lives.map((live) => [live.key, live]));
  const { sessionsByLive, matchedSessionIds } = matchSessionsToLives(
    usableSessions.filter((session) => session.channel.trim()),
    lives,
    sessionRanges
  );

  lives.forEach((live) => {
    if (sessionsByLive.has(live.key)) return;
    exceptions.push({
      exceptionKey: hashKey(["unmatched_report", live.key]),
      type: "unmatched_report",
      dateKey: live.dateKey,
      accountId: live.accountId,
      tiktokLiveIds: live.tiktokLiveIds,
      message: `Báo cáo ${live.accountId} ${live.startAt.toLocaleTimeString("vi-VN", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" })} chưa khớp ca lịch.`
    });
  });

  usableSessions.forEach((session) => {
    const confirmedRoles = [
      session.isHostConfirmed && session.hostId ? { role: "host" as const, id: session.hostId, name: session.hostName } : null,
      getScheduleSessionLane(session) === "studio" && session.isSupportConfirmed && session.supportId
        ? { role: "support" as const, id: session.supportId, name: session.supportName }
        : null
    ].filter(Boolean) as Array<{ role: PayrollRole; id: string; name: string }>;
    if (confirmedRoles.length > 0 && !matchedSessionIds.has(session.sessionId)) {
      confirmedRoles.forEach((person) => exceptions.push({
        exceptionKey: hashKey(["missing_report", session.sessionId, person.role, person.id]),
        type: "missing_report",
        dateKey: session.dateKey,
        sessionId: session.sessionId,
        employeeId: person.id,
        accountId: session.channel || undefined,
        message: `Ca ${session.slot} của ${person.name || person.id} chưa có báo cáo TikTok; chưa tự động tính lương.`
      }));
    }
  });

  const entries: PayrollEntry[] = [];
  sessionsByLive.forEach((sessions, liveKey) => {
    const live = liveByKey.get(liveKey);
    if (!live) return;
    if (processSplitLive(live, sessions)) return;
    const eligibleGmv = Math.max(0, live.grossGmv - live.returnedGmv);
    const confirmedHostSessions = sessions.filter((session) => {
      if (session.isHostConfirmed) return true;
      exceptions.push({
        exceptionKey: hashKey(["unconfirmed_shift", session.sessionId, "host"]),
        type: "unconfirmed_shift",
        dateKey: session.dateKey,
        sessionId: session.sessionId,
        employeeId: session.hostId,
        message: `Host ${session.hostName || session.hostId} chưa xác nhận ca ${session.slot}; ca chưa được tính lương.`
      });
      return false;
    });
    const hostIds = new Set(confirmedHostSessions.map((session) => session.hostId.toLowerCase()));
    if (hostIds.size > 1) {
      exceptions.push({
        exceptionKey: hashKey(["ambiguous_assignment", live.key, "host"]),
        type: "ambiguous_assignment",
        dateKey: live.dateKey,
        accountId: live.accountId,
        tiktokLiveIds: live.tiktokLiveIds,
        message: "Một phiên logic đang khớp nhiều Host; cần Admin kiểm tra trước khi tính lương."
      });
    } else if (confirmedHostSessions.length > 0) {
      buildEntry("host", confirmedHostSessions, live, eligibleGmv);
    }

    const supportGroups = new Map<string, ScheduleSession[]>();
    sessions.filter((session) => getScheduleSessionLane(session) === "studio" && session.supportId).forEach((session) => {
      if (!session.isSupportConfirmed) {
        exceptions.push({
          exceptionKey: hashKey(["unconfirmed_shift", session.sessionId, "support"]),
          type: "unconfirmed_shift",
          dateKey: session.dateKey,
          sessionId: session.sessionId,
          employeeId: session.supportId,
          message: `Support ${session.supportName || session.supportId} chưa xác nhận ca ${session.slot}; ca chưa được tính lương.`
        });
        return;
      }
      const key = session.supportId.toLowerCase();
      const bucket = supportGroups.get(key) || [];
      bucket.push(session);
      supportGroups.set(key, bucket);
    });
    supportGroups.forEach((supportSessions) => buildEntry("support", supportSessions, live, eligibleGmv));
  });

  applyTemporaryHourAdjustments(entries, exceptions, input, peopleByKey);

  function processSplitLive(live: LogicalLive, sessions: ScheduleSession[]) {
    const confirmedHostSessions = sessions.filter((session) => session.isHostConfirmed);
    const hostIds = new Set(confirmedHostSessions.map((session) => session.hostId.toLowerCase()));
    if (hostIds.size <= 1 || live.fragments.length <= 1) return false;
    const fragmentLives = live.fragments.map((fragment) => buildLogicalLive([fragment]));
    const { sessionsByLive: sessionsByFragment, matchedSessionIds: matchedFragmentSessionIds } = matchSessionsToLives(
      sessions,
      fragmentLives,
      sessionRanges
    );
    if (sessionsByFragment.size <= 1) return false;
    const canSplit = Array.from(sessionsByFragment.values()).every((fragmentSessions) => {
      const fragmentHostIds = new Set(
        fragmentSessions
          .filter((session) => session.isHostConfirmed)
          .map((session) => session.hostId.toLowerCase())
      );
      return fragmentHostIds.size <= 1;
    }) && confirmedHostSessions.every((session) => matchedFragmentSessionIds.has(session.sessionId));
    if (!canSplit) return false;
    fragmentLives.forEach((fragmentLive) => {
      const fragmentSessions = sessionsByFragment.get(fragmentLive.key);
      if (!fragmentSessions?.length) return;
      const eligibleGmv = Math.max(0, fragmentLive.grossGmv - fragmentLive.returnedGmv);
      const fragmentConfirmedHostSessions = fragmentSessions.filter((session) => {
        if (session.isHostConfirmed) return true;
        exceptions.push({
          exceptionKey: hashKey(["unconfirmed_shift", session.sessionId, "host"]),
          type: "unconfirmed_shift",
          dateKey: session.dateKey,
          sessionId: session.sessionId,
          employeeId: session.hostId,
          message: `Host ${session.hostName || session.hostId} chưa xác nhận ca ${session.slot}; ca chưa được tính lương.`
        });
        return false;
      });
      if (fragmentConfirmedHostSessions.length > 0) {
        buildEntry("host", fragmentConfirmedHostSessions, fragmentLive, eligibleGmv);
      }

      const supportGroups = new Map<string, ScheduleSession[]>();
      fragmentSessions.filter((session) => getScheduleSessionLane(session) === "studio" && session.supportId).forEach((session) => {
        if (!session.isSupportConfirmed) {
          exceptions.push({
            exceptionKey: hashKey(["unconfirmed_shift", session.sessionId, "support"]),
            type: "unconfirmed_shift",
            dateKey: session.dateKey,
            sessionId: session.sessionId,
            employeeId: session.supportId,
            message: `Support ${session.supportName || session.supportId} chưa xác nhận ca ${session.slot}; ca chưa được tính lương.`
          });
          return;
        }
        const key = session.supportId.toLowerCase();
        const bucket = supportGroups.get(key) || [];
        bucket.push(session);
        supportGroups.set(key, bucket);
      });
      supportGroups.forEach((supportSessions) => buildEntry("support", supportSessions, fragmentLive, eligibleGmv));
    });
    return true;
  }

  function buildEntry(
    role: PayrollRole,
    sessions: ScheduleSession[],
    live: LogicalLive,
    eligibleGmv: number
  ) {
    const first = sessions[0];
    const employeeId = role === "host" ? first.hostId : first.supportId;
    const fallbackName = role === "host" ? first.hostName : first.supportName;
    const person = peopleByKey.get(personKey(role, employeeId));
    const grade = person?.level || "";
    const rate = findRate(input.rates, role, grade);
    if (!rate) {
      exceptions.push({
        exceptionKey: hashKey(["missing_rate", live.key, role, employeeId]),
        type: "missing_rate",
        dateKey: live.dateKey,
        employeeId,
        accountId: live.accountId,
        message: `${person?.name || fallbackName || employeeId} chưa có bảng giá phù hợp với grade “${grade || "trống"}”.`
      });
      return;
    }
    const uniqueSessions = Array.from(new Map(sessions.map((session) => [session.sessionId, session])).values());
    const scheduledHours = uniqueSessions.reduce((total, session) => total + (sessionRanges.get(session.sessionId)?.hours || 0), 0);
    const commissionRate = commissionRateFor(rate, eligibleGmv, input.settings);
    const hourlyRate = resolveHourlyRateOverride(person?.cashOffer) || rate.hourlyRate;
    const basePay = Math.round(scheduledHours * hourlyRate);
    const commissionPay = Math.round(eligibleGmv * commissionRate);
    const adjustments = 0;
    const grossPay = basePay + adjustments;
    const effectiveTaxRate = role === "support" ? 0 : input.settings.taxRate;
    const taxAmount = Math.round(grossPay * effectiveTaxRate);
    entries.push({
      entryKey: hashKey([input.weekStartKey, live.key, role, employeeId.toLowerCase()]),
      weekStartKey: input.weekStartKey,
      weekEndKey: input.weekEndKey,
      dateKey: live.dateKey,
      role,
      employeeId,
      employeeName: person?.name || fallbackName || employeeId,
      grade,
      location: getScheduleSessionLane(first),
      accountId: live.accountId,
      sessionIds: uniqueSessions.map((session) => getScheduleSessionCode(session)),
      tiktokLiveIds: live.tiktokLiveIds,
      scheduledHours,
      hourlyRate,
      grossGmv: live.grossGmv,
      returnedGmv: live.returnedGmv,
      eligibleGmv,
      commissionRate,
      basePay,
      commissionPay,
      adjustments,
      grossPay,
      taxRate: effectiveTaxRate,
      taxAmount,
      netPay: grossPay - taxAmount,
      generatedAt: generatedAt.toISOString()
    });
  }

  return {
    entries: entries.sort((left, right) => [left.dateKey, left.employeeName].join("|").localeCompare([right.dateKey, right.employeeName].join("|"), "vi")),
    exceptions: Array.from(new Map(exceptions.map((exception) => [exception.exceptionKey, exception])).values())
  };
}
