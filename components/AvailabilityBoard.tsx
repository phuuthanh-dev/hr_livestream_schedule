"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import AccountPanel from "@/components/AccountPanel";
import AppShellHeader from "@/components/AppShellHeader";
import { DEFAULT_SCHEDULE_SLOTS } from "@/lib/scheduleConfig";
import { formatLocationCode, getDefaultAvailabilityLocation, normalizeLocationCode } from "@/lib/locationUtils";
import {
  addDaysToScheduleDateKey,
  getScheduleTodayKey,
  getScheduleWeekDateKeys,
  getScheduleWeekStartKey,
  isScheduleSlotInPast,
  parseScheduleDateKey
} from "@/lib/scheduleDate";
import type {
  AvailabilityPayload,
  AvailabilityLocationPreference,
  AvailabilitySlot,
  AvailabilitySummary,
  AvailabilityWeek,
  EmployeeRole,
  SchedulePerson
} from "@/lib/types";

type AvailabilityBoardProps = {
  username: string;
  isAdmin: boolean;
  employeeRole?: EmployeeRole;
  employeeId?: string;
  initialWeekStartKey?: string;
  initialAdminRole?: EmployeeRole;
  initialAdminEmployeeId?: string;
};

type PeopleResponse = {
  success?: boolean;
  hosts?: SchedulePerson[];
  supports?: SchedulePerson[];
  message?: string;
};

type IconName = "account" | "calendar" | "chart" | "check" | "chevronLeft" | "chevronRight" | "logout" | "warning";

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

  if (name === "account") {
    return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
  }
  if (name === "calendar") {
    return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" /></svg>;
  }
  if (name === "chart") {
    return <svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>;
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
  if (name === "logout") {
    return <svg {...common}><path d="M10 17l5-5-5-5M15 12H3M14 4h4a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-4" /></svg>;
  }
  if (name === "warning") {
    return <svg {...common}><path d="M10.3 3.7 2.4 18a2 2 0 0 0 1.75 3h15.7a2 2 0 0 0 1.75-3L13.7 3.7a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>;
  }
  return null;
}

function formatShortDate(dateKey: string) {
  const date = parseScheduleDateKey(dateKey);
  if (!date) return dateKey;
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(date);
}

