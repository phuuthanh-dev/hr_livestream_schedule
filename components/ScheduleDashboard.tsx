"use client";

import { startTransition, useDeferredValue, useEffect, useState } from "react";
import { getScheduleTodayKey } from "@/lib/scheduleDate";
import type { ConfirmRole, PeopleSyncPayload, SchedulePayload, ScheduleSession, ScheduleSummary } from "@/lib/types";

type ScheduleDashboardProps = {
  username: string;
  isAdmin: boolean;
  employeeRole?: "host" | "support";
  employeeId?: string;
};

type FilterMode = "all" | "mine" | "warnings" | "pending";
type IconName = "calendar" | "check" | "chevronLeft" | "chevronRight" | "close" | "logout" | "refresh" | "search" | "sheet" | "users" | "warning";

const DAY_NAMES = ["THỨ 2", "THỨ 3", "THỨ 4", "THỨ 5", "THỨ 6", "THỨ 7", "CHỦ NHẬT"];
const MINI_DAY_NAMES = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const DEFAULT_SLOTS = [
  "00:00 - 02:00",
  "06:00 - 08:00",
  "08:00 - 10:00",
  "10:00 - 12:00",
  "12:00 - 14:00",
  "14:00 - 16:00",
  "16:00 - 18:00",
  "18:00 - 20:00",
  "20:00 - 22:00",
  "22:00 - 00:00"
];

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };

  if (name === "calendar") {
    return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" /></svg>;
  }
  if (name === "check") {
    return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
  }
  if (name === "chevronLeft") {
    return <svg {...common}><path d="m15 18-6-6 6-6" /></svg>;
  }
  if (name === "chevronRight") {
    return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>;
  }
  if (name === "close") {
    return <svg {...common}><path d="M18 6 6 18M6 6l12 12" /></svg>;
  }
  if (name === "logout") {
    return <svg {...common}><path d="M10 17l5-5-5-5M15 12H3M14 4h4a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-4" /></svg>;
  }
  if (name === "refresh") {
    return <svg {...common}><path d="M20 11a8 8 0 1 0-2.34 5.66" /><path d="M20 4v7h-7" /></svg>;
  }
  if (name === "search") {
    return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
  }
  if (name === "sheet") {
    return <svg {...common}><path d="M6 2h9l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" /><path d="M14 2v6h6M8 13h8M8 17h8M8 9h2" /></svg>;
  }
  if (name === "users") {
    return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
  }
  if (name === "warning") {
    return <svg {...common}><path d="M10.3 3.7 2.4 18a2 2 0 0 0 1.75 3h15.7a2 2 0 0 0 1.75-3L13.7 3.7a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>;
  }
  return null;
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateKey: string, days: number) {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

function getWeekStartKey(date = new Date()) {
  const weekDate = new Date(date);
  weekDate.setHours(12, 0, 0, 0);
  const dayOffset = (weekDate.getDay() + 6) % 7;
  weekDate.setDate(weekDate.getDate() - dayOffset);
  return toDateKey(weekDate);
}

function getCurrentWeekStartKey() {
  return getWeekStartKey(new Date());
}

function formatShortDate(dateKey: string) {
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(parseDateKey(dateKey));
}

function formatLongDate(dateKey: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(parseDateKey(dateKey));
}

function formatWeekTitle(startKey: string) {
  const start = parseDateKey(startKey);
  const end = parseDateKey(addDays(startKey, 6));
  const formatter = new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric" });
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return formatter.format(start);
  }
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function formatWeekRange(startKey: string) {
  return `${formatShortDate(startKey)} - ${formatShortDate(addDays(startKey, 6))}`;
}

function emptySummary(): ScheduleSummary {
  return {
    total: 0,
    supportOnly: 0,
    missingSupport: 0,
    pendingHostConfirm: 0,
    pendingSupportConfirm: 0,
    confirmedHost: 0,
    confirmedSupport: 0
  };
}

function buildSummary(rows: ScheduleSession[]) {
  return rows.reduce((summary, row) => {
    summary.total += 1;
    if (row.isSupportOnly) summary.supportOnly += 1;
    if (row.missingSupport) summary.missingSupport += 1;
    if (row.canConfirmHost && !row.isHostConfirmed) summary.pendingHostConfirm += 1;
    if (row.canConfirmSupport && !row.isSupportConfirmed) summary.pendingSupportConfirm += 1;
    if (row.isHostConfirmed) summary.confirmedHost += 1;
    if (row.isSupportConfirmed) summary.confirmedSupport += 1;
    return summary;
  }, emptySummary());
}

function sessionMatchesQuery(session: ScheduleSession, query: string) {
  if (!query) return true;
  const haystack = [
    session.sessionId,
    session.hostId,
    session.hostName,
    session.supportId,
    session.supportName,
    session.channel,
    session.slot,
    session.format
  ].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function sessionMatchesFilter(session: ScheduleSession, filter: FilterMode) {
  if (filter === "warnings") return session.missingSupport || session.isSupportOnly;
  if (filter === "pending") {
    return (
      (session.canConfirmHost && !session.isHostConfirmed) ||
      (session.canConfirmSupport && !session.isSupportConfirmed)
    );
  }
  return true;
}

function sessionBelongsToEmployee(
  session: ScheduleSession,
  role: ScheduleDashboardProps["employeeRole"],
  normalizedEmployeeId: string
) {
  if (!role || !normalizedEmployeeId) return false;
  const assignedId = role === "host" ? session.hostId : session.supportId;
  return assignedId.trim().toLowerCase() === normalizedEmployeeId;
}

function getPersonLabel(id: string, name: string, emptyLabel: string) {
  if (!id && !name) return emptyLabel;
  if (!name || name === id) return id;
  return `${name} · ${id}`;
}

function getSessionTitle(session: ScheduleSession) {
  return session.channel || session.hostName || session.supportName || "Ca chưa phân công";
}

function getSessionPeople(session: ScheduleSession) {
  const host = session.hostName || session.hostId;
  const support = session.supportName || session.supportId;
  if (host && support) return `${host} · ${support}`;
  if (host) return `Host: ${host}`;
  if (support) return `Support: ${support}`;
  return "Chưa có host và support";
}

function getSessionTone(session: ScheduleSession) {
  if (session.missingSupport) return "eventDanger";
  if (session.isSupportOnly) return "eventSupportOnly";
  if (session.format.toLowerCase().includes("studio")) return "eventStudio";
  if (session.format.toLowerCase().includes("home")) return "eventHome";
  return "eventNeutral";
}

function isUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function getSlotStart(slot: string) {
  return slot.split("-")[0]?.trim() || slot;
}

function getSlotSortValue(slot: string) {
  const match = slot.match(/(\d{1,2}):(\d{2})/);
  if (!match) return 9999;
  return Number(match[1]) * 60 + Number(match[2]);
}

function buildMiniMonth(weekStartKey: string) {
  const anchor = parseDateKey(addDays(weekStartKey, 3));
  const firstDay = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12);
  const offset = (firstDay.getDay() + 6) % 7;
  firstDay.setDate(firstDay.getDate() - offset);
  return {
    month: anchor.getMonth(),
    days: Array.from({ length: 42 }, (_, index) => {
      const date = new Date(firstDay);
      date.setDate(firstDay.getDate() + index);
      return toDateKey(date);
    })
  };
}

async function requestWeekSchedule(from: string, to: string) {
  const query = new URLSearchParams({ from, to });
  const response = await fetch(`/api/schedule?${query.toString()}`, { cache: "no-store" });
  const payload = (await response.json()) as SchedulePayload;
  if (!response.ok || !payload.success) {
    throw new Error(payload.message || payload.error || "Không tải được lịch.");
  }
  return payload;
}

export default function ScheduleDashboard({ username, isAdmin, employeeRole, employeeId }: ScheduleDashboardProps) {
  const [weekStartKey, setWeekStartKey] = useState(getCurrentWeekStartKey);
  const [sessions, setSessions] = useState<ScheduleSession[]>([]);
  const [generatedAt, setGeneratedAt] = useState("");
  const [timezone, setTimezone] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [readingSchedule, setReadingSchedule] = useState(false);
  const [peopleSyncing, setPeopleSyncing] = useState(false);
  const [mobileDayKey, setMobileDayKey] = useState(() => toDateKey(new Date()));
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>(() => isAdmin ? "all" : "mine");
  const [busyConfirm, setBusyConfirm] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const deferredQuery = useDeferredValue(query);

  const todayKey = getScheduleTodayKey(timezone || undefined);
  const weekEndKey = addDays(weekStartKey, 6);
  const days = DAY_NAMES.map((label, index) => ({ label, dateKey: addDays(weekStartKey, index) }));
  const weekSessions = sessions.filter((session) => session.dateKey >= weekStartKey && session.dateKey <= weekEndKey);
  const normalizedEmployeeId = employeeId?.trim().toLowerCase() || "";
  const mySessions = weekSessions.filter((session) =>
    sessionBelongsToEmployee(session, employeeRole, normalizedEmployeeId)
  );
  const visibleSessions = weekSessions.filter(
    (session) =>
      sessionMatchesQuery(session, deferredQuery) &&
      sessionMatchesFilter(session, filter) &&
      (filter !== "mine" || sessionBelongsToEmployee(session, employeeRole, normalizedEmployeeId))
  );
  const mobileDaySessions = visibleSessions.filter((session) => session.dateKey === mobileDayKey);
  const weekSummary = buildSummary(weekSessions);
  const warningCount = weekSessions.filter((session) => sessionMatchesFilter(session, "warnings")).length;
  const pendingCount = weekSessions.filter((session) => sessionMatchesFilter(session, "pending")).length;
  const selectedSession = sessions.find((session) => session.sessionId === selectedSessionId);
  const selectedSessionIsPast = Boolean(selectedSession?.dateKey && selectedSession.dateKey < todayKey);
  const canConfirmSelectedHost = Boolean(
    selectedSession && (
      isAdmin || (
        !selectedSessionIsPast &&
        employeeRole === "host" &&
        selectedSession.hostId.trim().toLowerCase() === normalizedEmployeeId
      )
    )
  );
  const canConfirmSelectedSupport = Boolean(
    selectedSession && (
      isAdmin || (
        !selectedSessionIsPast &&
        employeeRole === "support" &&
        selectedSession.supportId.trim().toLowerCase() === normalizedEmployeeId
      )
    )
  );
  const miniMonth = buildMiniMonth(weekStartKey);
  const coverage = formatWeekRange(weekStartKey);
  const slotSet = new Set(DEFAULT_SLOTS);
  sessions.forEach((session) => {
    if (session.slot) slotSet.add(session.slot);
  });
  const slots = Array.from(slotSet).sort((left, right) => getSlotSortValue(left) - getSlotSortValue(right));

  function applyPayload(payload: SchedulePayload) {
    const nextRows = payload.rows || [];
    setSessions(nextRows);
    setGeneratedAt(payload.generatedAt || "");
    setTimezone(payload.timezone || "");
    if (selectedSessionId && !nextRows.some((session) => session.sessionId === selectedSessionId)) {
      setSelectedSessionId("");
    }
  }

  async function refreshFromSheet() {
    setRefreshing(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: weekStartKey, to: weekEndKey })
      });
      const payload = (await response.json()) as SchedulePayload;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message || payload.error || "Không cập nhật được lịch.");
      }
      applyPayload(payload);
      setMessage(payload.sync?.message || "Đã cập nhật lịch tuần từ Google Sheet.");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Không cập nhật được lịch.");
    } finally {
      setRefreshing(false);
    }
  }

  async function readScheduleFromSheet() {
    setReadingSchedule(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/schedule/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: weekStartKey, to: weekEndKey })
      });
      const payload = (await response.json()) as SchedulePayload;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message || payload.error || "Không đọc được dữ liệu lịch.");
      }
      applyPayload(payload);
      setMessage(payload.sync?.message || "Đã đọc dữ liệu hiện tại từ Live_Session_Master.");
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Không đọc được dữ liệu lịch.");
    } finally {
      setReadingSchedule(false);
    }
  }

  async function syncPeopleFromSheet() {
    setPeopleSyncing(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/people/sync", { method: "POST" });
      const payload = (await response.json()) as PeopleSyncPayload;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message || payload.error || "Không cập nhật được danh sách nhân viên.");
      }
      setMessage(
        `Đã cập nhật ${payload.total} nhân viên vào MongoDB` +
        ` · ${payload.inserted} mới · ${payload.updated} cập nhật · ${payload.deactivated} ngừng hoạt động.`
      );
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Không cập nhật được danh sách nhân viên.");
    } finally {
      setPeopleSyncing(false);
    }
  }

  async function confirmSession(session: ScheduleSession, role: ConfirmRole, confirmed: boolean) {
    if (!isAdmin && session.dateKey < todayKey) {
      setError(`Bạn không thể thay đổi xác nhận của ngày đã qua (${session.dateLabel}).`);
      return;
    }

    const busyKey = `${session.sessionId}:${role}`;
    setBusyConfirm(busyKey);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: session.sessionId,
          role,
          confirmed,
          from: weekStartKey,
          to: weekEndKey
        })
      });
      const payload = (await response.json()) as SchedulePayload;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message || payload.error || "Không xác nhận được ca.");
      }
      applyPayload(payload);
      const roleLabel = role === "host" ? "Host" : role === "support" ? "Support Live" : "Host và Support Live";
      const personLabel = role === "host"
        ? getPersonLabel(session.hostId, session.hostName, "Host")
        : getPersonLabel(session.supportId, session.supportName, "Support Live");
      setMessage(
        `${confirmed ? "Đã xác nhận" : "Đã huỷ xác nhận"} ${roleLabel} cho ca ${session.slot} ngày ${session.dateLabel}` +
        `${role === "both" ? "" : ` · ${personLabel}`}.`
      );
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Không xác nhận được ca.");
    } finally {
      setBusyConfirm("");
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function shiftWeek(delta: number) {
    startTransition(() => setWeekStartKey((current) => addDays(current, delta * 7)));
  }

  function selectMiniDate(dateKey: string) {
    startTransition(() => setWeekStartKey(getWeekStartKey(parseDateKey(dateKey))));
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setMessage("");
    setSelectedSessionId("");
    void requestWeekSchedule(weekStartKey, weekEndKey)
      .then((payload) => {
        if (active) applyPayload(payload);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Không tải được lịch.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [weekStartKey]);

  useEffect(() => {
    setMobileDayKey((current) => {
      if (current >= weekStartKey && current <= weekEndKey) return current;
      if (todayKey >= weekStartKey && todayKey <= weekEndKey) return todayKey;
      return weekStartKey;
    });
  }, [todayKey, weekEndKey, weekStartKey]);

  useEffect(() => {
    if (!selectedSessionId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedSessionId("");
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedSessionId]);

  function renderAdminActions(variant: "desktop" | "mobile") {
    return (
      <div className={`adminActions adminActions${variant === "desktop" ? "Desktop" : "Mobile"}`} aria-label="Công cụ Admin">
        <button
          className={`syncButton peopleSyncButton ${peopleSyncing ? "isLoading" : ""}`}
          onClick={syncPeopleFromSheet}
          disabled={peopleSyncing || refreshing || readingSchedule}
          title="Đồng bộ Portfolio_Master và Support_Master vào MongoDB"
          type="button"
        >
          <Icon name="users" />
          <span>{peopleSyncing ? "Đang đồng bộ..." : "Cập nhật nhân viên"}</span>
        </button>
        <button
          className={`syncButton readSyncButton ${readingSchedule ? "isLoading" : ""}`}
          onClick={readScheduleFromSheet}
          disabled={readingSchedule || refreshing || peopleSyncing}
          title="Đọc nguyên trạng Live_Session_Master vào website, không chạy lại logic xếp lịch"
          type="button"
        >
          <Icon name="sheet" />
          <span>{readingSchedule ? "Đang đọc..." : "Đọc dữ liệu"}</span>
        </button>
        <button
          className={`syncButton ${refreshing ? "isLoading" : ""}`}
          onClick={refreshFromSheet}
          disabled={refreshing || peopleSyncing || readingSchedule}
          title="Đồng bộ và xếp lại lịch từ Google Sheet"
          type="button"
        >
          <Icon name="refresh" />
          <span>{refreshing ? "Đang cập nhật..." : "Cập nhật lịch"}</span>
        </button>
      </div>
    );
  }

  return (
    <main className={`calendarApp ${isAdmin ? "hasAdminDock" : ""}`}>
      <header className="appHeader">
        <div className="brandBlock">
          <span className="brandMark"><img className="brandLogo" src="/rr-logo-submark-square.png" alt="" /></span>
          <span className="brandName">Live Calendar</span>
        </div>

        <div className="dateNavigation">
          <button className="todayButton" onClick={() => setWeekStartKey(getCurrentWeekStartKey())} type="button">Hôm nay</button>
          <div className="iconButtonGroup">
            <button className="iconButton" aria-label="Tuần trước" onClick={() => shiftWeek(-1)} type="button"><Icon name="chevronLeft" /></button>
            <button className="iconButton" aria-label="Tuần sau" onClick={() => shiftWeek(1)} type="button"><Icon name="chevronRight" /></button>
          </div>
          <div className="currentRange">
            <h1>{formatWeekTitle(weekStartKey)}</h1>
            <span>{formatWeekRange(weekStartKey)}</span>
          </div>
        </div>

        <div className="headerActions">
          {isAdmin ? renderAdminActions("desktop") : null}
          <span className="userAvatar" title={`Đăng nhập: ${username}`}>{username.slice(0, 1).toUpperCase()}</span>
          <button className="iconButton" aria-label="Đăng xuất" onClick={logout} type="button"><Icon name="logout" /></button>
        </div>
      </header>

      {isAdmin ? renderAdminActions("mobile") : null}

      <div className="appBody">
        <aside className="calendarSidebar">
          <div className="miniMonthHeader">
            <strong>{formatWeekTitle(weekStartKey)}</strong>
            <span>{sessions.length} ca đã tải</span>
          </div>
          <div className="miniMonth" aria-label="Lịch tháng thu gọn">
            {MINI_DAY_NAMES.map((name) => <span className="miniDayName" key={name}>{name}</span>)}
            {miniMonth.days.map((dateKey) => {
              const date = parseDateKey(dateKey);
              const inSelectedWeek = dateKey >= weekStartKey && dateKey <= weekEndKey;
              return (
                <button
                  className={[
                    "miniDate",
                    date.getMonth() !== miniMonth.month ? "outsideMonth" : "",
                    inSelectedWeek ? "inSelectedWeek" : "",
                    dateKey === todayKey ? "miniToday" : ""
                  ].join(" ")}
                  aria-label={formatLongDate(dateKey)}
                  key={dateKey}
                  onClick={() => selectMiniDate(dateKey)}
                  type="button"
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <label className="calendarSearch">
            <Icon name="search" size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm host, support, kênh..." />
          </label>

          <section className="sidebarSection">
            <p className="sidebarLabel">HIỂN THỊ</p>
            {!isAdmin ? (
              <button className={`filterOption filterMine ${filter === "mine" ? "active" : ""}`} onClick={() => setFilter("mine")} type="button">
                <span className="filterDot" /><span>Ca của tôi</span><strong>{mySessions.length}</strong>
              </button>
            ) : null}
            <button className={`filterOption filterAll ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")} type="button">
              <span className="filterDot" /><span>Tất cả ca live</span><strong>{weekSummary.total}</strong>
            </button>
            <button className={`filterOption filterWarning ${filter === "warnings" ? "active" : ""}`} onClick={() => setFilter("warnings")} type="button">
              <span className="filterDot" /><span>Cảnh báo</span><strong>{warningCount}</strong>
            </button>
            <button className={`filterOption filterPending ${filter === "pending" ? "active" : ""}`} onClick={() => setFilter("pending")} type="button">
              <span className="filterDot" /><span>Chờ confirm</span><strong>{pendingCount}</strong>
            </button>
          </section>

          <section className="weekHealth">
            <div className="weekHealthTitle"><span>Tình trạng tuần</span><strong>{weekSummary.total} ca</strong></div>
            <div className="healthRow danger"><span><Icon name="warning" size={16} /> Thiếu support</span><strong>{weekSummary.missingSupport}</strong></div>
            <div className="healthRow support"><span>Support-only</span><strong>{weekSummary.supportOnly}</strong></div>
            <div className="healthRow"><span>Chờ host</span><strong>{weekSummary.pendingHostConfirm}</strong></div>
            <div className="healthRow"><span>Chờ support</span><strong>{weekSummary.pendingSupportConfirm}</strong></div>
          </section>

          <div className="sourceStatus">
            <span className="sourceIcon"><Icon name="sheet" size={18} /></span>
            <div>
              <strong>MongoDB · Live_Session_Master</strong>
              <span>Phạm vi dữ liệu {coverage}</span>
              <span>{generatedAt ? `Đọc lúc ${new Date(generatedAt).toLocaleString("vi-VN")}` : "Chưa có thời gian cập nhật"}</span>
            </div>
          </div>
        </aside>

        <section className="scheduleWorkspace">
          {!isAdmin ? (
            <div className="employeeViewToolbar">
              <div className="employeeViewCopy">
                <strong>Phạm vi lịch</strong>
                <span>{filter === "mine" ? "Chỉ các ca được phân công cho bạn" : filter === "all" ? "Bao gồm lịch của tất cả host và support" : "Đang dùng bộ lọc nâng cao"}</span>
              </div>
              <div className="employeeViewSwitch" role="group" aria-label="Phạm vi lịch hiển thị">
                <button aria-pressed={filter === "mine"} className={filter === "mine" ? "active" : ""} onClick={() => setFilter("mine")} type="button">
                  Ca của tôi <strong>{mySessions.length}</strong>
                </button>
                <button aria-pressed={filter === "all"} className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")} type="button">
                  Tất cả lịch <strong>{weekSummary.total}</strong>
                </button>
              </div>
            </div>
          ) : null}
          {error ? <div className="notice errorNotice"><Icon name="warning" />{error}</div> : null}
          {message ? <div className="notice successNotice"><Icon name="check" />{message}</div> : null}

          <div className="mobileCalendar" aria-busy={loading || refreshing || readingSchedule}>
            <nav className="mobileDayStrip" aria-label="Chọn ngày trong tuần">
              {days.map((day) => {
                const dayCount = visibleSessions.filter((session) => session.dateKey === day.dateKey).length;
                return (
                  <button
                    aria-current={day.dateKey === mobileDayKey ? "date" : undefined}
                    className={`${day.dateKey === mobileDayKey ? "active" : ""} ${day.dateKey === todayKey ? "today" : ""}`}
                    key={day.dateKey}
                    onClick={() => setMobileDayKey(day.dateKey)}
                    type="button"
                  >
                    <span>{day.label.replace("THỨ ", "T").replace("CHỦ NHẬT", "CN")}</span>
                    <strong>{parseDateKey(day.dateKey).getDate()}</strong>
                    <i>{dayCount || ""}</i>
                  </button>
                );
              })}
            </nav>

            <div className="mobileAgendaHeader">
              <div>
                <span>LỊCH TRONG NGÀY</span>
                <strong>{formatLongDate(mobileDayKey)}</strong>
              </div>
              <em>{mobileDaySessions.length} ca</em>
            </div>

            {loading ? (
              <div className="mobileAgendaState"><span className="loadingSpinner" />Đang tải lịch...</div>
            ) : mobileDaySessions.length === 0 ? (
              <div className="mobileAgendaState empty">
                <Icon name="calendar" size={24} />
                <strong>Không có ca phù hợp</strong>
                <span>Chọn ngày khác hoặc đổi bộ lọc để xem thêm lịch.</span>
              </div>
            ) : (
              <div className="mobileAgendaList">
                {slots.map((slot) => {
                  const slotSessions = mobileDaySessions.filter((session) => session.slot === slot);
                  if (slotSessions.length === 0) return null;
                  return (
                    <section className="mobileAgendaSlot" key={slot}>
                      <div className="mobileAgendaTime">
                        <strong>{getSlotStart(slot)}</strong>
                        <span>{slot}</span>
                      </div>
                      <div className="mobileAgendaEvents">
                        {slotSessions.map((session) => (
                          <button
                            className={`mobileEventCard ${getSessionTone(session)}`}
                            key={session.sessionId || `${session.rowNumber}-${session.slot}`}
                            onClick={() => setSelectedSessionId(session.sessionId)}
                            type="button"
                          >
                            <span className="mobileEventTopline">
                              <strong>{getSessionTitle(session)}</strong>
                              {session.missingSupport ? <Icon name="warning" size={16} /> : null}
                            </span>
                            <span className="mobileEventPeople">{getSessionPeople(session)}</span>
                            <span className="mobileEventFooter">
                              <em>{session.format || (session.isSupportOnly ? "Support-only" : "Chưa chọn nơi live")}</em>
                              <i>
                                {session.canConfirmHost ? (session.isHostConfirmed ? "Host ✓" : "Host ·") : ""}
                                {session.canConfirmHost && session.canConfirmSupport ? "  " : ""}
                                {session.canConfirmSupport ? (session.isSupportConfirmed ? "Support ✓" : "Support ·") : ""}
                              </i>
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </div>

          <div className="calendarSurface desktopCalendar" aria-busy={loading || refreshing || readingSchedule}>
            <div className="calendarScroller">
              <div className="weekCalendar">
                <div className="weekHeaderGrid">
                  <div className="timezoneCorner">{timezone || "GMT+7"}</div>
                  {days.map((day) => (
                    <div className={`dayHeader ${day.dateKey === todayKey ? "today" : ""}`} key={day.dateKey}>
                      <span>{day.label}</span>
                      <strong>{parseDateKey(day.dateKey).getDate()}</strong>
                    </div>
                  ))}
                </div>

                <div className="calendarMetaRow">
                  <span>GIỜ</span>
                  <div className="legendItem"><i className="legendStudio" />Studio</div>
                  <div className="legendItem"><i className="legendHome" />Home</div>
                  <div className="legendItem"><i className="legendSupport" />Support-only</div>
                  <div className="legendItem"><i className="legendDanger" />Thiếu support</div>
                </div>

                <div className="timeGrid">
                  {slots.map((slot) => (
                    <div className="timeRow" key={slot}>
                      <div className="timeLabel"><span>{getSlotStart(slot)}</span></div>
                      {days.map((day) => {
                        const daySessions = visibleSessions.filter((session) => session.dateKey === day.dateKey && session.slot === slot);
                        return (
                          <div className={`timeCell ${day.dateKey === todayKey ? "todayColumn" : ""}`} key={`${day.dateKey}-${slot}`}>
                            {daySessions.map((session) => (
                              <button
                                className={`calendarEvent ${getSessionTone(session)}`}
                                aria-label={`Xem ${getSessionTitle(session)}, ${session.slot}`}
                                key={session.sessionId || `${session.rowNumber}-${session.slot}`}
                                onClick={() => setSelectedSessionId(session.sessionId)}
                                type="button"
                              >
                                <span className="eventTopline">
                                  <strong>{getSessionTitle(session)}</strong>
                                  {session.missingSupport ? <Icon name="warning" size={14} /> : null}
                                </span>
                                <span className="eventPeople">{getSessionPeople(session)}</span>
                                <span className="eventMeta">
                                  <em>{session.format || (session.isSupportOnly ? "Support-only" : "Chưa chọn nơi live")}</em>
                                  <i>{session.canConfirmHost ? (session.isHostConfirmed ? "H ✓" : "H ·") : ""} {session.canConfirmSupport ? (session.isSupportConfirmed ? "S ✓" : "S ·") : ""}</i>
                                </span>
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>

                {loading ? <div className="calendarLoading"><span className="loadingSpinner" />Đang tải lịch tuần...</div> : null}
                {!loading && visibleSessions.length === 0 ? (
                  <div className="emptyWeekBanner">Không có ca phù hợp trong tuần này.</div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </div>

      {selectedSession ? (
        <>
          <div className="drawerBackdrop" onClick={() => setSelectedSessionId("")} />
          <aside className="sessionDrawer" role="dialog" aria-modal="true" aria-label={`Chi tiết ${selectedSession.sessionId}`}>
            <div className={`drawerAccent ${getSessionTone(selectedSession)}`} />
            <div className="drawerHeader">
              <div>
                <span className="drawerEyebrow">CHI TIẾT CA LIVE</span>
                <h2>{getSessionTitle(selectedSession)}</h2>
                <p>{formatLongDate(selectedSession.dateKey)} · {selectedSession.slot}</p>
              </div>
              <button className="iconButton" aria-label="Đóng chi tiết" onClick={() => setSelectedSessionId("")} type="button"><Icon name="close" /></button>
            </div>

            {selectedSession.missingSupport ? <div className="drawerAlert danger"><Icon name="warning" />Ca Studio đang thiếu support.</div> : null}
            {selectedSession.isSupportOnly ? <div className="drawerAlert support"><Icon name="check" />Support-only: giữ ca để fill host sau.</div> : null}

            <dl className="drawerDetails">
              <div><dt>Host</dt><dd>{getPersonLabel(selectedSession.hostId, selectedSession.hostName, "Chưa có host")}</dd></div>
              <div><dt>Support</dt><dd>{getPersonLabel(selectedSession.supportId, selectedSession.supportName, "Chưa có support")}</dd></div>
              <div><dt>Hình thức</dt><dd>{selectedSession.format || "Chưa chọn nơi live"}</dd></div>
              <div><dt>Kênh</dt><dd>{selectedSession.channel || "-"}</dd></div>
              <div><dt>Kịch bản</dt><dd>{isUrl(selectedSession.scriptUrl) ? <a href={selectedSession.scriptUrl} target="_blank" rel="noreferrer">Mở kịch bản ↗</a> : selectedSession.scriptUrl || "-"}</dd></div>
              <div><dt>Backup host</dt><dd>{getPersonLabel(selectedSession.backupHostId, selectedSession.backupHostName, "-")}</dd></div>
              <div><dt>Backup support</dt><dd>{getPersonLabel(selectedSession.backupSupportId, selectedSession.backupSupportName, "-")}</dd></div>
              <div><dt>Session ID</dt><dd><code>{selectedSession.sessionId || "-"}</code></dd></div>
              {selectedSession.supportCandidatePool ? <div className="wideDetail"><dt>Support candidate pool</dt><dd>{selectedSession.supportCandidatePool}</dd></div> : null}
            </dl>

            <div className="confirmPanel">
              <div className="confirmPanelTitle"><strong>Xác nhận tham gia</strong><span>Cập nhật trực tiếp vào master</span></div>
              {selectedSession.canConfirmHost && canConfirmSelectedHost ? (
                <button
                  className={`confirmAction ${selectedSession.isHostConfirmed ? "confirmed" : ""}`}
                  disabled={busyConfirm === `${selectedSession.sessionId}:host`}
                  onClick={() => confirmSession(selectedSession, "host", !selectedSession.isHostConfirmed)}
                  type="button"
                >
                  <span><Icon name="check" /></span>
                  <div><strong>{selectedSession.isHostConfirmed ? (isAdmin ? "Host đã xác nhận" : "Bạn đã xác nhận ca này") : (isAdmin ? "Xác nhận host" : "Xác nhận ca host của tôi")}</strong><small>{selectedSession.isHostConfirmed ? `Bấm để huỷ xác nhận ca ${selectedSession.slot}` : getPersonLabel(selectedSession.hostId, selectedSession.hostName, "Host")}</small></div>
                </button>
              ) : null}
              {selectedSession.canConfirmSupport && canConfirmSelectedSupport ? (
                <button
                  className={`confirmAction ${selectedSession.isSupportConfirmed ? "confirmed" : ""}`}
                  disabled={busyConfirm === `${selectedSession.sessionId}:support`}
                  onClick={() => confirmSession(selectedSession, "support", !selectedSession.isSupportConfirmed)}
                  type="button"
                >
                  <span><Icon name="check" /></span>
                  <div><strong>{selectedSession.isSupportConfirmed ? (isAdmin ? "Support đã xác nhận" : "Bạn đã xác nhận ca này") : (isAdmin ? "Xác nhận support" : "Xác nhận ca support của tôi")}</strong><small>{selectedSession.isSupportConfirmed ? `Bấm để huỷ xác nhận ca ${selectedSession.slot}` : getPersonLabel(selectedSession.supportId, selectedSession.supportName, "Support")}</small></div>
                </button>
              ) : null}
              {!isAdmin && selectedSessionIsPast ? (
                <p className="confirmRestriction">Ca này đã qua ngày. Bạn chỉ có thể xem lịch sử; chỉ Admin được xác nhận hoặc huỷ xác nhận ca cũ.</p>
              ) : !isAdmin && !canConfirmSelectedHost && !canConfirmSelectedSupport ? (
                <p className="confirmRestriction">Ca này không được phân công cho tài khoản của bạn. Bạn chỉ có thể xác nhận hoặc huỷ xác nhận đúng ca, đúng vai trò và đúng mã nhân viên của mình.</p>
              ) : null}
            </div>
          </aside>
        </>
      ) : null}
    </main>
  );
}
