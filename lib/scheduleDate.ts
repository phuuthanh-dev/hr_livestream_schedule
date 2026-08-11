export const DEFAULT_SCHEDULE_TIME_ZONE = "Asia/Bangkok";

export function formatScheduleDateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getScheduleTodayKey(timeZone = DEFAULT_SCHEDULE_TIME_ZONE) {
  try {
    return formatScheduleDateKey(new Date(), timeZone);
  } catch {
    return formatScheduleDateKey(new Date(), DEFAULT_SCHEDULE_TIME_ZONE);
  }
}

export function isValidScheduleDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function parseScheduleDateKey(value: string) {
  if (!isValidScheduleDateKey(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function addDaysToScheduleDateKey(dateKey: string, days: number) {
  const date = parseScheduleDateKey(dateKey);
  if (!date) return "";
  date.setDate(date.getDate() + days);
  return formatScheduleDateKey(date, DEFAULT_SCHEDULE_TIME_ZONE);
}

export function getScheduleWeekStartKey(anchor: Date | string = new Date()) {
  const date = typeof anchor === "string" ? parseScheduleDateKey(anchor) : new Date(anchor);
  if (!date) return getScheduleTodayKey();
  date.setHours(12, 0, 0, 0);
  const dayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - dayOffset);
  return formatScheduleDateKey(date, DEFAULT_SCHEDULE_TIME_ZONE);
}

export function getScheduleWeekDateKeys(weekStartKey: string) {
  return Array.from({ length: 7 }, (_, index) => addDaysToScheduleDateKey(weekStartKey, index)).filter(Boolean);
}
