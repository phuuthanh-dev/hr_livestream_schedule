import type { AvailabilityLocationPreference, SchedulePerson, ScheduleSession } from "./types";
import { buildScheduleSessionCode } from "./scheduleSessionCode.ts";

const ASSIGNMENT_WARNING_PREFIXES = [
  "OPEN_HOST:",
  "BACKUP_HOST:",
  "OPEN_SUPPORT:",
  "OPEN_SUPPORT_6H:",
  "BACKUP_SUPPORT:",
  "SUPPORT_SINGLETON:"
];

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedLocation(person: SchedulePerson | null) {
  return normalizeText(person?.workLocation).toLowerCase().replace(/\s+/g, "-");
}

function titleizeLocation(code: string) {
  return code
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function hostCanUseLocation(person: SchedulePerson | null, mode: AvailabilityLocationPreference) {
  if (!person) return true;
  const location = normalizedLocation(person);
  if (location === "home") return mode === "home";
  if (location === "both") return true;
  return mode === "studio";
}

export function defaultLocationForHost(person: SchedulePerson | null): AvailabilityLocationPreference {
  const location = normalizedLocation(person);
  return location === "home" || location === "both" ? "home" : "studio";
}

export function getSessionLocationMode(session: ScheduleSession): AvailabilityLocationPreference | "" {
  const format = normalizeText(session.format).toLowerCase();
  if (!format) return "";
  return format.includes("home") ? "home" : "studio";
}

type BuildManualAssignmentInput = {
  current: ScheduleSession;
  host: SchedulePerson | null;
  support: SchedulePerson | null;
  hostWasEdited: boolean;
  supportWasEdited: boolean;
  locationMode?: AvailabilityLocationPreference;
  studioLocationName?: string;
};

export function buildManualScheduleAssignment(input: BuildManualAssignmentInput): ScheduleSession {
  const { current, host } = input;
  let support = input.support;
  let locationMode = input.locationMode
    || (input.hostWasEdited && host ? defaultLocationForHost(host) : getSessionLocationMode(current))
    || defaultLocationForHost(host);

  if (support && locationMode === "home") {
    if (input.supportWasEdited && input.locationMode !== "home") {
      if (!hostCanUseLocation(host, "studio")) {
        throw new Error("Host chỉ làm việc tại Home nên không thể xếp Support vào ca này.");
      }
      locationMode = "studio";
    } else {
      support = null;
    }
  }
  if (!hostCanUseLocation(host, locationMode)) {
    throw new Error(`Địa điểm ${locationMode === "home" ? "Home" : "Studio"} không phù hợp với hồ sơ Host.`);
  }
  if (locationMode === "home") support = null;

  const configuredLocation = normalizedLocation(host);
  const format = locationMode === "home"
    ? "Home"
    : configuredLocation && !["home", "both", "studio"].includes(configuredLocation)
      ? normalizeText(input.studioLocationName) || titleizeLocation(configuredLocation)
      : "Studio";
  const hostId = host?.id || "";
  const supportId = support?.id || "";
  const hostAssignmentChanged = hostId.toLowerCase() !== current.hostId.toLowerCase();
  const supportAssignmentChanged = supportId.toLowerCase() !== current.supportId.toLowerCase();
  const locationChanged = format.toLowerCase() !== current.format.toLowerCase();
  const hostNeedsConfirmation = hostAssignmentChanged || locationChanged;
  const supportNeedsConfirmation = supportAssignmentChanged || locationChanged;
  const supportRequired = locationMode === "studio";
  const missingSupport = supportRequired && !supportId;
  const warnings = current.warnings.filter(
    (warning) => !ASSIGNMENT_WARNING_PREFIXES.some((prefix) => warning.startsWith(prefix))
  );

  if (!hostId) warnings.push("OPEN_HOST: Chưa chọn Host cho ca.");
  if (missingSupport) warnings.push("OPEN_SUPPORT: Ca Studio chưa có Support.");

  const next: ScheduleSession = {
    ...current,
    hostId,
    hostName: host?.name || "",
    supportId,
    supportName: support?.name || "",
    format,
    channel: input.hostWasEdited ? host?.liveChannelId || "" : current.channel,
    supportRequired,
    missingSupport,
    isSupportOnly: Boolean(!hostId && supportId),
    canConfirmHost: Boolean(hostId),
    canConfirmSupport: Boolean(supportId),
    status: !hostId || missingSupport ? "open" : "published",
    warnings,
    warningLevel: !hostId || missingSupport ? "danger" : warnings.length ? "info" : "ok",
    manualOverride: true
  };

  next.sessionCode = buildScheduleSessionCode({
    dateKey: next.dateKey,
    slot: next.slot,
    hostId: next.hostId,
    supportId: next.supportId,
    lane: locationMode
  });

  if (input.hostWasEdited) {
    next.backupHostId = "";
    next.backupHostName = "";
  }
  if (input.supportWasEdited || supportAssignmentChanged || locationMode === "home") {
    next.backupSupportId = "";
    next.backupSupportName = "";
    next.supportCandidatePool = "";
  }
  if (hostNeedsConfirmation) {
    next.hostConfirm = "Chưa xác nhận";
    next.isHostConfirmed = false;
  }
  if (supportNeedsConfirmation || !supportId) {
    next.supportConfirm = "Chưa xác nhận";
    next.isSupportConfirmed = false;
  }

  return next;
}
