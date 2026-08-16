import { getSubmittedScheduleSlotsForWeek } from "@/lib/availabilityStore";
import { getSchedulePeopleFromMongo } from "@/lib/employeeRoster";
import { DEFAULT_SCHEDULE_SLOTS } from "@/lib/scheduleConfig";
import {
  getScheduleTodayKey,
  getScheduleWeekDateKeys,
  getScheduleWeekStartKey,
  isValidScheduleDateKey
} from "@/lib/scheduleDate";
import { generateSchedule } from "@/lib/scheduleEngine";
import {
  getScheduleFromMongo,
  getScheduleSessionsForGeneration,
  publishGeneratedScheduleWeek
} from "@/lib/scheduleStore";
import type { SchedulePayload } from "@/lib/types";

type GenerateScheduleWeekInput = {
  weekStartKey?: string;
  requestedBy: string;
  mode?: "safe" | "refresh_unconfirmed";
};

export async function generateAndPublishScheduleWeek(
  input: GenerateScheduleWeekInput
): Promise<SchedulePayload> {
  const requestedKey = input.weekStartKey?.trim();
  if (requestedKey && !isValidScheduleDateKey(requestedKey)) {
    throw new Error("Tuần được chọn không hợp lệ.");
  }

  const weekStartKey = getScheduleWeekStartKey(requestedKey || new Date());
  const weekDateKeys = getScheduleWeekDateKeys(weekStartKey);
  const weekEndKey = weekDateKeys[weekDateKeys.length - 1];
  const todayKey = getScheduleTodayKey();
  if (!weekEndKey || weekEndKey <= todayKey) {
    throw new Error("Không thể chạy lại tuần đã kết thúc hoặc chỉ chứa ngày quá khứ.");
  }

  const startedAt = new Date();
  const [roster, availability, existingSessions] = await Promise.all([
    getSchedulePeopleFromMongo(),
    getSubmittedScheduleSlotsForWeek(weekStartKey),
    getScheduleSessionsForGeneration(weekStartKey, weekEndKey)
  ]);
  const people = [...(roster.hosts || []), ...(roster.supports || [])];
  const futureAvailability = availability.filter((slot) => slot.dateKey > todayKey);
  if (futureAvailability.length === 0) {
    throw new Error("Chưa có Host hoặc Support gửi slot rảnh trong phần còn lại của tuần. Lịch hiện tại được giữ nguyên.");
  }

  const refreshUnconfirmed = input.mode === "refresh_unconfirmed";
  const protectedSessions = existingSessions.filter(
    (row) => row.dateKey <= todayKey || row.isHostConfirmed || row.isSupportConfirmed || (!refreshUnconfirmed && row.manualOverride)
  );
  const generatedRows = generateSchedule({
    weekStartKey,
    todayKey,
    slots: DEFAULT_SCHEDULE_SLOTS,
    people,
    availability,
    protectedSessions
  });
  const syncResult = await publishGeneratedScheduleWeek({
    weekStartKey,
    weekEndKey,
    todayKey,
    rows: generatedRows,
    requestedBy: input.requestedBy,
    preserveManualOverrides: !refreshUnconfirmed,
    startedAt
  });
  const payload = await getScheduleFromMongo({ from: weekStartKey, to: weekEndKey });
  const openCount = generatedRows.filter((row) => row.status === "open").length;
  const protectedCount = existingSessions.filter(
    (row) => row.dateKey > todayKey && (row.isHostConfirmed || row.isSupportConfirmed)
  ).length;
  const resetCount = refreshUnconfirmed
    ? existingSessions.filter((row) => row.dateKey > todayKey && !row.isHostConfirmed && !row.isSupportConfirmed && row.manualOverride).length
    : 0;

  payload.sync = {
    success: true,
    message: refreshUnconfirmed
      ? `Đã làm sạch ${resetCount} ca chưa xác nhận rồi chạy lại ${syncResult.total} ca của tuần. ${openCount} ca còn mở${protectedCount ? `; giữ nguyên ${protectedCount} ca đã xác nhận` : ""}.`
      : `Đã chạy và cập nhật trực tiếp ${syncResult.total} ca của tuần. ${openCount} ca còn mở${protectedCount ? `; giữ nguyên ${protectedCount} ca đã xác nhận` : ""}.`,
    ...syncResult
  };
  return payload;
}
