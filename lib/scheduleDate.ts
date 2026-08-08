export const DEFAULT_SCHEDULE_TIME_ZONE = "Asia/Bangkok";

function formatDateKey(date: Date, timeZone: string) {
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
    return formatDateKey(new Date(), timeZone);
  } catch {
    return formatDateKey(new Date(), DEFAULT_SCHEDULE_TIME_ZONE);
  }
}
