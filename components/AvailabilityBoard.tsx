"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import AccountPanel from "@/components/AccountPanel";
import { DEFAULT_HOST_LOCATION_PREFERENCE, DEFAULT_SCHEDULE_SLOTS, HOST_AVAILABILITY_LOCATION_OPTIONS } from "@/lib/scheduleConfig";
import {
  addDaysToScheduleDateKey,
  getScheduleTodayKey,
  getScheduleWeekDateKeys,
  getScheduleWeekStartKey,
  parseScheduleDateKey
} from "@/lib/scheduleDate";
import type {
  AvailabilityLocationPreference,
  AvailabilityPayload,
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
};

type PeopleResponse = {
  success?: boolean;
  hosts?: SchedulePerson[];
  supports?: SchedulePerson[];
  message?: string;
};

type IconName = "account" | "calendar" | "check" | "chevronLeft" | "chevronRight" | "logout" | "warning";

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
      if (slot.locationPreference === "home") summary.availableHome += 1;
      if (slot.locationPreference === "studio") summary.availableStudio += 1;
      if (slot.locationPreference === "both" || !slot.locationPreference) summary.availableBoth += 1;
      return summary;
    },
    {
      totalSlots: DEFAULT_SCHEDULE_SLOTS.length * 7,
      availableSlots: 0,
      availableHome: 0,
      availableStudio: 0,
      availableBoth: 0
    }
  );
}

function statusLabel(status: AvailabilityWeek["status"]) {
  if (status === "submitted") return "Đã gửi";
  if (status === "locked") return "Đã khóa";
  return "Bản nháp";
}

function locationLabel(value?: AvailabilityLocationPreference) {
  if (value === "home") return "Home";
  if (value === "studio") return "Studio";
  return "Home + Studio";
}

function buildSlotKey(dateKey: string, slot: string) {
  return `${dateKey}__${slot}`;
}

