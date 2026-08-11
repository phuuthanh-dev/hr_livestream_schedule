"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import AccountPanel from "@/components/AccountPanel";
import { normalizeLocationCode } from "@/lib/locationUtils";
import type { ScheduleLocation, ScheduleLocationsPayload } from "@/lib/types";

type LocationAdminProps = {
  username: string;
};

type IconName = "account" | "chart" | "check" | "location" | "logout" | "plus" | "refresh";

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
  if (name === "chart") return <svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>;
  if (name === "check") return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
  if (name === "location") return <svg {...common}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
  if (name === "logout") return <svg {...common}><path d="M10 17l5-5-5-5M15 12H3M14 4h4a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-4" /></svg>;
  if (name === "plus") return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
  if (name === "refresh") return <svg {...common}><path d="M20 11a8 8 0 1 0-2.34 5.66" /><path d="M20 4v7h-7" /></svg>;
  return null;
}

function formatTimestamp(value?: string) {
  if (!value) return "Chưa cập nhật";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export default function LocationAdmin({ username }: LocationAdminProps) {
  const [locations, setLocations] = useState<ScheduleLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyCode, setBusyCode] = useState("");
  const [editingCode, setEditingCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editSortOrder, setEditSortOrder] = useState(0);
  const [createName, setCreateName] = useState("");
  const [createCode, setCreateCode] = useState("");
  const [createSortOrder, setCreateSortOrder] = useState(100);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);

  async function loadLocations() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/locations", { cache: "no-store" });
      const payload = (await response.json()) as ScheduleLocationsPayload;
      if (!response.ok || !payload.success) throw new Error(payload.message || "Không tải được danh mục địa điểm.");
      setLocations(payload.locations || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không tải được danh mục địa điểm.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLocations();
  }, []);

  async function createLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyCode("__create__");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/locations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: createName, code: createCode, sortOrder: createSortOrder })
      });
      const payload = (await response.json()) as ScheduleLocationsPayload;
      if (!response.ok || !payload.success) throw new Error(payload.message || "Không thêm được địa điểm.");
      setCreateName("");
      setCreateCode("");
      setCreateSortOrder(100);
      setMessage(payload.message || "Đã thêm địa điểm.");
      await loadLocations();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Không thêm được địa điểm.");
    } finally {
      setBusyCode("");
    }
  }

  function beginEdit(location: ScheduleLocation) {
    setEditingCode(location.code);
    setEditName(location.name);
    setEditSortOrder(location.sortOrder);
    setMessage("");
    setError("");
  }

  async function updateLocation(input: { code: string; name?: string; sortOrder?: number; active?: boolean }) {
    setBusyCode(input.code);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/locations", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      });
      const payload = (await response.json()) as ScheduleLocationsPayload;
      if (!response.ok || !payload.success) throw new Error(payload.message || "Không cập nhật được địa điểm.");
      setEditingCode("");
      setMessage(payload.message || "Đã cập nhật địa điểm.");
      await loadLocations();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Không cập nhật được địa điểm.");
    } finally {
      setBusyCode("");
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const activeCount = locations.filter((location) => location.active).length;
  const customCount = locations.filter((location) => !location.system).length;
  const codePreview = normalizeLocationCode(createCode || createName) || "ma-dia-diem";

  return (
    <main className="availabilityApp locationAdminApp">
      <header className="appHeader availabilityHeader locationAdminHeader">
        <div className="brandBlock">
          <span className="brandMark"><img className="brandLogo" src="/rr-logo-submark-square.png" alt="" /></span>
          <span className="brandName">Quản lý địa điểm</span>
        </div>
        <div className="locationHeaderNavigation">
          <a className="todayButton" href="/">Lịch chính</a>
          <a className="todayButton availabilitySummaryShortcut" href="/availability/summary"><Icon name="chart" size={17} /><span>Tổng hợp rảnh</span></a>
        </div>
        <div className="headerActions">
          <span className="userAvatar" title={`Đăng nhập: ${username}`}>{username.slice(0, 1).toUpperCase()}</span>
          <button className="iconButton" aria-label="Quản lý tài khoản" onClick={() => setAccountPanelOpen(true)} type="button"><Icon name="account" /></button>
          <button className="iconButton" aria-label="Đăng xuất" onClick={logout} type="button"><Icon name="logout" /></button>
        </div>
      </header>

      <section className="locationAdminWorkspace">
        <div className="locationAdminHero">
          <div>
            <span>DANH MỤC VẬN HÀNH</span>
            <h1>Địa điểm linh hoạt, dữ liệu ổn định.</h1>
            <p>Mã địa điểm được giữ cố định để lịch sử không bị đứt. Admin có thể đổi tên, thứ tự, trạng thái hoặc thêm Studio mới bất kỳ lúc nào.</p>
          </div>
          <div className="locationAdminStats">
            <article><span>Đang hoạt động</span><strong>{activeCount}</strong></article>
            <article><span>Tổng địa điểm</span><strong>{locations.length}</strong></article>
            <article><span>Tự tạo thêm</span><strong>{customCount}</strong></article>
          </div>
        </div>

        {error ? <div className="notice errorNotice">{error}</div> : null}
        {message ? <div className="notice successNotice"><Icon name="check" size={18} />{message}</div> : null}

        <div className="locationAdminGrid">
          <form autoComplete="off" className="locationCreateCard" onSubmit={createLocation}>
            <div className="locationSectionHeading">
              <span>THÊM ĐỊA ĐIỂM</span>
              <h2>Mở rộng danh mục</h2>
              <p>Ví dụ: Studio 2, Studio Hà Nội hoặc Kho Live.</p>
            </div>
            <label>
              <span>Tên hiển thị</span>
              <input autoComplete="off" name="new-location-name" value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="Studio 2" required />
            </label>
            <label>
              <span>Mã địa điểm <small>có thể để trống</small></span>
              <input autoComplete="off" name="new-location-code" value={createCode} onChange={(event) => setCreateCode(event.target.value)} placeholder={normalizeLocationCode(createName) || "studio-2"} />
            </label>
            <div className="locationCodePreview"><span>Mã sẽ lưu</span><code>{codePreview}</code></div>
            <label>
              <span>Thứ tự hiển thị</span>
              <input min="0" max="9999" type="number" value={createSortOrder} onChange={(event) => setCreateSortOrder(Number(event.target.value))} />
            </label>
            <button className="locationPrimaryButton" disabled={busyCode === "__create__" || !createName.trim()} type="submit"><Icon name="plus" size={18} />{busyCode === "__create__" ? "Đang thêm..." : "Thêm địa điểm"}</button>
          </form>

          <section className="locationTableCard">
            <div className="locationTableHeader">
              <div className="locationSectionHeading">
                <span>DANH SÁCH ĐỊA ĐIỂM</span>
                <h2>{locations.length} địa điểm</h2>
              </div>
              <button className="locationRefreshButton" disabled={loading} onClick={() => void loadLocations()} type="button"><Icon name="refresh" size={17} />{loading ? "Đang tải" : "Làm mới"}</button>
            </div>

            {loading && locations.length === 0 ? <div className="locationEmptyState">Đang tải danh mục địa điểm...</div> : null}
            {!loading && locations.length === 0 ? <div className="locationEmptyState">Chưa có địa điểm nào.</div> : null}

            {locations.length > 0 ? (
              <div className="locationTableWrap">
                <table className="locationTable">
                  <thead><tr><th>Thứ tự</th><th>Địa điểm</th><th>Mã ổn định</th><th>Trạng thái</th><th>Cập nhật</th><th /></tr></thead>
                  <tbody>
                    {locations.map((location) => {
                      const editing = editingCode === location.code;
                      return (
                        <tr className={!location.active ? "inactive" : ""} key={location.code}>
                          <td data-label="Thứ tự">
                            {editing ? <input className="locationInlineNumber" min="0" max="9999" type="number" value={editSortOrder} onChange={(event) => setEditSortOrder(Number(event.target.value))} /> : <strong>{location.sortOrder}</strong>}
                          </td>
                          <td data-label="Địa điểm">
                            {editing ? <input className="locationInlineName" value={editName} onChange={(event) => setEditName(event.target.value)} /> : <span className="locationIdentity"><i><Icon name="location" size={17} /></i><span><strong>{location.name}</strong><small>{location.system ? "Mặc định hệ thống" : "Địa điểm mở rộng"}</small></span></span>}
                          </td>
                          <td data-label="Mã ổn định"><code>{location.code}</code></td>
                          <td data-label="Trạng thái"><span className={`locationStatus ${location.active ? "active" : "inactive"}`}>{location.active ? "Hoạt động" : "Tạm ngưng"}</span></td>
                          <td data-label="Cập nhật"><span className="locationUpdatedAt">{formatTimestamp(location.updatedAt)}</span></td>
                          <td data-label="Thao tác">
                            <div className="locationRowActions">
                              {editing ? (
                                <>
                                  <button className="save" disabled={busyCode === location.code || !editName.trim()} onClick={() => void updateLocation({ code: location.code, name: editName, sortOrder: editSortOrder })} type="button">Lưu</button>
                                  <button onClick={() => setEditingCode("")} type="button">Hủy</button>
                                </>
                              ) : (
                                <>
                                  <button onClick={() => beginEdit(location)} type="button">Chỉnh sửa</button>
                                  <button className={location.active ? "pause" : "activate"} disabled={busyCode === location.code} onClick={() => void updateLocation({ code: location.code, active: !location.active })} type="button">{location.active ? "Tạm ngưng" : "Kích hoạt"}</button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </div>
      </section>

      {accountPanelOpen ? <AccountPanel isAdmin username={username} onClose={() => setAccountPanelOpen(false)} /> : null}
    </main>
  );
}
