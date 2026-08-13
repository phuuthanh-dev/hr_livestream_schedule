"use client";

import type { FormEvent } from "react";
import { useDeferredValue, useEffect, useState } from "react";
import AccountPanel from "@/components/AccountPanel";
import type { EmployeeAdminPayload, EmployeeRole, ScheduleLocation, ScheduleLocationsPayload, SchedulePerson } from "@/lib/types";

type EmployeeAdminProps = {
  username: string;
};

type EmployeeForm = {
  id: string;
  name: string;
  role: EmployeeRole;
  level: string;
  workLocation: string;
  phone: string;
  cvReference: string;
  cashOffer: string;
  castStatus: string;
  experience: string;
  trainingStatus: string;
  notes: string;
  achievements: string;
  zaloStatus: string;
  liveAccountType: string;
  liveChannelId: string;
  active: boolean;
};

type IconName = "account" | "calendar" | "close" | "edit" | "location" | "logout" | "plus" | "refresh" | "search" | "trash" | "users";

const EMPTY_FORM: EmployeeForm = {
  id: "", name: "", role: "host", level: "", workLocation: "", phone: "", cvReference: "",
  cashOffer: "", castStatus: "Đồng ý", experience: "", trainingStatus: "", notes: "", achievements: "",
  zaloStatus: "", liveAccountType: "", liveChannelId: "", active: true
};

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true
  };
  if (name === "account") return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
  if (name === "calendar") return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>;
  if (name === "close") return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === "edit") return <svg {...common}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg>;
  if (name === "location") return <svg {...common}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
  if (name === "logout") return <svg {...common}><path d="M10 17l5-5-5-5M15 12H3M14 4h4a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-4" /></svg>;
  if (name === "plus") return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
  if (name === "refresh") return <svg {...common}><path d="M20 11a8 8 0 1 0-2.34 5.66" /><path d="M20 4v7h-7" /></svg>;
  if (name === "search") return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
  if (name === "trash") return <svg {...common}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>;
  if (name === "users") return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>;
  return null;
}

function toForm(employee: SchedulePerson): EmployeeForm {
  return {
    id: employee.id,
    name: employee.name,
    role: employee.role,
    level: employee.level || "",
    workLocation: employee.workLocation || "",
    phone: employee.phone || "",
    cvReference: employee.cvReference || "",
    cashOffer: employee.cashOffer || "",
    castStatus: employee.castStatus || "",
    experience: employee.experience || "",
    trainingStatus: employee.trainingStatus || "",
    notes: employee.notes || "",
    achievements: employee.achievements || "",
    zaloStatus: employee.zaloStatus || "",
    liveAccountType: employee.liveAccountType || "",
    liveChannelId: employee.liveChannelId || "",
    active: employee.active !== false
  };
}

function isIncomplete(employee: SchedulePerson) {
  return !employee.name || !employee.phone || !employee.level || (employee.role === "host" && !employee.workLocation);
}