export default function AvailabilityBoard({
  username,
  isAdmin,
  employeeRole,
  employeeId
}: AvailabilityBoardProps) {
  const [weekStartKey, setWeekStartKey] = useState(getScheduleWeekStartKey);
  const [week, setWeek] = useState<AvailabilityWeek | null>(null);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [hosts, setHosts] = useState<SchedulePerson[]>([]);
  const [supports, setSupports] = useState<SchedulePerson[]>([]);
  const [selectedRole, setSelectedRole] = useState<EmployeeRole>(employeeRole || "host");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(employeeId || "");
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
  const hasTargetSelection = Boolean((isAdmin ? selectedRole : employeeRole) && (isAdmin ? selectedEmployeeId : employeeId));
  const summary = useMemo(() => buildSummary(slots), [slots]);
  const slotMap = useMemo(() => {
    const nextMap = new Map<string, AvailabilitySlot>();
    slots.forEach((slot) => {
      nextMap.set(buildSlotKey(slot.dateKey, slot.slot), slot);
    });
    return nextMap;
  }, [slots]);
  const selectedMobileDay = weekDays.find((day) => day.dateKey === selectedMobileDateKey) || weekDays[0];

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
    if (!isAdmin) return;
    const nextPeople = selectedRole === "host" ? hosts : supports;
    if (nextPeople.length === 0) {
      setSelectedEmployeeId("");
      return;
    }
    if (!nextPeople.some((person) => person.id === selectedEmployeeId)) {
      setSelectedEmployeeId(nextPeople[0].id);
    }
  }, [hosts, isAdmin, selectedEmployeeId, selectedRole, supports]);

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
    if (!canEdit) return;
    setSlots((current) => {
      const existingKey = buildSlotKey(dateKey, slot);
      const existing = current.find((item) => buildSlotKey(item.dateKey, item.slot) === existingKey);
      const next = existing
        ? current.filter((item) => buildSlotKey(item.dateKey, item.slot) !== existingKey)
        : current.concat({
            dateKey,
            slot,
            available: true,
            locationPreference:
              (isAdmin ? selectedRole : employeeRole) === "host"
                ? DEFAULT_HOST_LOCATION_PREFERENCE
                : undefined
          });
      return next.sort((left, right) => {
        if (left.dateKey !== right.dateKey) return left.dateKey.localeCompare(right.dateKey);
        return DEFAULT_SCHEDULE_SLOTS.indexOf(left.slot as (typeof DEFAULT_SCHEDULE_SLOTS)[number]) -
          DEFAULT_SCHEDULE_SLOTS.indexOf(right.slot as (typeof DEFAULT_SCHEDULE_SLOTS)[number]);
      });
    });
    setDirty(true);
  }

  function updateLocationPreference(dateKey: string, slot: string, value: AvailabilityLocationPreference) {
    if (!canEdit) return;
    setSlots((current) =>
      current.map((item) =>
        item.dateKey === dateKey && item.slot === slot
          ? { ...item, locationPreference: value }
          : item
      )
    );
    setDirty(true);
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <main className="availabilityApp">
      <header className="appHeader availabilityHeader">
        <div className="brandBlock">
          <span className="brandMark"><img className="brandLogo" src="/rr-logo-submark-square.png" alt="" /></span>
          <span className="brandName">Lịch Rảnh</span>
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
          <span className="userAvatar" title={`Đăng nhập: ${username}`}>{username.slice(0, 1).toUpperCase()}</span>
          <button className="iconButton" aria-label="Quản lý tài khoản" onClick={() => setAccountPanelOpen(true)} title="Quản lý tài khoản" type="button"><Icon name="account" /></button>
          <button className="iconButton" aria-label="Đăng xuất" onClick={logout} type="button"><Icon name="logout" /></button>
        </div>
      </header>

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
                  <select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as EmployeeRole)} disabled={loadingPeople}>
                    <option value="host">Host</option>
                    <option value="support">Support Live</option>
                  </select>
                </label>
                <label>
                  Nhân viên
                  <select value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)} disabled={loadingPeople || selectedPeople.length === 0}>
                    {selectedPeople.length === 0 ? (
                      <option value="">{loadingPeople ? "Đang tải..." : "Chưa có nhân sự"}</option>
                    ) : null}
                    {selectedPeople.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name} · {person.id}
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
            <div className="availabilityMetrics">
              <div><span>Slot rảnh</span><strong>{summary.availableSlots}</strong></div>
              <div><span>Home</span><strong>{summary.availableHome}</strong></div>
              <div><span>Studio</span><strong>{summary.availableStudio}</strong></div>
              <div><span>Home + Studio</span><strong>{summary.availableBoth}</strong></div>
            </div>
          </section>

          <section className="availabilityCard availabilitySidebarActions">
            <div className="availabilityCardHeader">
              <strong>Thao tác</strong>
              <span>{canEdit ? "Bạn có thể tiếp tục chỉnh tuần này." : "Tuần này đang khóa chỉnh sửa."}</span>
            </div>
            <div className="availabilityActions">
              <button className="syncButton peopleSyncButton" disabled={!canEdit || saving || loadingWeek || !hasTargetSelection} onClick={() => void persistAvailability("save")} type="button">
                <Icon name="calendar" />
                <span>{saving ? "Đang lưu..." : "Lưu nháp"}</span>
              </button>
              <button className="syncButton" disabled={!canEdit || submitting || loadingWeek || !hasTargetSelection || slots.length === 0} onClick={() => void persistAvailability("submit")} type="button">
                <Icon name="check" />
                <span>{submitting ? "Đang gửi..." : "Gửi lịch rảnh"}</span>
              </button>
            </div>
          </section>
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
                <em>{(isAdmin ? selectedRole : employeeRole) === "host" ? "Host có thể chọn Home / Studio / Both" : "Support chỉ cần đánh dấu slot rảnh"}</em>
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
                        return (
                          <div className="availabilityCell" key={`${day.dateKey}-${slot}`}>
                            <button
                              aria-pressed={active}
                              className={`availabilityCellButton ${active ? "active" : ""}`}
                              disabled={!canEdit}
                              onClick={() => toggleSlot(day.dateKey, slot)}
                              type="button"
                            >
                              <span>{active ? "Sẵn sàng" : "Để trống"}</span>
                              <strong>{active ? locationLabel(currentSlot?.locationPreference) : "Chưa đăng ký"}</strong>
                            </button>
                            {active && (isAdmin ? selectedRole : employeeRole) === "host" ? (
                              <label className="availabilityCellMeta">
                                <span>Nơi live</span>
                                <select
                                  value={currentSlot?.locationPreference || DEFAULT_HOST_LOCATION_PREFERENCE}
                                  disabled={!canEdit}
                                  onChange={(event) => updateLocationPreference(day.dateKey, slot, event.target.value as AvailabilityLocationPreference)}
                                >
                                  {HOST_AVAILABILITY_LOCATION_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </label>
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
                    return (
                      <article className={`availabilityMobileSlot ${active ? "active" : ""}`} key={slot}>
                        <button
                          aria-pressed={active}
                          className="availabilityMobileSlotToggle"
                          disabled={!canEdit}
                          onClick={() => toggleSlot(selectedMobileDay.dateKey, slot)}
                          type="button"
                        >
                          <span className="availabilityMobileSlotTime">{slot}</span>
                          <span className="availabilityMobileSlotState">
                            <i><Icon name="check" size={15} /></i>
                            <span>
                              <strong>{active ? "Sẵn sàng nhận ca" : "Chưa đăng ký"}</strong>
                              <small>{active ? locationLabel(currentSlot?.locationPreference) : "Chạm để chọn khung giờ này"}</small>
                            </span>
                          </span>
                        </button>
                        {active && (isAdmin ? selectedRole : employeeRole) === "host" ? (
                          <label className="availabilityMobileLocation">
                            <span>Nơi live</span>
                            <select
                              value={currentSlot?.locationPreference || DEFAULT_HOST_LOCATION_PREFERENCE}
                              disabled={!canEdit}
                              onChange={(event) => updateLocationPreference(selectedMobileDay.dateKey, slot, event.target.value as AvailabilityLocationPreference)}
                            >
                              {HOST_AVAILABILITY_LOCATION_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </label>
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

      <div className="availabilityMobileActions">
        <button className="syncButton peopleSyncButton" disabled={!canEdit || saving || loadingWeek || !hasTargetSelection} onClick={() => void persistAvailability("save")} type="button">
          <Icon name="calendar" />
          <span>{saving ? "Đang lưu..." : "Lưu nháp"}</span>
        </button>
        <button className="syncButton" disabled={!canEdit || submitting || loadingWeek || !hasTargetSelection || slots.length === 0} onClick={() => void persistAvailability("submit")} type="button">
          <Icon name="check" />
          <span>{submitting ? "Đang gửi..." : "Gửi lịch rảnh"}</span>
        </button>
      </div>

      {accountPanelOpen ? (
        <AccountPanel isAdmin={isAdmin} username={username} onClose={() => setAccountPanelOpen(false)} />
      ) : null}
    </main>
  );
}
