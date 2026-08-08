"use client";

import { startTransition, useDeferredValue, useEffect, useState } from "react";
import type { ConfirmRole, SchedulePayload, ScheduleSession, ScheduleSummary } from "@/lib/types";

type ScheduleDashboardProps = {
  username: string;
};

type FilterMode = "all" | "warnings" | "pending";

const DAY_NAMES = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "CN"];

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

function getCurrentWeekStartKey() {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const dayOffset = (today.getDay() + 6) % 7;
  today.setDate(today.getDate() - dayOffset);
  return toDateKey(today);
}

function formatShortDate(dateKey: string) {
  const date = parseDateKey(dateKey);
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit"
  }).format(date);
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

function getPersonLabel(id: string, name: string, emptyLabel: string) {
  if (!id && !name) return emptyLabel;
  if (!name || name === id) return id;
  return `${name} · ${id}`;
}

function isUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

export default function ScheduleDashboard({ username }: ScheduleDashboardProps) {
  const [weekStartKey, setWeekStartKey] = useState(getCurrentWeekStartKey);
  const [sessions, setSessions] = useState<ScheduleSession[]>([]);
  const [summary, setSummary] = useState<ScheduleSummary>(emptySummary);
  const [generatedAt, setGeneratedAt] = useState("");
  const [timezone, setTimezone] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [busyConfirm, setBusyConfirm] = useState("");
  const deferredQuery = useDeferredValue(query);

  const weekEndKey = addDays(weekStartKey, 6);
  const days = DAY_NAMES.map((label, index) => ({
    label,
    dateKey: addDays(weekStartKey, index)
  }));
  const visibleSessions = sessions.filter(
    (session) => sessionMatchesQuery(session, deferredQuery) && sessionMatchesFilter(session, filter)
  );
  const weekSummary = summary.total ? summary : buildSummary(sessions);

  async function applyPayload(payload: SchedulePayload) {
    setSessions(payload.rows || []);
    setSummary(payload.summary || buildSummary(payload.rows || []));
    setGeneratedAt(payload.generatedAt || "");
    setTimezone(payload.timezone || "");
  }

  async function loadSchedule() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/schedule?from=${weekStartKey}&to=${weekEndKey}`, {
        cache: "no-store"
      });
      const payload = (await response.json()) as SchedulePayload;

      if (!response.ok || !payload.success) {
        throw new Error(payload.message || payload.error || "Không tải được lịch.");
      }

      await applyPayload(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không tải được lịch.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshFromSheet() {
    setRefreshing(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/refresh", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          from: weekStartKey,
          to: weekEndKey
        })
      });
      const payload = (await response.json()) as SchedulePayload;

      if (!response.ok || !payload.success) {
        throw new Error(payload.message || payload.error || "Không cập nhật được lịch.");
      }

      await applyPayload(payload);
      setMessage(payload.sync?.message || "Đã cập nhật lịch từ Google Sheet.");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Không cập nhật được lịch.");
    } finally {
      setRefreshing(false);
    }
  }

  async function confirmSession(session: ScheduleSession, role: ConfirmRole, confirmed: boolean) {
    const busyKey = `${session.sessionId}:${role}`;
    setBusyConfirm(busyKey);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/confirm", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
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

      await applyPayload(payload);
      setMessage(`${confirmed ? "Đã xác nhận" : "Đã huỷ xác nhận"} ${role} cho ${session.sessionId}.`);
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
    startTransition(() => {
      setWeekStartKey(addDays(weekStartKey, delta * 7));
    });
  }

  useEffect(() => {
    void loadSchedule();
  }, [weekStartKey]);

  return (
    <main className="dashboardShell">
      <section className="heroPanel">
        <div>
          <p className="eyebrow">Live_Session_Master · Weekly Calendar</p>
          <h1>Lịch livestream tuần {formatWeekRange(weekStartKey)}</h1>
          <p className="heroCopy">
            Sync từ Google Sheet master, giữ support-only, cảnh báo Studio thiếu support và confirm ngay trên web.
          </p>
        </div>
        <div className="heroActions">
          <button className="secondaryButton" onClick={() => shiftWeek(-1)} type="button">
            Tuần trước
          </button>
          <button className="secondaryButton" onClick={() => setWeekStartKey(getCurrentWeekStartKey())} type="button">
            Tuần này
          </button>
          <button className="secondaryButton" onClick={() => shiftWeek(1)} type="button">
            Tuần sau
          </button>
          <button className="primaryButton" onClick={refreshFromSheet} disabled={refreshing} type="button">
            {refreshing ? "Đang cập nhật..." : "Cập nhật từ Google Sheet"}
          </button>
        </div>
      </section>

      <section className="toolbarPanel">
        <div className="statCard dangerStat">
          <span>Thiếu support</span>
          <strong>{weekSummary.missingSupport}</strong>
        </div>
        <div className="statCard">
          <span>Support-only</span>
          <strong>{weekSummary.supportOnly}</strong>
        </div>
        <div className="statCard">
          <span>Chờ host confirm</span>
          <strong>{weekSummary.pendingHostConfirm}</strong>
        </div>
        <div className="statCard">
          <span>Chờ support confirm</span>
          <strong>{weekSummary.pendingSupportConfirm}</strong>
        </div>
        <label className="searchBox">
          Tìm nhanh
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Host, support, kênh, session..."
          />
        </label>
        <div className="segmentedControl" aria-label="Bộ lọc lịch">
          {[
            ["all", "Tất cả"],
            ["warnings", "Cảnh báo"],
            ["pending", "Chờ confirm"]
          ].map(([value, label]) => (
            <button
              className={filter === value ? "active" : ""}
              key={value}
              onClick={() => setFilter(value as FilterMode)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="statusStrip">
        <span>Đăng nhập: {username}</span>
        <span>{generatedAt ? `Cập nhật: ${new Date(generatedAt).toLocaleString("vi-VN")}` : "Chưa có timestamp"}</span>
        <span>{timezone ? `Timezone sheet: ${timezone}` : "Timezone sheet: -"}</span>
        <button onClick={logout} type="button">Đăng xuất</button>
      </section>

      {error ? <div className="notice errorNotice">{error}</div> : null}
      {message ? <div className="notice successNotice">{message}</div> : null}

      <section className="calendarGrid" aria-busy={loading || refreshing}>
        {days.map((day) => {
          const daySessions = visibleSessions.filter((session) => session.dateKey === day.dateKey);

          return (
            <article className="dayColumn" key={day.dateKey}>
              <header>
                <span>{day.label}</span>
                <strong>{formatShortDate(day.dateKey)}</strong>
              </header>

              {loading ? <div className="emptyDay">Đang tải lịch...</div> : null}
              {!loading && daySessions.length === 0 ? <div className="emptyDay">Không có ca</div> : null}

              {!loading && daySessions.map((session) => (
                <div
                  className={[
                    "sessionCard",
                    session.missingSupport ? "missingSupportCard" : "",
                    session.isSupportOnly ? "supportOnlyCard" : ""
                  ].join(" ")}
                  key={session.sessionId || `${session.rowNumber}-${session.slot}`}
                >
                  <div className="sessionTopline">
                    <span className="slotPill">{session.slot || "Chưa có giờ"}</span>
                    <span className={session.format.toLowerCase().includes("studio") ? "formatPill studio" : "formatPill"}>
                      {session.format || "Chưa chọn nơi live"}
                    </span>
                  </div>

                  {session.missingSupport ? (
                    <p className="cardWarning">Cảnh báo: ca Studio đang thiếu support.</p>
                  ) : null}
                  {session.isSupportOnly ? (
                    <p className="cardInfo">Support-only: giữ ca support để fill host sau.</p>
                  ) : null}

                  <dl className="sessionDetails">
                    <div>
                      <dt>Host</dt>
                      <dd>{getPersonLabel(session.hostId, session.hostName, "Chưa có host")}</dd>
                    </div>
                    <div>
                      <dt>Support</dt>
                      <dd>{getPersonLabel(session.supportId, session.supportName, "Chưa có support")}</dd>
                    </div>
                    <div>
                      <dt>Kênh</dt>
                      <dd>{session.channel || "-"}</dd>
                    </div>
                    <div>
                      <dt>Kịch bản</dt>
                      <dd>
                        {isUrl(session.scriptUrl) ? (
                          <a href={session.scriptUrl} target="_blank" rel="noreferrer">Mở link</a>
                        ) : (
                          session.scriptUrl || "-"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Backup</dt>
                      <dd>
                        {[session.backupHostId, session.backupSupportId].filter(Boolean).join(" / ") || "-"}
                      </dd>
                    </div>
                    <div>
                      <dt>Session</dt>
                      <dd className="sessionId">{session.sessionId || "-"}</dd>
                    </div>
                  </dl>

                  <div className="confirmRow">
                    {session.canConfirmHost ? (
                      <button
                        className={session.isHostConfirmed ? "confirmedButton" : "outlineButton"}
                        disabled={busyConfirm === `${session.sessionId}:host`}
                        onClick={() => confirmSession(session, "host", !session.isHostConfirmed)}
                        type="button"
                      >
                        {session.isHostConfirmed ? "Host đã confirm" : "Confirm host"}
                      </button>
                    ) : null}
                    {session.canConfirmSupport ? (
                      <button
                        className={session.isSupportConfirmed ? "confirmedButton" : "outlineButton"}
                        disabled={busyConfirm === `${session.sessionId}:support`}
                        onClick={() => confirmSession(session, "support", !session.isSupportConfirmed)}
                        type="button"
                      >
                        {session.isSupportConfirmed ? "Support đã confirm" : "Confirm support"}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </article>
          );
        })}
      </section>
    </main>
  );
}