function formatTimestamp(value?: string) {
  if (!value) return "Chưa cập nhật";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

export default function EmployeeAdmin({ username }: EmployeeAdminProps) {
  const [employees, setEmployees] = useState<SchedulePerson[]>([]);
  const [locations, setLocations] = useState<ScheduleLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | EmployeeRole>("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "incomplete" | "all">("active");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingExisting, setEditingExisting] = useState(false);
  const [form, setForm] = useState<EmployeeForm>(EMPTY_FORM);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("vi"));

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [employeesResponse, locationsResponse] = await Promise.all([
        fetch("/api/employees", { cache: "no-store" }),
        fetch("/api/locations", { cache: "no-store" })
      ]);
      const employeePayload = (await employeesResponse.json()) as EmployeeAdminPayload;
      const locationPayload = (await locationsResponse.json()) as ScheduleLocationsPayload;
      if (!employeesResponse.ok || !employeePayload.success) throw new Error(employeePayload.message || "Không tải được nhân viên.");
      if (!locationsResponse.ok || !locationPayload.success) throw new Error(locationPayload.message || "Không tải được địa điểm.");
      setEmployees(employeePayload.employees || []);
      setLocations(locationPayload.locations || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không tải được dữ liệu nhân viên.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!editorOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [editorOpen]);

  function openCreate() {
    setForm({ ...EMPTY_FORM, workLocation: locations.find((location) => location.active)?.code || "" });
    setEditingExisting(false);
    setEditorOpen(true);
    setMessage("");
    setError("");
  }

  function openEdit(employee: SchedulePerson) {
    setForm(toForm(employee));
    setEditingExisting(true);
    setEditorOpen(true);
    setMessage("");
    setError("");
  }

  async function saveEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("save");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/employees", {
        method: editingExisting ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form)
      });
      const payload = (await response.json()) as EmployeeAdminPayload;
      if (!response.ok || !payload.success) throw new Error(payload.message || "Không lưu được hồ sơ nhân viên.");
      setEditorOpen(false);
      setMessage(payload.message || "Đã lưu hồ sơ nhân viên.");
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không lưu được hồ sơ nhân viên.");
    } finally {
      setBusy("");
    }
  }

  async function toggleEmployee(employee: SchedulePerson) {
    setBusy(employee.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/employees", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: employee.id, role: employee.role, active: employee.active === false })
      });
      const payload = (await response.json()) as EmployeeAdminPayload;
      if (!response.ok || !payload.success) throw new Error(payload.message || "Không đổi được trạng thái nhân viên.");
      setMessage(payload.message || "Đã cập nhật trạng thái nhân viên.");
      await loadData();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Không đổi được trạng thái nhân viên.");
    } finally {
      setBusy("");
    }
  }

  async function hardDeleteEmployee(employee: SchedulePerson) {
    const confirmed = window.confirm(
      `Xoá cứng ${employee.name} (${employee.id})?\n\nHệ thống sẽ xoá hẳn hồ sơ nhân viên, tài khoản đăng nhập, hợp đồng, lịch rảnh và hồ sơ ứng tuyển liên kết. Thao tác này không hoàn tác được.`
    );
    if (!confirmed) return;

    setBusy(`delete:${employee.role}:${employee.id}`);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/employees", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: employee.id, role: employee.role })
      });
      const payload = (await response.json()) as EmployeeAdminPayload;
      if (!response.ok || !payload.success) throw new Error(payload.message || "Không xoá được nhân viên.");
      setMessage(payload.message || "Đã xoá cứng nhân viên.");
      await loadData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Không xoá được nhân viên.");
    } finally {
      setBusy("");
    }
  }

  async function bootstrapEmployees() {
    if (!window.confirm("Nạp lại danh sách nhân viên mặc định từ hệ thống? Dữ liệu trùng mã sẽ được cập nhật, nhân sự khác không bị xóa.")) return;
    setBusy("bootstrap");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/employees/bootstrap", { method: "POST" });
      const payload = (await response.json()) as EmployeeAdminPayload;
      if (!response.ok || !payload.success) throw new Error(payload.message || "Không nạp được dữ liệu mặc định.");
      setMessage(`${payload.message || "Đã nạp dữ liệu mặc định."} ${payload.inserted || 0} mới · ${payload.updated || 0} cập nhật.`);
      await loadData();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Không nạp được dữ liệu mặc định.");
    } finally {
      setBusy("");
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const activeEmployees = employees.filter((employee) => employee.active !== false);
  const completedContractCount = activeEmployees.filter((employee) => employee.contractProfile?.completed).length;
  const locationNameByCode = new Map(locations.map((location) => [location.code, location.name]));
  const filteredEmployees = employees.filter((employee) => {
    if (roleFilter !== "all" && employee.role !== roleFilter) return false;
    if (statusFilter === "active" && employee.active === false) return false;
    if (statusFilter === "inactive" && employee.active !== false) return false;
    if (statusFilter === "incomplete" && !isIncomplete(employee)) return false;
    if (!deferredQuery) return true;
    return [employee.id, employee.name, employee.phone, employee.level, employee.liveChannelId]
      .filter(Boolean).join(" ").toLocaleLowerCase("vi").includes(deferredQuery);
  });

  return (
    <main className="employeeAdminApp">
      <header className="appHeader employeeAdminHeader">
        <div className="brandBlock">
          <span className="brandMark"><img className="brandLogo" src="/rr-logo-submark-square.png" alt="" /></span>
          <span className="brandName">Nhân sự Live</span>
        </div>
        <nav className="employeeHeaderNavigation">
          <a className="todayButton" href="/">Lịch chính</a>
          <a className="todayButton" href="/availability/summary"><Icon name="calendar" size={16} /><span>Lịch rảnh</span></a>
          <a className="todayButton" href="/locations"><Icon name="location" size={16} /><span>Địa điểm</span></a>
        </nav>
        <div className="headerActions">
          <span className="userAvatar" title={`Đăng nhập: ${username}`}>{username.slice(0, 1).toUpperCase()}</span>
          <button className="iconButton" aria-label="Quản lý tài khoản" onClick={() => setAccountPanelOpen(true)} type="button"><Icon name="account" /></button>
          <button className="iconButton" aria-label="Đăng xuất" onClick={logout} type="button"><Icon name="logout" /></button>
        </div>
      </header>

      <section className="employeeAdminWorkspace">
        <div className="employeeAdminHero">
          <div className="employeeHeroCopy">
            <span>ROSTER MONGODB · API NỘI BỘ</span>
            <h1>Một hồ sơ đầy đủ, mọi lịch đều đúng người.</h1>
            <p>Thông tin Host và Support được quản lý trực tiếp trên website. Mã nhân viên và vai trò là khóa ổn định để bảo toàn tài khoản, lịch rảnh và lịch sử ca.</p>
          </div>
          <div className="employeeHeroStats">
            <article><span>Đang hoạt động</span><strong>{activeEmployees.length}</strong></article>
            <article><span>Host</span><strong>{activeEmployees.filter((employee) => employee.role === "host").length}</strong></article>
            <article><span>Support</span><strong>{activeEmployees.filter((employee) => employee.role === "support").length}</strong></article>
            <article className={completedContractCount < activeEmployees.length ? "warning" : ""}><span>Hợp đồng hoàn tất</span><strong>{completedContractCount}/{activeEmployees.length}</strong></article>
          </div>
        </div>

        {error ? <div className="notice errorNotice">{error}</div> : null}
        {message ? <div className="notice successNotice">{message}</div> : null}

        <section className="employeeRosterCard">
          <div className="employeeToolbar">
            <label className="employeeSearch">
              <Icon name="search" size={18} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm mã, tên, số điện thoại, level..." />
            </label>
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}>
              <option value="all">Tất cả vai trò</option><option value="host">Host</option><option value="support">Support Live</option>
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="active">Đang hoạt động</option><option value="incomplete">Thiếu thông tin</option><option value="inactive">Tạm ngưng</option><option value="all">Tất cả trạng thái</option>
            </select>
            <button className="employeeBootstrapButton" disabled={busy === "bootstrap"} onClick={() => void bootstrapEmployees()} type="button"><Icon name="refresh" size={17} />{busy === "bootstrap" ? "Đang nạp" : "Nạp dữ liệu mặc định"}</button>
            <button className="employeeAddButton" onClick={openCreate} type="button"><Icon name="plus" size={17} />Thêm nhân viên</button>
          </div>

          <div className="employeeRosterMeta"><strong>{filteredEmployees.length} hồ sơ</strong><span>Không hiển thị số điện thoại trên API roster công khai.</span></div>
          {loading ? <div className="employeeEmptyState">Đang tải dữ liệu nhân viên...</div> : null}
          {!loading && filteredEmployees.length === 0 ? <div className="employeeEmptyState"><Icon name="users" size={28} /><strong>Không có hồ sơ phù hợp</strong><span>Thử đổi bộ lọc hoặc thêm nhân viên mới.</span></div> : null}

          {filteredEmployees.length ? (
            <div className="employeeTableWrap">
              <table className="employeeTable">
                <thead><tr><th>Nhân viên</th><th>Vai trò</th><th>Liên hệ</th><th>Level / Địa điểm</th><th>Training</th><th>Hợp đồng</th><th>Trạng thái</th><th>Cập nhật</th><th /></tr></thead>
                <tbody>{filteredEmployees.map((employee) => (
                  <tr className={employee.active === false ? "inactive" : ""} key={`${employee.role}:${employee.id}`}>
                    <td data-label="Nhân viên"><span className={`employeeIdentity ${employee.role}`}><i>{employee.name.slice(0, 1).toUpperCase()}</i><span><strong>{employee.name}</strong><code>{employee.id}</code>{isIncomplete(employee) ? <small>Thiếu thông tin bắt buộc</small> : null}</span></span></td>
                    <td data-label="Vai trò"><span className={`employeeRoleBadge ${employee.role}`}>{employee.role === "host" ? "Host" : "Support"}</span></td>
                    <td data-label="Liên hệ"><span className="employeeStackValue"><strong>{employee.phone || "Chưa có SĐT"}</strong><small>{employee.liveChannelId || employee.cvReference || "Chưa có kênh/CV"}</small></span></td>
                    <td data-label="Level / Địa điểm"><span className="employeeStackValue"><strong>{employee.level || "Chưa xếp level"}</strong><small>{employee.role === "host" ? locationNameByCode.get(employee.workLocation || "") || "Chưa có địa điểm" : "Support Live"}</small></span></td>
                    <td data-label="Training"><span className="employeeStackValue"><strong>{employee.trainingStatus || "Chưa cập nhật"}</strong></span></td>
                    <td data-label="Hợp đồng"><span className={`employeeContractBadge ${employee.contractProfile?.completed ? "complete" : employee.contractProfile?.updatedAt ? "partial" : "empty"}`}>{employee.contractProfile?.completed ? "Đã đủ" : employee.contractProfile?.updatedAt ? "Thiếu ảnh" : "Chưa khai"}</span></td>
                    <td data-label="Trạng thái"><span className={`employeeStatusBadge ${employee.active === false ? "inactive" : "active"}`}>{employee.active === false ? "Tạm ngưng" : "Hoạt động"}</span></td>
                    <td data-label="Cập nhật"><span className="employeeUpdatedAt">{formatTimestamp(employee.updatedAt)}</span></td>
                    <td data-label="Thao tác"><div className="employeeRowActions"><a href={`/contract?role=${employee.role}&employeeId=${encodeURIComponent(employee.id)}`}>Hợp đồng</a><button onClick={() => openEdit(employee)} type="button"><Icon name="edit" size={15} />Sửa</button><button className={employee.active === false ? "activate" : "pause"} disabled={busy === employee.id} onClick={() => void toggleEmployee(employee)} type="button">{employee.active === false ? "Kích hoạt" : "Tạm ngưng"}</button><button className="danger" disabled={busy === `delete:${employee.role}:${employee.id}` || busy === employee.id} onClick={() => void hardDeleteEmployee(employee)} type="button"><Icon name="trash" size={15} />Xoá cứng</button></div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : null}
        </section>
      </section>

      {editorOpen ? (
        <div className="employeeEditorBackdrop" role="presentation">
          <form className="employeeEditor" onSubmit={saveEmployee}>
            <header><div><span>{editingExisting ? "CẬP NHẬT HỒ SƠ" : "THÊM NHÂN VIÊN"}</span><strong>{form.name || "Hồ sơ mới"}</strong><small>{editingExisting ? `${form.role === "host" ? "Host" : "Support"} · ${form.id}` : "Mã và vai trò sẽ trở thành khóa ổn định"}</small></div><button aria-label="Đóng" onClick={() => setEditorOpen(false)} type="button"><Icon name="close" /></button></header>
            <div className="employeeEditorBody">
              <fieldset><legend>Thông tin cơ bản</legend><div className="employeeFormGrid">
                <label><span>Vai trò</span><select disabled={editingExisting} value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as EmployeeRole, workLocation: event.target.value === "host" ? current.workLocation || locations.find((location) => location.active)?.code || "" : "" }))}><option value="host">Host</option><option value="support">Support Live</option></select></label>
                <label><span>Mã nhân viên</span><input disabled={editingExisting} required value={form.id} onChange={(event) => setForm((current) => ({ ...current, id: event.target.value.toUpperCase() }))} placeholder={form.role === "host" ? "HRLT21" : "HRSL13"} /></label>
                <label className="wide"><span>Họ và tên</span><input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
                <label><span>Số điện thoại</span><input inputMode="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} /></label>
                <label><span>Trạng thái</span><select value={form.active ? "active" : "inactive"} onChange={(event) => setForm((current) => ({ ...current, active: event.target.value === "active" }))}><option value="active">Hoạt động</option><option value="inactive">Tạm ngưng</option></select></label>
              </div></fieldset>

              <fieldset><legend>Năng lực và vận hành</legend><div className="employeeFormGrid">
                <label><span>Level / Grade</span><input value={form.level} onChange={(event) => setForm((current) => ({ ...current, level: event.target.value }))} placeholder={form.role === "host" ? "B" : "Cấp 2"} /></label>
                {form.role === "host" ? <label><span>Địa điểm</span><select required value={form.workLocation} onChange={(event) => setForm((current) => ({ ...current, workLocation: event.target.value }))}>{locations.map((location) => <option disabled={!location.active} key={location.code} value={location.code}>{location.name}{location.active ? "" : " · Tạm ngưng"}</option>)}</select></label> : null}
                <label><span>Cash offer</span><input value={form.cashOffer} onChange={(event) => setForm((current) => ({ ...current, cashOffer: event.target.value }))} /></label>
                <label><span>Kinh nghiệm</span><input value={form.experience} onChange={(event) => setForm((current) => ({ ...current, experience: event.target.value }))} /></label>
                <label><span>Training</span><input value={form.trainingStatus} onChange={(event) => setForm((current) => ({ ...current, trainingStatus: event.target.value }))} /></label>
                <label className="wide"><span>CV / Portfolio</span><input value={form.cvReference} onChange={(event) => setForm((current) => ({ ...current, cvReference: event.target.value }))} /></label>
              </div></fieldset>

              {form.role === "host" ? <fieldset><legend>Thông tin riêng của Host</legend><div className="employeeFormGrid">
                <label><span>Tham gia Zalo</span><input value={form.zaloStatus} onChange={(event) => setForm((current) => ({ ...current, zaloStatus: event.target.value }))} /></label>
                <label><span>Loại tài khoản live</span><input value={form.liveAccountType} onChange={(event) => setForm((current) => ({ ...current, liveAccountType: event.target.value }))} /></label>
                <label className="wide"><span>Live Channel ID</span><input value={form.liveChannelId} onChange={(event) => setForm((current) => ({ ...current, liveChannelId: event.target.value }))} /></label>
                <label className="wide"><span>Thành tích</span><input value={form.achievements} onChange={(event) => setForm((current) => ({ ...current, achievements: event.target.value }))} /></label>
              </div></fieldset> : null}

              <fieldset><legend>Ghi chú đánh giá</legend><label className="employeeNotesField"><textarea rows={5} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Đánh giá, lưu ý vận hành, yêu cầu đào tạo..." /></label></fieldset>
            </div>
            <footer><button className="secondary" onClick={() => setEditorOpen(false)} type="button">Hủy</button><button className="primary" disabled={busy === "save"} type="submit">{busy === "save" ? "Đang lưu..." : editingExisting ? "Lưu thay đổi" : "Thêm nhân viên"}</button></footer>
          </form>
        </div>
      ) : null}

      {accountPanelOpen ? <AccountPanel isAdmin username={username} onClose={() => setAccountPanelOpen(false)} /> : null}
    </main>
  );
}