function formatLongDate(dateKey: string) {
  const date = parseScheduleDateKey(dateKey);
  if (!date) return dateKey;
  return new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatWeekTitle(weekStartKey: string) {
  const start = parseScheduleDateKey(weekStartKey);
  const end = parseScheduleDateKey(addDaysToScheduleDateKey(weekStartKey, 6));
  if (!start || !end) return weekStartKey;
  const formatter = new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric" });
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return formatter.format(start);
  }
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function formatWeekRange(weekStartKey: string) {
  return `${formatShortDate(weekStartKey)} - ${formatShortDate(addDaysToScheduleDateKey(weekStartKey, 6))}`;
}

function buildSummary(slots: AvailabilitySlot[]): AvailabilitySummary {
  return slots.reduce<AvailabilitySummary>(
    (summary, slot) => {
      if (!slot.available) return summary;
      summary.availableSlots += 1;
      if (slot.locationPreference) {
        summary.availableByLocation[slot.locationPreference] =
          (summary.availableByLocation[slot.locationPreference] || 0) + 1;
      }
      return summary;
    },
    {
      totalSlots: DEFAULT_SCHEDULE_SLOTS.length * 7,
      availableSlots: 0,
      availableByLocation: {}
    }
  );
}

function statusLabel(status: AvailabilityWeek["status"]) {
  if (status === "submitted") return "Đã gửi";
  if (status === "locked") return "Đã khóa";
  return "Bản nháp";
}

function buildSlotKey(dateKey: string, slot: string) {
  return `${dateKey}__${slot}`;
}

function availabilityLocationLabel(value?: AvailabilityLocationPreference) {
  if (value === "studio") return "Studio";
  if (value === "home") return "Home";
  return "Chưa xác định";
}

export default function AvailabilityBoard({
  username,
  isAdmin,
  employeeRole,
  employeeId,
  initialWeekStartKey,
  initialAdminRole,
  initialAdminEmployeeId
}: AvailabilityBoardProps) {
  const [weekStartKey, setWeekStartKey] = useState(() => getScheduleWeekStartKey(initialWeekStartKey));
  const [week, setWeek] = useState<AvailabilityWeek | null>(null);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [hosts, setHosts] = useState<SchedulePerson[]>([]);
  const [supports, setSupports] = useState<SchedulePerson[]>([]);
  const [selectedRole, setSelectedRole] = useState<EmployeeRole>(initialAdminRole || employeeRole || "host");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(initialAdminEmployeeId || employeeId || "");
  const [loadingPeople, setLoadingPeople] = useState(isAdmin);
  const [loadingWeek, setLoadingWeek] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [selectedMobileDateKey, setSelectedMobileDateKey] = useState(getScheduleTodayKey);

  const weekDays = useMemo(
    () =>
      getScheduleWeekDateKeys(weekStartKey).map((dateKey, index) => ({
        dateKey,
        label: DAY_NAMES[index] || dateKey
      })),
    [weekStartKey]
  );
  const todayKey = getScheduleTodayKey();
  const selectedPeople = selectedRole === "host" ? hosts : supports;
  const selectedPerson = selectedPeople.find((person) => person.id === selectedEmployeeId) || null;
  const activeRole = isAdmin ? selectedRole : employeeRole;
  const activeWorkLocation = activeRole === "host"
    ? selectedPerson?.workLocation || week?.workLocation
    : undefined;
  const defaultAvailabilityLocation = activeRole === "host"
    ? getDefaultAvailabilityLocation(activeWorkLocation)
    : undefined;
  const canAdminOverrideLocation = isAdmin && activeRole === "host" && normalizeLocationCode(activeWorkLocation) === "both";
  const hasValidTargetLocation = activeRole !== "host" || (Boolean(activeWorkLocation) && week?.workLocationActive !== false);
  const hasTargetSelection = Boolean((isAdmin ? selectedRole : employeeRole) && (isAdmin ? selectedEmployeeId : employeeId));
  const hasEditableSlots = weekDays.some((day) =>
    DEFAULT_SCHEDULE_SLOTS.some((slot) => !isScheduleSlotInPast(day.dateKey, slot))
  );
  const summary = useMemo(() => buildSummary(slots), [slots]);
  const slotMap = useMemo(() => {
    const nextMap = new Map<string, AvailabilitySlot>();
    slots.forEach((slot) => {
      nextMap.set(buildSlotKey(slot.dateKey, slot.slot), slot);
    });
    return nextMap;
  }, [slots]);
  const selectedMobileDay = weekDays.find((day) => day.dateKey === selectedMobileDateKey) || weekDays[0];
  const workLocationGuidance = activeRole !== "host"
    ? "Support Live chỉ cần đánh dấu slot rảnh"
    : normalizeLocationCode(activeWorkLocation) === "both"
      ? isAdmin
        ? "Both: slot mới mặc định Home; Admin có thể chuyển sang Studio."
        : "Both: các slot mới mặc định đăng ký tại Home."
      : `Hồ sơ: ${formatLocationCode(activeWorkLocation)} · Đăng ký tại ${availabilityLocationLabel(defaultAvailabilityLocation)}`;

  useEffect(() => {
    const dateKeys = getScheduleWeekDateKeys(weekStartKey);
    if (dateKeys.includes(selectedMobileDateKey)) return;
    const today = getScheduleTodayKey();
    setSelectedMobileDateKey(dateKeys.includes(today) ? today : dateKeys[0]);
  }, [selectedMobileDateKey, weekStartKey]);

  async function loadPeople() {
    if (!isAdmin) return;
    setLoadingPeople(true);

    try {
      const response = await fetch("/api/people", { cache: "no-store" });
      const payload = (await response.json()) as PeopleResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message || "Không tải được danh sách nhân viên.");
      }
      setHosts(payload.hosts || []);
      setSupports(payload.supports || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không tải được danh sách nhân viên.");
    } finally {
      setLoadingPeople(false);
    }
  }

  useEffect(() => {
    void loadPeople();
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || loadingPeople) return;
    const nextPeople = selectedRole === "host" ? hosts : supports;
    if (selectedEmployeeId && !nextPeople.some((person) => person.id === selectedEmployeeId)) {
      setSelectedEmployeeId("");
    }
  }, [hosts, isAdmin, loadingPeople, selectedEmployeeId, selectedRole, supports]);

  useEffect(() => {
    const role = isAdmin ? selectedRole : employeeRole;
    const personId = isAdmin ? selectedEmployeeId : employeeId;

    if (!role || !personId) {
      setWeek(null);
      setSlots([]);
      setCanEdit(false);
      setLoadingWeek(false);
      return;
    }

    let active = true;
    setLoadingWeek(true);
    setError("");
    setMessage("");

    const params = new URLSearchParams({
      weekStartKey,
      role,
      employeeId: personId
    });

    void fetch(`/api/availability?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as AvailabilityPayload;
        if (!response.ok || !payload.success || !payload.week) {
          throw new Error(payload.message || "Không tải được lịch rảnh.");
        }
        if (!active) return;
        setWeek(payload.week);
        setSlots(payload.week.slots || []);
        setCanEdit(Boolean(payload.canEdit));
        setDirty(false);
      })
      .catch((loadError) => {
        if (!active) return;
        setWeek(null);
        setSlots([]);
        setCanEdit(false);
        setError(loadError instanceof Error ? loadError.message : "Không tải được lịch rảnh.");
      })
      .finally(() => {
        if (active) setLoadingWeek(false);
      });

    return () => {
      active = false;
    };
  }, [employeeId, employeeRole, isAdmin, selectedEmployeeId, selectedRole, weekStartKey]);

  async function persistAvailability(mode: "save" | "submit") {
    const role = isAdmin ? selectedRole : employeeRole;
    const personId = isAdmin ? selectedEmployeeId : employeeId;
    if (!role || !personId) return;

    const endpoint = mode === "save" ? "/api/availability" : "/api/availability/submit";
    const method = mode === "save" ? "PUT" : "POST";
    const setBusy = mode === "save" ? setSaving : setSubmitting;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          weekStartKey,
          role,
          employeeId: personId,
          slots
        })
      });
      const payload = (await response.json()) as AvailabilityPayload;
      if (!response.ok || !payload.success || !payload.week) {
        throw new Error(payload.message || "Không cập nhật được lịch rảnh.");
      }

      setWeek(payload.week);
      setSlots(payload.week.slots || []);
      setCanEdit(Boolean(payload.canEdit));
      setDirty(false);
      setMessage(
        payload.message ||
          (mode === "save" ? "Đã lưu bản nháp lịch rảnh." : "Đã gửi lịch rảnh cho admin.")
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Không cập nhật được lịch rảnh.");
    } finally {
      setBusy(false);
    }
  }

  function toggleSlot(dateKey: string, slot: string) {
    if (!canEdit || !hasValidTargetLocation || isScheduleSlotInPast(dateKey, slot)) return;
    setSlots((current) => {
      const existingKey = buildSlotKey(dateKey, slot);
      const existing = current.find((item) => buildSlotKey(item.dateKey, item.slot) === existingKey);
      const next = existing
        ? current.filter((item) => buildSlotKey(item.dateKey, item.slot) !== existingKey)
        : current.concat({
            dateKey,
            slot,
            available: true,
            locationPreference: activeRole === "host" ? defaultAvailabilityLocation : undefined
          });
      return next.sort((left, right) => {
        if (left.dateKey !== right.dateKey) return left.dateKey.localeCompare(right.dateKey);
        return DEFAULT_SCHEDULE_SLOTS.indexOf(left.slot as (typeof DEFAULT_SCHEDULE_SLOTS)[number]) -
          DEFAULT_SCHEDULE_SLOTS.indexOf(right.slot as (typeof DEFAULT_SCHEDULE_SLOTS)[number]);
      });
    });
    setDirty(true);
  }

  function updateSlotLocation(dateKey: string, slot: string, locationPreference: AvailabilityLocationPreference) {
    if (!canAdminOverrideLocation || !canEdit || !hasValidTargetLocation || isScheduleSlotInPast(dateKey, slot)) return;
    const slotKey = buildSlotKey(dateKey, slot);
    setSlots((current) => current.map((item) =>
      buildSlotKey(item.dateKey, item.slot) === slotKey ? { ...item, locationPreference } : item
    ));
    setDirty(true);
  }

  function changeAdminRole(role: EmployeeRole) {
    setSelectedRole(role);
    setSelectedEmployeeId("");
    setWeek(null);
    setSlots([]);
    setDirty(false);
    setMessage("");
    setError("");
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <main className="availabilityApp">
      <AppShellHeader
        className="availabilityHeader"
        middleContent={(
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
        )}
        onLogout={logout}
        onOpenAccount={() => setAccountPanelOpen(true)}
        rightContent={isAdmin ? <a className="todayButton availabilitySummaryShortcut" href={`/availability/summary?role=${selectedRole}&weekStartKey=${weekStartKey}`}><Icon name="chart" size={17} /><span>Tổng hợp</span></a> : null}
        title="Lịch Rảnh"
        username={username}
      />

      <div className="availabilityShell">
        <aside className="availabilitySidebar">
          <section className="availabilityCard availabilityIntroCard">
            <span className="availabilityEyebrow">ĐĂNG KÝ THEO TUẦN</span>
            <strong>Đăng ký lịch rảnh theo tuần</strong>
            <p>
              Chọn các slot bạn có thể nhận ca. Admin sẽ dùng dữ liệu này để tạo lịch nháp và publish lịch chính thức.
            </p>
          </section>

          <section className="availabilityCard">
            <div className="availabilityCardHeader">
              <strong>Đối tượng</strong>
              <span>{isAdmin ? "Admin có thể xem và chỉnh giúp" : "Bạn đang chỉnh lịch của chính mình"}</span>
            </div>
            {isAdmin ? (
              <div className="availabilityTargetForm">
                <label>
                  Vai trò
                  <select value={selectedRole} onChange={(event) => changeAdminRole(event.target.value as EmployeeRole)} disabled={loadingPeople}>
                    <option value="host">Host</option>
                    <option value="support">Support Live</option>
                  </select>
                </label>
                <label>
                  Nhân viên
                  <select value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)} disabled={loadingPeople || selectedPeople.length === 0}>
                    <option value="">{loadingPeople ? "Đang tải..." : selectedPeople.length === 0 ? "Chưa có nhân sự" : "Chọn nhân sự để xem lịch"}</option>
                    {selectedPeople.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name} · {person.id}{person.role === "host" ? ` · ${formatLocationCode(person.workLocation)}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <div className="availabilityTargetReadOnly">
                <strong>{week?.employeeName || username}</strong>
                <span>{employeeRole === "host" ? "Host" : "Support Live"} · {employeeId || "-"}</span>
              </div>
            )}
          </section>

          {!isAdmin || selectedPerson ? (
            <>
              <section className="availabilityCard">
                <div className="availabilityCardHeader">
                  <strong>Trạng thái tuần</strong>
                  <span>{week ? formatWeekRange(week.weekStartKey) : formatWeekRange(weekStartKey)}</span>
                </div>
                <div className="availabilityStatusRow">
                  <span className={`availabilityStatusBadge ${week?.status || "draft"}`}>{statusLabel(week?.status || "draft")}</span>
                  {dirty ? <em className="availabilityDirtyFlag">Chưa lưu</em> : null}
                </div>
                {week?.submittedAt ? <p className="availabilityMetaLine">Đã gửi lúc {new Date(week.submittedAt).toLocaleString("vi-VN")}</p> : null}
                {week?.lockedAt ? <p className="availabilityMetaLine danger">Đã khóa lúc {new Date(week.lockedAt).toLocaleString("vi-VN")}</p> : null}
                {week?.lockedReason ? <p className="availabilityMetaLine danger">{week.lockedReason}</p> : null}
              </section>

              <section className="availabilityCard">
                <div className="availabilityCardHeader">
                  <strong>Tổng quan tuần</strong>
                  <span>{summary.availableSlots}/{summary.totalSlots} slot rảnh</span>
                </div>
                <div className={`availabilityMetrics ${activeRole === "support" ? "supportOnly" : ""}`}>
                  {activeRole === "host" ? <div><span>Home</span><strong>{summary.availableByLocation.home || 0}</strong></div> : null}
                  {activeRole === "host" ? <div><span>Studio</span><strong>{summary.availableByLocation.studio || 0}</strong></div> : null}
                  {activeRole === "support" ? <div><span>Slot rảnh</span><strong>{summary.availableSlots}</strong></div> : null}
                </div>
              </section>

              <section className="availabilityCard availabilitySidebarActions">
                <div className="availabilityCardHeader">
                  <strong>Thao tác</strong>
                  <span>{!activeWorkLocation ? "Cần cấu hình địa điểm trong hồ sơ Host." : week?.workLocationActive === false ? "Địa điểm của Host đang tạm ngưng." : canEdit ? "Có thể chỉnh các slot chưa bắt đầu." : "Tuần này không còn slot có thể chỉnh."}</span>
                </div>
                <div className="availabilityActions">
                  <button className="syncButton peopleSyncButton" disabled={!canEdit || !hasEditableSlots || !hasValidTargetLocation || saving || loadingWeek || !hasTargetSelection} onClick={() => void persistAvailability("save")} type="button">
                    <Icon name="calendar" />
                    <span>{saving ? "Đang lưu..." : isAdmin ? "Lưu thay đổi" : "Lưu nháp"}</span>
                  </button>
                  {!isAdmin ? (
                    <button className="syncButton" disabled={!canEdit || !hasEditableSlots || !hasValidTargetLocation || submitting || loadingWeek || !hasTargetSelection || slots.length === 0} onClick={() => void persistAvailability("submit")} type="button">
                      <Icon name="check" />
                      <span>{submitting ? "Đang gửi..." : "Gửi lịch rảnh"}</span>
                    </button>
                  ) : null}
                </div>
              </section>
            </>
          ) : null}
        </aside>

        <section className="availabilityWorkspace">
          {error ? <div className="notice errorNotice"><Icon name="warning" />{error}</div> : null}
          {message ? <div className="notice successNotice"><Icon name="check" />{message}</div> : null}

          {loadingWeek ? (
            <div className="availabilityLoadingPanel"><span className="loadingSpinner" />Đang tải lịch rảnh...</div>
          ) : !selectedPerson && isAdmin ? (
            <div className="availabilityEmptyState">
              <Icon name="calendar" size={26} />
              <strong>Chọn nhân sự để bắt đầu</strong>
              <span>Admin chọn host hoặc support ở cột bên trái để xem và cập nhật lịch rảnh theo tuần.</span>
            </div>
          ) : (
            <div className="availabilitySurface">
              <div className="availabilityWeekHeader">
                <div>
                  <span>{isAdmin ? "ĐANG XEM LỊCH RẢNH" : "LỊCH RẢNH CỦA BẠN"}</span>
                  <strong>{week?.employeeName || selectedPerson?.name || username}</strong>
                  <p>{formatWeekTitle(weekStartKey)} · {formatWeekRange(weekStartKey)}</p>
                </div>
                <em>{workLocationGuidance}</em>
              </div>

              <div className="availabilityDesktopBoard">
                <div className="availabilityGrid">
                  <div className="availabilityGridHead slotCorner">Khung giờ</div>
                  {weekDays.map((day) => (
                    <div className={`availabilityGridHead ${day.dateKey === todayKey ? "today" : ""}`} key={day.dateKey}>
                      <span>{day.label}</span>
                      <strong>{formatShortDate(day.dateKey)}</strong>
                    </div>
                  ))}

                  {DEFAULT_SCHEDULE_SLOTS.map((slot) => (
                    <div className="availabilityGridRow" key={slot}>
                      <div className="availabilitySlotLabel">{slot}</div>
                      {weekDays.map((day) => {
                        const currentSlot = slotMap.get(buildSlotKey(day.dateKey, slot));
                        const active = Boolean(currentSlot);
                        const past = isScheduleSlotInPast(day.dateKey, slot);
                        return (
                          <div className={`availabilityCell ${past ? "past" : ""}`} key={`${day.dateKey}-${slot}`}>
                            <button
                              aria-pressed={active}
                              className={`availabilityCellButton ${active ? "active" : ""} ${past ? "past" : ""}`}
                              disabled={!canEdit || !hasValidTargetLocation || past}
                              onClick={() => toggleSlot(day.dateKey, slot)}
                              title={past ? "Khung giờ đã bắt đầu và không thể chỉnh sửa" : undefined}
                              type="button"
                            >
                              <span>{active ? "Sẵn sàng" : past ? "Đã qua" : "Để trống"}</span>
                              <strong>{active ? activeRole === "host" ? availabilityLocationLabel(currentSlot?.locationPreference || defaultAvailabilityLocation) : "Đã đăng ký" : past ? "Không thể đăng ký" : "Chưa đăng ký"}</strong>
                            </button>
                            {canAdminOverrideLocation && active && !past ? (
                              <div className="availabilitySlotLocationSelector" role="group" aria-label={`Địa điểm đăng ký ${day.dateKey} ${slot}`}>
                                {(["home", "studio"] as const).map((location) => (
                                  <button
                                    aria-pressed={(currentSlot?.locationPreference || "home") === location}
                                    className={(currentSlot?.locationPreference || "home") === location ? `active ${location}` : ""}
                                    disabled={!canEdit || !hasValidTargetLocation}
                                    key={location}
                                    onClick={() => updateSlotLocation(day.dateKey, slot, location)}
                                    type="button"
                                  >
                                    {availabilityLocationLabel(location)}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>

                <div className="availabilityLegend">
                <span><i className="legendChip active" /> Slot đã đăng ký</span>
                <span><i className="legendChip" /> Slot chưa đăng ký</span>
                <span><i className="legendChip past" /> Slot đã qua</span>
                <span><i className="legendChip today" /> Cột hôm nay</span>
                </div>
                <div className="availabilityFootnote">
                  <p>Ngày chi tiết: {formatLongDate(weekStartKey)} đến {formatLongDate(addDaysToScheduleDateKey(weekStartKey, 6))}</p>
                </div>
              </div>

              <div className="availabilityMobileBoard">
                <div className="availabilityDayStrip" aria-label="Chọn ngày đăng ký lịch rảnh">
                  {weekDays.map((day) => {
                    const registeredCount = slots.filter((item) => item.dateKey === day.dateKey).length;
                    return (
                      <button
                        aria-pressed={day.dateKey === selectedMobileDay?.dateKey}
                        className={`${day.dateKey === selectedMobileDay?.dateKey ? "active" : ""} ${day.dateKey === todayKey ? "today" : ""}`}
                        key={day.dateKey}
                        onClick={() => setSelectedMobileDateKey(day.dateKey)}
                        type="button"
                      >
                        <span>{day.label.replace("Thứ ", "T")}</span>
                        <strong>{parseScheduleDateKey(day.dateKey)?.getDate()}</strong>
                        <i>{registeredCount}</i>
                      </button>
                    );
                  })}
                </div>

                <div className="availabilityMobileDayHeader">
                  <div>
                    <span>NGÀY ĐANG CHỌN</span>
                    <strong>{selectedMobileDay ? formatLongDate(selectedMobileDay.dateKey) : ""}</strong>
                  </div>
                  <em>{slots.filter((item) => item.dateKey === selectedMobileDay?.dateKey).length} slot rảnh</em>
                </div>

                <div className="availabilityMobileSlots">
                  {DEFAULT_SCHEDULE_SLOTS.map((slot) => {
                    if (!selectedMobileDay) return null;
                    const currentSlot = slotMap.get(buildSlotKey(selectedMobileDay.dateKey, slot));
                    const active = Boolean(currentSlot);
                    const past = isScheduleSlotInPast(selectedMobileDay.dateKey, slot);
                    return (
                      <article className={`availabilityMobileSlot ${active ? "active" : ""} ${past ? "past" : ""}`} key={slot}>
                        <button
                          aria-pressed={active}
                          className="availabilityMobileSlotToggle"
                          disabled={!canEdit || !hasValidTargetLocation || past}
                          onClick={() => toggleSlot(selectedMobileDay.dateKey, slot)}
                          title={past ? "Khung giờ đã bắt đầu và không thể chỉnh sửa" : undefined}
                          type="button"
                        >
                          <span className="availabilityMobileSlotTime">{slot}</span>
                          <span className="availabilityMobileSlotState">
                            <i><Icon name="check" size={15} /></i>
                            <span>
                              <strong>{active ? "Sẵn sàng nhận ca" : past ? "Khung giờ đã qua" : "Chưa đăng ký"}</strong>
                              <small>{active ? activeRole === "host" ? availabilityLocationLabel(currentSlot?.locationPreference || defaultAvailabilityLocation) : "Đã đăng ký" : past ? "Không thể đăng ký" : "Chạm để chọn khung giờ này"}</small>
                            </span>
                          </span>
                        </button>
                        {canAdminOverrideLocation && active && !past ? (
                          <div className="availabilityMobileLocation">
                            <span>Admin xếp tại</span>
                            <div className="availabilitySlotLocationSelector" role="group" aria-label={`Địa điểm đăng ký ${selectedMobileDay.dateKey} ${slot}`}>
                              {(["home", "studio"] as const).map((location) => (
                                <button
                                  aria-pressed={(currentSlot?.locationPreference || "home") === location}
                                  className={(currentSlot?.locationPreference || "home") === location ? `active ${location}` : ""}
                                  disabled={!canEdit || !hasValidTargetLocation}
                                  key={location}
                                  onClick={() => updateSlotLocation(selectedMobileDay.dateKey, slot, location)}
                                  type="button"
                                >
                                  {availabilityLocationLabel(location)}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {!isAdmin || selectedPerson ? <div className={`availabilityMobileActions ${isAdmin ? "adminOnly" : ""}`}>
        <button className="syncButton peopleSyncButton" disabled={!canEdit || !hasEditableSlots || !hasValidTargetLocation || saving || loadingWeek || !hasTargetSelection} onClick={() => void persistAvailability("save")} type="button">
          <Icon name="calendar" />
          <span>{saving ? "Đang lưu..." : isAdmin ? "Lưu thay đổi" : "Lưu nháp"}</span>
        </button>
        {!isAdmin ? (
          <button className="syncButton" disabled={!canEdit || !hasEditableSlots || !hasValidTargetLocation || submitting || loadingWeek || !hasTargetSelection || slots.length === 0} onClick={() => void persistAvailability("submit")} type="button">
            <Icon name="check" />
            <span>{submitting ? "Đang gửi..." : "Gửi lịch rảnh"}</span>
          </button>
        ) : null}
      </div> : null}

      {accountPanelOpen ? (
        <AccountPanel isAdmin={isAdmin} username={username} onClose={() => setAccountPanelOpen(false)} />
      ) : null}
    </main>
  );
}
