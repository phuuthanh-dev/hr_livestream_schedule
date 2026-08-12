"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import AccountPanel from "@/components/AccountPanel";
import { DEFAULT_SCHEDULE_SLOTS } from "@/lib/scheduleConfig";
import { formatLocationCode } from "@/lib/locationUtils";
import {
  addDaysToScheduleDateKey,
  getScheduleWeekDateKeys,
  getScheduleWeekStartKey,
  parseScheduleDateKey
} from "@/lib/scheduleDate";
import type {
  AvailabilityAdminDashboardPayload,
  AvailabilityAdminPerson,
  AvailabilityAdminRoleFilter,
  AvailabilityAdminSlotSummary,
  AvailabilityAdminStatusFilter,
  AvailabilitySubmissionState,
  SchedulePayload
} from "@/lib/types";

type AvailabilityAdminDashboardProps = {
  username: string;
  initialWeekStartKey?: string;
  initialRoleFilter?: "host" | "support";
};

type IconName = "account" | "calendar" | "chart" | "chevronLeft" | "chevronRight" | "location" | "logout" | "refresh" | "users" | "warning";

const DAY_NAMES = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];

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

  if (name === "account") return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
  if (name === "calendar") return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>;
  if (name === "chart") return <svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>;
  if (name === "chevronLeft") return <svg {...common}><path d="m15 18-6-6 6-6" /></svg>;
  if (name === "chevronRight") return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>;
  if (name === "logout") return <svg {...common}><path d="M10 17l5-5-5-5M15 12H3M14 4h4a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-4" /></svg>;
  if (name === "location") return <svg {...common}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
  if (name === "refresh") return <svg {...common}><path d="M20 11a8 8 0 1 0-2.34 5.66" /><path d="M20 4v7h-7" /></svg>;
  if (name === "users") return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>;
  if (name === "warning") return <svg {...common}><path d="M10.3 3.7 2.4 18a2 2 0 0 0 1.75 3h15.7a2 2 0 0 0 1.75-3L13.7 3.7a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>;
  return null;
}

function formatShortDate(dateKey: string) {
  const date = parseScheduleDateKey(dateKey);
  return date ? new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(date) : dateKey;
}

function formatLongDate(dateKey: string) {
  const date = parseScheduleDateKey(dateKey);
  return date
    ? new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit" }).format(date)
    : dateKey;
}

function formatWeekTitle(weekStartKey: string) {
  const start = parseScheduleDateKey(weekStartKey);
  const end = parseScheduleDateKey(addDaysToScheduleDateKey(weekStartKey, 6));
  if (!start || !end) return weekStartKey;
  const formatter = new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric" });
  return start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
    ? formatter.format(start)
    : `${formatter.format(start)} - ${formatter.format(end)}`;
}

function formatWeekRange(weekStartKey: string) {
  return `${formatShortDate(weekStartKey)} - ${formatShortDate(addDaysToScheduleDateKey(weekStartKey, 6))}`;
}

function formatTimestamp(value?: string) {
  if (!value) return "Chưa cập nhật";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function submissionLabel(state: AvailabilitySubmissionState) {
  if (state === "submitted") return "Đã gửi";
  if (state === "locked") return "Đã khóa";
  if (state === "draft") return "Bản nháp";
  return "Chưa đăng ký";
}

function slotKey(dateKey: string, slot: string) {
  return `${dateKey}__${slot}`;
}

function coverageTone(count: number, totalPeople: number) {
  if (count <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / Math.max(totalPeople, 1)) * 4)));
}

function AvailabilityCoverageCodes({ cell }: { cell?: AvailabilityAdminSlotSummary }) {
  const hostIds = cell?.hostEmployeeIds || [];
  const supportIds = cell?.supportEmployeeIds || [];
  if (hostIds.length === 0 && supportIds.length === 0) return null;

  return (
    <span className="availabilityCoverageCodes">
      {hostIds.map((employeeId) => <span className="availabilityCoverageCode host" key={`host-${employeeId}`}><b>H</b>{employeeId}</span>)}
      {supportIds.map((employeeId) => <span className="availabilityCoverageCode support" key={`support-${employeeId}`}><b>S</b>{employeeId}</span>)}
    </span>
  );
}

