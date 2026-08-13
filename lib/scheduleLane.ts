import type { ScheduleSession } from "./types.ts";

export type ScheduleLane = "home" | "studio";

export function getScheduleSessionLane(session: Pick<ScheduleSession, "format">): ScheduleLane {
  return session.format.trim().toLowerCase().includes("home") ? "home" : "studio";
}

export function buildScheduleLaneKey(dateKey: string, slot: string, lane: ScheduleLane) {
  return `${dateKey}__${slot}__${lane}`;
}
