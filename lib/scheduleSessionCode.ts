import type { ScheduleSession } from "@/lib/types";
import type { ScheduleLane } from "@/lib/scheduleLane";

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function parseSlot(slot: string) {
  const match = normalizeText(slot).match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!match) {
    return { start: "0000", end: "0000" };
  }
  const [, startHour, startMinute, endHour, endMinute] = match;
  return {
    start: `${startHour.padStart(2, "0")}${startMinute}`,
    end: `${endHour.padStart(2, "0")}${endMinute}`
  };
}

function formatDatePart(dateKey: string) {
  const match = normalizeText(dateKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return normalizeText(dateKey).replace(/\D/g, "") || "00000000";
  const [, year, month, day] = match;
  return `${day}${month}${year}`;
}

export function buildScheduleSessionKey(dateKey: string, slot: string, lane: ScheduleLane) {
  const { start } = parseSlot(slot);
  return `AUTO_${normalizeText(dateKey).replace(/-/g, "")}_${start}_${lane.toUpperCase()}`;
}

export function buildScheduleSessionCode(input: {
  dateKey: string;
  slot: string;
  hostId?: string;
  supportId?: string;
  lane: ScheduleLane;
}) {
  const { start, end } = parseSlot(input.slot);
  const hostToken = normalizeText(input.hostId) || "NOHOST";
  const supportToken = input.lane === "home" ? "NO_SUPPORT" : (normalizeText(input.supportId) || "NO_SUPPORT");
  return `SS-${formatDatePart(input.dateKey)}-${start}${end}-${hostToken}-${supportToken}`;
}

export function getScheduleSessionCode(session: Pick<ScheduleSession, "sessionCode" | "sessionId" | "dateKey" | "slot" | "hostId" | "supportId" | "format">) {
  const currentCode = normalizeText(session.sessionCode);
  if (currentCode) return currentCode;
  return buildScheduleSessionCode({
    dateKey: session.dateKey,
    slot: session.slot,
    hostId: session.hostId,
    supportId: session.supportId,
    lane: normalizeText(session.format).toLowerCase().includes("home") ? "home" : "studio"
  });
}