export default function AvailabilityAdminDashboard({ username, initialWeekStartKey, initialRoleFilter }: AvailabilityAdminDashboardProps) {
  const [weekStartKey, setWeekStartKey] = useState(() => getScheduleWeekStartKey(initialWeekStartKey));
  const [roleFilter, setRoleFilter] = useState<AvailabilityAdminRoleFilter>(initialRoleFilter || "all");
  const [statusFilter, setStatusFilter] = useState<AvailabilityAdminStatusFilter>("all");
  const [payload, setPayload] = useState<AvailabilityAdminDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingSchedule, setGeneratingSchedule] = useState(false);
  const [error, setError] = useState("");
  const [scheduleMessage, setScheduleMessage] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      weekStartKey,
      role: roleFilter,
      status: statusFilter
    });
    setLoading(true);
    setError("");
    setScheduleMessage("");

    void fetch(`/api/availability/summary?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        const nextPayload = (await response.json()) as AvailabilityAdminDashboardPayload;
        if (!response.ok || !nextPayload.success) {
          throw new Error(nextPayload.message || "Không tải được tổng hợp lịch rảnh.");
        }
        setPayload(nextPayload);
      })
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setPayload(null);
        setError(loadError instanceof Error ? loadError.message : "Không tải được tổng hợp lịch rảnh.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [reloadKey, roleFilter, statusFilter, weekStartKey]);

  const summary = payload?.summary;
  const people = payload?.people || [];
  const slotMap = useMemo(() => {
    const nextMap = new Map<string, AvailabilityAdminSlotSummary>();
    (payload?.slots || []).forEach((slot) => nextMap.set(slotKey(slot.dateKey, slot.slot), slot));
    return nextMap;
  }, [payload?.slots]);
  const weekDays = useMemo(
    () => getScheduleWeekDateKeys(weekStartKey).map((dateKey, index) => ({ dateKey, label: DAY_NAMES[index] })),
    [weekStartKey]
  );
  const submissionRate = summary?.totalPeople
    ? Math.round((summary.submittedPeople / summary.totalPeople) * 100)
    : 0;
  const visibleDenominator = Math.max(summary?.visiblePeople || 0, 1);

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function generateWeekSchedule() {
    setGeneratingSchedule(true);
    setError("");
    setScheduleMessage("");

    try {
      const response = await fetch("/api/schedule/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekStartKey })
      });
      const result = (await response.json()) as SchedulePayload;
      if (!response.ok || !result.success) {
        throw new Error(result.message || result.error || "Không chạy được lịch tuần.");
      }
      setScheduleMessage(result.sync?.message || `Đã chạy lịch tuần ${formatWeekRange(weekStartKey)}.`);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Không chạy được lịch tuần.");
    } finally {
      setGeneratingSchedule(false);
    }
  }

  return (
    <main className="availabilityApp availabilitySummaryApp">
      <header className="appHeader availabilityHeader availabilitySummaryHeader">
        <div className="brandBlock">
          <span className="brandMark"><img className="brandLogo" src="/rr-logo-submark-square.png" alt="" /></span>
          <span className="brandName">Tổng hợp lịch rảnh</span>
        </div>

        <div className="dateNavigation">
          <a className="todayButton" href="/">Lịch chính</a>
          <button className="todayButton" onClick={() => setWeekStartKey(getScheduleWeekStartKey())} type="button">Tuần này</button>
          <div className="iconButtonGroup">
            <button className="iconButton" aria-label="Tuần trước" onClick={() => startTransition(() => setWeekStartKey((current) => addDaysToScheduleDateKey(current, -7)))} type="button"><Icon name="chevronLeft" /></button>
            <button className="iconButton" aria-label="Tuần sau" onClick={() => startTransition(() => setWeekStartKey((current) => addDaysToScheduleDateKey(current, 7)))} type="button"><Icon name="chevronRight" /></button>
          </div>
          <div className="currentRange">
            <h1>{formatWeekTitle(weekStartKey)}</h1>
            <span>{formatWeekRange(weekStartKey)}</span>
          </div>
        </div>

        <div className="headerActions">
          <a className="todayButton availabilityLocationShortcut" href="/locations"><Icon name="location" size={17} /><span>Địa điểm</span></a>
          <a className="iconButton" aria-label="Lịch chính" href="/" title="Lịch chính"><Icon name="calendar" /></a>
          <span className="userAvatar" title={`Đăng nhập: ${username}`}>{username.slice(0, 1).toUpperCase()}</span>
          <button className="iconButton" aria-label="Quản lý tài khoản" onClick={() => setAccountPanelOpen(true)} type="button"><Icon name="account" /></button>
          <button className="iconButton" aria-label="Đăng xuất" onClick={logout} type="button"><Icon name="logout" /></button>
        </div>
      </header>

      <section className="availabilitySummaryWorkspace">
        <div className="availabilitySummaryHero">
          <div>
            <span className="availabilitySummaryEyebrow">ADMIN CONTROL CENTER</span>
            <h1>Ai đã sẵn sàng trong tuần?</h1>
            <p>Theo dõi tiến độ gửi lịch và năng lực nhân sự rảnh ở từng khung giờ.</p>
          </div>
          <div className="availabilitySummaryFilters" aria-label="Bộ lọc tổng hợp lịch rảnh">
            <label>
              <span>Vai trò</span>
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as AvailabilityAdminRoleFilter)}>
                <option value="all">Tất cả nhân sự</option>
                <option value="host">Host</option>
                <option value="support">Support Live</option>
              </select>
            </label>
            <label>
              <span>Trạng thái chi tiết</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AvailabilityAdminStatusFilter)}>
                <option value="all">Tất cả trạng thái</option>
                <option value="submitted">Đã gửi</option>
                <option value="not_submitted">Chưa gửi</option>
              </select>
            </label>
            <label>
              <span>Nhân viên</span>
              <select
                value=""
                onChange={(event) => {
                  const person = people.find((item) => `${item.role}:${item.employeeId}` === event.target.value);
                  if (!person) return;
                  window.location.href = `/availability?role=${person.role}&employeeId=${encodeURIComponent(person.employeeId)}&weekStartKey=${weekStartKey}`;
                }}
              >
                <option value="">Xem toàn bộ</option>
                {people.map((person) => (
                  <option key={`${person.role}-${person.employeeId}`} value={`${person.role}:${person.employeeId}`}>
                    {person.employeeName} · {person.employeeId}
                  </option>
                ))}
              </select>
            </label>
            <button className="availabilitySummaryRefresh" disabled={loading} onClick={() => setReloadKey((current) => current + 1)} type="button">
              <Icon name="refresh" size={18} />
              <span>{loading ? "Đang tải" : "Làm mới"}</span>
            </button>
            <button
              className="availabilitySummaryGenerate"
              disabled={loading || generatingSchedule}
              onClick={generateWeekSchedule}
              type="button"
            >
              <span className="availabilitySummaryGenerateIcon"><Icon name="calendar" size={20} /></span>
              <span>
                <strong>{generatingSchedule ? "Đang chạy lịch tuần..." : "Chạy lịch tuần"}</strong>
                <small>Xếp và cập nhật thẳng vào lịch chính</small>
              </span>
              <em>{formatWeekRange(weekStartKey)}</em>
            </button>
          </div>
        </div>

        {error ? <div className="notice errorNotice"><Icon name="warning" />{error}</div> : null}
        {scheduleMessage ? (
          <div className="notice successNotice availabilityScheduleSuccess">
            <Icon name="calendar" />
            <span>{scheduleMessage}</span>
            <a href={`/?weekStartKey=${weekStartKey}`}>Mở lịch chính</a>
          </div>
        ) : null}

        <div className={`availabilitySummaryContent ${loading ? "isLoading" : ""}`} aria-busy={loading}>
          <div className="availabilityKpiGrid">
            <article className="availabilityKpiCard total">
              <span><Icon name="users" size={18} /> Nhân sự hoạt động</span>
              <strong>{summary?.totalPeople ?? "-"}</strong>
              <small>{roleFilter === "all" ? "Host và Support Live" : roleFilter === "host" ? "Host" : "Support Live"}</small>
            </article>
            <article className="availabilityKpiCard submitted">
              <span><Icon name="chart" size={18} /> Đã gửi lịch</span>
              <strong>{summary?.submittedPeople ?? "-"}</strong>
              <small>{submissionRate}% nhân sự đã hoàn tất</small>
            </article>
            <article className="availabilityKpiCard pending">
              <span><Icon name="warning" size={18} /> Chưa gửi</span>
              <strong>{summary?.notSubmittedPeople ?? "-"}</strong>
              <small>{summary ? `${summary.notStartedPeople} chưa đăng ký · ${summary.draftPeople} bản nháp` : "Đang tổng hợp"}</small>
            </article>
            <article className="availabilityKpiCard slots">
              <span><Icon name="calendar" size={18} /> Lượt slot rảnh</span>
              <strong>{summary?.visibleAvailableSlots ?? "-"}</strong>
              <small>{summary?.visiblePeople ?? 0} nhân sự theo bộ lọc trạng thái</small>
            </article>
          </div>

          <section className="availabilityProgressCard">
            <div>
              <span>TIẾN ĐỘ GỬI LỊCH</span>
              <strong>{submissionRate}% hoàn tất</strong>
            </div>
            <div className="availabilityProgressTrack" aria-label={`${submissionRate}% nhân sự đã gửi lịch`}>
              <i style={{ width: `${submissionRate}%` }} />
            </div>
            <p>{summary?.submittedPeople || 0}/{summary?.totalPeople || 0} nhân sự đã gửi lịch rảnh cho tuần {formatWeekRange(weekStartKey)}.</p>
          </section>

          <section className="availabilitySummaryPanel availabilityHeatmapPanel">
            <div className="availabilitySummaryPanelHeader">
              <div>
                <span>ĐỘ PHỦ NHÂN SỰ</span>
                <h2>Số người rảnh theo từng slot</h2>
              </div>
              <p>Mỗi ô hiển thị số người rảnh trong {summary?.visiblePeople || 0} nhân sự theo bộ lọc trạng thái.</p>
            </div>

            <div className="availabilityCoverageLegend">
              <span><i className="host" /> Host</span>
              <span><i className="support" /> Support Live</span>
              <small>Màu càng đậm, số nhân sự rảnh trong slot càng cao. Mỗi nhãn bên dưới là mã nhân viên.</small>
            </div>

            <div className="availabilityHeatmapDesktop">
              <div className="availabilityHeatmapGrid">
                <div className="availabilityHeatmapCorner">Khung giờ</div>
                {weekDays.map((day) => (
                  <div className="availabilityHeatmapDay" key={day.dateKey}>
                    <span>{day.label}</span>
                    <strong>{formatShortDate(day.dateKey)}</strong>
                  </div>
                ))}
                {DEFAULT_SCHEDULE_SLOTS.map((slot) => (
                  <div className="availabilityHeatmapRow" key={slot}>
                    <div className="availabilityHeatmapTime">{slot}</div>
                    {weekDays.map((day) => {
                      const cell = slotMap.get(slotKey(day.dateKey, slot));
                      const count = cell?.peopleAvailable || 0;
                      const tone = coverageTone(count, visibleDenominator);
                      const employeeCodes = [...(cell?.hostEmployeeIds || []), ...(cell?.supportEmployeeIds || [])];
                      return (
                        <div
                          className={`availabilityHeatmapCell ${count > 0 ? "hasPeople" : ""} coverage-${roleFilter} tone-${tone}`}
                          key={`${day.dateKey}-${slot}`}
                          title={`${day.label} ${formatShortDate(day.dateKey)}, ${slot}: ${count} người rảnh${employeeCodes.length ? ` · ${employeeCodes.join(", ")}` : ""}`}
                        >
                          <strong>{count}</strong>
                          {count > 0 ? <span className="availabilityCoverageBreakdown">Host {cell?.hostAvailable || 0} · Support {cell?.supportAvailable || 0}</span> : null}
                          <AvailabilityCoverageCodes cell={cell} />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <div className="availabilityHeatmapMobile">
              {weekDays.map((day) => (
                <article className="availabilityMobileCoverageDay" key={day.dateKey}>
                  <header><strong>{formatLongDate(day.dateKey)}</strong><span>{formatShortDate(day.dateKey)}</span></header>
                  <div>
                    {DEFAULT_SCHEDULE_SLOTS.map((slot) => {
                      const cell = slotMap.get(slotKey(day.dateKey, slot));
                      const count = cell?.peopleAvailable || 0;
                      const tone = coverageTone(count, visibleDenominator);
                      return (
                        <div className={`availabilityMobileCoverageSlot ${count > 0 ? "hasPeople" : ""} coverage-${roleFilter} tone-${tone}`} key={slot}>
                          <span>{slot}</span>
                          <i><b style={{ width: `${Math.min(100, (count / visibleDenominator) * 100)}%` }} /></i>
                          <strong>{count}</strong>
                          <AvailabilityCoverageCodes cell={cell} />
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="availabilitySummaryPanel availabilityPeoplePanel">
            <div className="availabilitySummaryPanelHeader">
              <div>
                <span>DANH SÁCH VẬN HÀNH</span>
                <h2>Tiến độ từng nhân sự</h2>
              </div>
              <p>{people.length} nhân sự khớp bộ lọc · ưu tiên người chưa đăng ký và bản nháp ở đầu danh sách.</p>
            </div>

            {people.length === 0 && !loading ? (
              <div className="availabilitySummaryEmpty"><Icon name="users" size={28} /><strong>Không có nhân sự phù hợp</strong><span>Hãy đổi bộ lọc vai trò hoặc trạng thái.</span></div>
            ) : (
              <div className="availabilityPeopleTableWrap">
                <table className="availabilityPeopleTable">
                  <thead><tr><th>Nhân sự</th><th>Vai trò</th><th>Trạng thái</th><th>Slot rảnh</th><th>Cập nhật</th><th /></tr></thead>
                  <tbody>
                    {people.map((person) => <AvailabilityPersonRow key={`${person.role}-${person.employeeId}`} person={person} weekStartKey={weekStartKey} />)}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {payload?.generatedAt ? <p className="availabilitySummaryFreshness">Nguồn: MongoDB schedule_people + schedule_availability_weeks/slots · truy vấn lúc {formatTimestamp(payload.generatedAt)}.</p> : null}
        </div>
      </section>

      {accountPanelOpen ? <AccountPanel isAdmin username={username} onClose={() => setAccountPanelOpen(false)} /> : null}
    </main>
  );
}

function AvailabilityPersonRow({ person, weekStartKey }: { person: AvailabilityAdminPerson; weekStartKey: string }) {
  const detailUrl = `/availability?role=${person.role}&employeeId=${encodeURIComponent(person.employeeId)}&weekStartKey=${weekStartKey}`;
  return (
    <tr>
      <td><span className="availabilityPersonIdentity"><i>{person.employeeName.slice(0, 1).toUpperCase()}</i><span><strong>{person.employeeName}</strong><small>{person.employeeId}{person.level ? ` · ${person.level}` : ""}{person.role === "host" ? ` · ${formatLocationCode(person.workLocation)}` : ""}</small></span></span></td>
      <td><span className={`availabilityRoleBadge ${person.role}`}>{person.role === "host" ? "Host" : "Support"}</span></td>
      <td><span className={`availabilitySubmissionBadge ${person.submissionState}`}>{submissionLabel(person.submissionState)}</span></td>
      <td><strong className="availabilitySlotCount">{person.availableSlots}</strong></td>
      <td><span className="availabilityUpdatedAt">{formatTimestamp(person.submittedAt || person.updatedAt)}</span></td>
      <td><a className="availabilityOpenPerson" href={detailUrl}>Mở lịch</a></td>
    </tr>
  );
}
