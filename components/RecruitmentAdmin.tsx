"use client";

import type { FormEvent } from "react";
import { useDeferredValue, useEffect, useState } from "react";
import AccountPanel from "@/components/AccountPanel";
import type { EmployeeRole } from "@/lib/types";

type RecruitmentAdminProps = {
  username: string;
};

type RecruitmentApplication = {
  applicationId: string;
  employeeId?: string;
  role: EmployeeRole;
  fullName: string;
  aliasName: string;
  phone: string;
  email: string;
  cvUrl: string;
  experience: string;
  achievements: string;
  expectedSalary: string;
  canLiveHome: boolean;
  canLiveStudio: boolean;
  canUsePersonalAccount: boolean;
  canUseCompanyAccount: boolean;
  liveLocationPreference: "" | "home" | "studio";
  liveAccountPreference: "" | "personal" | "company";
  introVideoUrl: string;
  tiktokUrl: string;
  notes: string;
  status: string;
  sheetSyncStatus?: "synced" | "failed";
  sheetSyncError?: string;
  submittedAt: string;
  updatedAt: string;
};

type RecruitmentProfile = {
  role: EmployeeRole;
  employeeId: string;
  applicationId?: string;
  sheetContractCode?: string;
  fullName: string;
  aliasName: string;
  phone: string;
  email: string;
  cvUrl: string;
  experience: string;
  achievements: string;
  expectedSalary: string;
  introVideoUrl: string;
  tiktokUrl: string;
  followerCount?: string;
  canLiveHome: boolean;
  canLiveStudio: boolean;
  canUsePersonalAccount: boolean;
  canUseCompanyAccount: boolean;
  liveLocationPreference: "" | "home" | "studio";
  liveAccountPreference: "" | "personal" | "company";
  salaryOffered?: string;
  salaryOfferFeedback?: string;
  evaluationSummary?: string;
  supportGemOffer?: string;
  cashOfferReality?: string;
  dealStatus?: string;
  cashOfferRealityRoundTwo?: string;
  dealStatusRoundTwo?: string;
  supportMainOfferNote?: string;
  notes: string;
  updatedAt: string;
};

type RecruitmentRecord = {
  application: RecruitmentApplication | null;
  profile: RecruitmentProfile | null;
  contractSummary: {
    completed: boolean;
    hasFront: boolean;
    hasBack: boolean;
    updatedAt?: string;
  } | null;
};

type RecruitmentPayload = {
  success: boolean;
  total?: number;
  records?: RecruitmentRecord[];
  message?: string;
};

type RecruitmentSyncRun = {
  runId: string;
  direction: "sheet_to_website" | "website_to_sheet";
  operation: "import_profiles" | "sync_profiles";
  success: boolean;
  startedAt: string;
  finishedAt: string;
  processedRows?: number;
  updatedProfiles?: number;
  updatedEmployees?: number;
  createdEmployees?: number;
  updatedContracts?: number;
  updatedSheetRows?: number;
  appendedSheetRows?: number;
  skippedRows?: number;
  conflictCount: number;
  message?: string;
  error?: string;
};

type RecruitmentSyncConflict = {
  runId: string;
  direction: "sheet_to_website" | "website_to_sheet";
  kind: string;
  role?: EmployeeRole;
  employeeId?: string;
  tabName?: string;
  rowNumber?: number;
  details: string;
  createdAt: string;
};

type RecruitmentSyncLogsPayload = {
  success: boolean;
  runs?: RecruitmentSyncRun[];
  conflicts?: RecruitmentSyncConflict[];
  message?: string;
};

type RecruitmentEditorForm = {
  role: EmployeeRole;
  employeeId: string;
  fullName: string;
  aliasName: string;
  phone: string;
  email: string;
  cvUrl: string;
  experience: string;
  achievements: string;
  expectedSalary: string;
  introVideoUrl: string;
  tiktokUrl: string;
  canLiveHome: boolean;
  canLiveStudio: boolean;
  canUsePersonalAccount: boolean;
  canUseCompanyAccount: boolean;
  liveLocationPreference: "" | "home" | "studio";
  liveAccountPreference: "" | "personal" | "company";
  salaryOffered: string;
  salaryOfferFeedback: string;
  evaluationSummary: string;
  notes: string;
};

function Icon({ name, size = 20 }: { name: "account" | "close" | "logout" | "search" | "users"; size?: number }) {
  const common = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true
  };
  if (name === "account") return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
  if (name === "close") return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === "logout") return <svg {...common}><path d="M10 17l5-5-5-5M15 12H3M14 4h4a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-4" /></svg>;
  if (name === "search") return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
  return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>;
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

function toEditorForm(record: RecruitmentRecord): RecruitmentEditorForm {
  const profile = record.profile;
  const app = record.application;
  return {
    role: app?.role || profile?.role || "host",
    employeeId: app?.employeeId || profile?.employeeId || "",
    fullName: profile?.fullName || app?.fullName || "",
    aliasName: profile?.aliasName || app?.aliasName || "",
    phone: profile?.phone || app?.phone || "",
    email: profile?.email || app?.email || "",
    cvUrl: profile?.cvUrl || app?.cvUrl || "",
    experience: profile?.experience || app?.experience || "",
    achievements: profile?.achievements || app?.achievements || "",
    expectedSalary: profile?.expectedSalary || app?.expectedSalary || "",
    introVideoUrl: profile?.introVideoUrl || app?.introVideoUrl || "",
    tiktokUrl: profile?.tiktokUrl || app?.tiktokUrl || "",
    canLiveHome: profile?.canLiveHome ?? app?.canLiveHome ?? false,
    canLiveStudio: profile?.canLiveStudio ?? app?.canLiveStudio ?? false,
    canUsePersonalAccount: profile?.canUsePersonalAccount ?? app?.canUsePersonalAccount ?? false,
    canUseCompanyAccount: profile?.canUseCompanyAccount ?? app?.canUseCompanyAccount ?? false,
    liveLocationPreference: profile?.liveLocationPreference || app?.liveLocationPreference || "",
    liveAccountPreference: profile?.liveAccountPreference || app?.liveAccountPreference || "",
    salaryOffered: profile?.salaryOffered || "",
    salaryOfferFeedback: profile?.salaryOfferFeedback || "",
    evaluationSummary: profile?.evaluationSummary || "",
    notes: profile?.notes || app?.notes || ""
  };
}

export default function RecruitmentAdmin({ username }: RecruitmentAdminProps) {
  const [records, setRecords] = useState<RecruitmentRecord[]>([]);
  const [syncRuns, setSyncRuns] = useState<RecruitmentSyncRun[]>([]);
  const [syncConflicts, setSyncConflicts] = useState<RecruitmentSyncConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [importing, setImporting] = useState(false);
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [logsLoading, setLogsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | EmployeeRole>("all");
  const [syncFilter, setSyncFilter] = useState<"all" | "synced" | "failed">("all");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [editorForm, setEditorForm] = useState<RecruitmentEditorForm | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("vi"));

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/recruitment-profiles", { cache: "no-store" });
      const payload = await response.json() as RecruitmentPayload;
      if (!response.ok || !payload.success) throw new Error(payload.message || "Không tải được hồ sơ tuyển dụng.");
      setRecords(payload.records || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không tải được hồ sơ tuyển dụng.");
    } finally {
      setLoading(false);
    }
  }

  async function loadLogs() {
    setLogsLoading(true);
    try {
      const response = await fetch("/api/recruitment-profiles/sync-logs", { cache: "no-store" });
      const payload = await response.json() as RecruitmentSyncLogsPayload;
      if (!response.ok || !payload.success) throw new Error(payload.message || "Không tải được log sync tuyển dụng.");
      setSyncRuns(payload.runs || []);
      setSyncConflicts(payload.conflicts || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không tải được log sync tuyển dụng.");
    } finally {
      setLogsLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    void loadLogs();
  }, []);

  useEffect(() => {
    if (!editorOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [editorOpen]);

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function openEditor(record: RecruitmentRecord) {
    setEditorForm(toEditorForm(record));
    setEditorOpen(true);
    setMessage("");
    setError("");
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editorForm) return;
    setBusy("save");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/recruitment-profiles", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: editorForm.role,
          employeeId: editorForm.employeeId,
          values: editorForm
        })
      });
      const payload = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !payload.success) throw new Error(payload.message || "Không lưu được hồ sơ tuyển dụng.");
      setEditorOpen(false);
      setMessage(payload.message || "Đã lưu hồ sơ tuyển dụng.");
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không lưu được hồ sơ tuyển dụng.");
    } finally {
      setBusy("");
    }
  }

  async function importFromSheet() {
    setImporting(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/recruitment-profiles", {
        method: "POST"
      });
      const payload = await response.json() as {
        success?: boolean;
        message?: string;
        updatedProfiles?: number;
        updatedEmployees?: number;
        createdEmployees?: number;
        updatedContracts?: number;
        skippedRows?: number;
      };
      if (!response.ok || !payload.success) throw new Error(payload.message || "Không import được dữ liệu từ sheet nguồn.");
      setMessage(
        `${payload.message || "Đã sync từ sheet nguồn."} Roster ${payload.updatedEmployees || 0} update · ${payload.createdEmployees || 0} create · Contract ${payload.updatedContracts || 0} · Bỏ qua ${payload.skippedRows || 0} dòng.`
      );
      await loadData();
      await loadLogs();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Không import được dữ liệu từ sheet nguồn.");
    } finally {
      setImporting(false);
    }
  }

  async function syncToSheet() {
    setSyncingSheet(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/recruitment-profiles/sync-sheet", {
        method: "POST"
      });
      const payload = await response.json() as { success?: boolean; message?: string; updatedSheetRows?: number; appendedSheetRows?: number; skippedRows?: number };
      if (!response.ok || !payload.success) throw new Error(payload.message || "Không đẩy được dữ liệu lên sheet nguồn.");
      setMessage(`${payload.message || "Đã đẩy dữ liệu lên sheet nguồn."} Bỏ qua ${payload.skippedRows || 0} hồ sơ.`);
      await loadData();
      await loadLogs();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Không đẩy được dữ liệu lên sheet nguồn.");
    } finally {
      setSyncingSheet(false);
    }
  }

  const filteredRecords = records.filter((record) => {
    const role = record.application?.role || record.profile?.role;
    if (roleFilter !== "all" && role !== roleFilter) return false;
    if (syncFilter !== "all" && record.application?.sheetSyncStatus !== syncFilter) return false;
    if (!deferredQuery) return true;
    return [
      record.application?.employeeId || record.profile?.employeeId,
      record.application?.fullName || record.profile?.fullName,
      record.application?.aliasName || record.profile?.aliasName,
      record.application?.phone || record.profile?.phone,
      record.application?.email || record.profile?.email
    ].filter(Boolean).join(" ").toLocaleLowerCase("vi").includes(deferredQuery);
  });

  const failedSyncCount = records.filter((record) => record.application?.sheetSyncStatus === "failed").length;
  const hostCount = records.filter((record) => (record.application?.role || record.profile?.role) === "host").length;
  const supportCount = records.filter((record) => (record.application?.role || record.profile?.role) === "support").length;

  return (
    <main className="employeeAdminApp">
      <header className="appHeader employeeAdminHeader">
        <div className="brandBlock">
          <span className="brandMark"><img className="brandLogo" src="/rr-logo-submark-square.png" alt="" /></span>
          <span className="brandName">Hồ sơ tuyển dụng</span>
        </div>
        <nav className="employeeHeaderNavigation">
          <a className="todayButton" href="/">Lịch chính</a>
          <a className="todayButton" href="/employees">Nhân viên</a>
          <a className="todayButton" href="/availability/summary">Lịch rảnh</a>
        </nav>
        <div className="headerActions">
          <span className="userAvatar" title={`Đăng nhập: ${username}`}>{username.slice(0, 1).toUpperCase()}</span>
          <button className="iconButton" aria-label="Quản lý tài khoản" onClick={() => setAccountPanelOpen(true)} type="button"><Icon name="account" /></button>
          <button className="iconButton" aria-label="Đăng xuất" onClick={logout} type="button"><Icon name="logout" /></button>
        </div>
      </header>

      <section className="employeeAdminWorkspace">
        <div className="employeeAdminHero recruitmentHero">
          <div className="employeeHeroCopy">
            <span>RECRUITMENT PROFILE · WEBSITE MASTER</span>
            <h1>Quản lý ứng tuyển, offer và năng lực trên cùng một mặt bàn.</h1>
            <p>Dữ liệu từ form ứng tuyển giờ được tách riêng thành hồ sơ tuyển dụng để bám sát 2 tab nguồn trước khi làm sync 2 chiều với Google Sheet.</p>
          </div>
          <div className="employeeHeroStats">
            <article><span>Tổng hồ sơ</span><strong>{records.length}</strong></article>
            <article><span>Host</span><strong>{hostCount}</strong></article>
            <article><span>Support</span><strong>{supportCount}</strong></article>
            <article className={failedSyncCount > 0 ? "warning" : ""}><span>Sync lỗi</span><strong>{failedSyncCount}</strong></article>
          </div>
        </div>

        {error ? <div className="notice errorNotice">{error}</div> : null}
        {message ? <div className="notice successNotice">{message}</div> : null}

        <section className="employeeRosterCard">
          <div className="employeeToolbar">
            <label className="employeeSearch">
              <Icon name="search" size={18} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm mã, tên, nickname, email, số điện thoại..." />
            </label>
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}>
              <option value="all">Tất cả vai trò</option>
              <option value="host">Host</option>
              <option value="support">Support Live</option>
            </select>
            <select value={syncFilter} onChange={(event) => setSyncFilter(event.target.value as typeof syncFilter)}>
              <option value="all">Tất cả sync</option>
              <option value="synced">Đã sync sheet</option>
              <option value="failed">Sync lỗi</option>
            </select>
            <button className="employeeBootstrapButton" disabled={importing} onClick={() => void importFromSheet()} type="button">{importing ? "Đang sync sheet" : "Sync từ Sheet về Website"}</button>
            <button className="employeeBootstrapButton" disabled={syncingSheet} onClick={() => void syncToSheet()} type="button">{syncingSheet ? "Đang đẩy sheet" : "Đẩy lên Sheet nguồn"}</button>
            <a className="employeeBootstrapButton recruitmentInlineLink" href="/apply">Mở form public</a>
          </div>

          <div className="employeeRosterMeta">
            <strong>{filteredRecords.length} hồ sơ</strong>
            <span>Đã nối `people_applications` + `recruitment_profiles` + `schedule_people` + `employee_contract_profiles`.</span>
          </div>

          {loading ? <div className="employeeEmptyState">Đang tải hồ sơ tuyển dụng...</div> : null}
          {!loading && filteredRecords.length === 0 ? (
            <div className="employeeEmptyState">
              <Icon name="users" size={28} />
              <strong>Chưa có hồ sơ phù hợp</strong>
              <span>Thử đổi bộ lọc hoặc gửi thêm hồ sơ từ form ứng tuyển.</span>
            </div>
          ) : null}

          {filteredRecords.length > 0 ? (
            <div className="employeeTableWrap">
              <table className="employeeTable">
                <thead>
                  <tr>
                    <th>Ứng viên</th>
                    <th>Vai trò</th>
                    <th>Sync sheet</th>
                    <th>Khả năng live</th>
                    <th>Offer</th>
                    <th>Hợp đồng</th>
                    <th>Cập nhật</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((record) => {
                    const app = record.application;
                    const profile = record.profile;
                    const role = app?.role || profile?.role || "host";
                    return (
                      <tr key={app?.applicationId || `${profile?.role}:${profile?.employeeId}`}>
                        <td data-label="Ứng viên">
                          <span className={`employeeIdentity ${role}`}>
                            <i>{(profile?.aliasName || app?.aliasName || profile?.fullName || app?.fullName || "?").slice(0, 1).toUpperCase()}</i>
                            <span>
                              <strong>{profile?.aliasName || app?.aliasName || profile?.fullName || app?.fullName}</strong>
                              <code>{app?.employeeId || profile?.employeeId || "Chưa cấp mã"}</code>
                              <small>{app?.phone || profile?.phone}{(app?.email || profile?.email) ? ` · ${app?.email || profile?.email}` : ""}</small>
                            </span>
                          </span>
                        </td>
                        <td data-label="Vai trò">
                          <span className={`employeeRoleBadge ${role}`}>{role === "host" ? "Host" : "Support"}</span>
                        </td>
                        <td data-label="Sync sheet">
                          <span className={`recruitmentSyncBadge ${app?.sheetSyncStatus === "failed" ? "failed" : "synced"}`}>
                            {app ? (app.sheetSyncStatus === "failed" ? "Lỗi" : "Đã sync") : "Từ sheet"}
                          </span>
                        </td>
                        <td data-label="Khả năng live">
                          <span className="employeeStackValue">
                            <strong>{role === "host"
                              ? `${profile?.canLiveHome ? "Home" : ""}${profile?.canLiveHome && profile?.canLiveStudio ? " + " : ""}${profile?.canLiveStudio ? "Studio" : ""}` || "-"
                              : "Support vận hành"}</strong>
                            <small>{role === "host"
                              ? `${profile?.canUsePersonalAccount ? "Personal" : ""}${profile?.canUsePersonalAccount && profile?.canUseCompanyAccount ? " + " : ""}${profile?.canUseCompanyAccount ? "Company" : ""}` || "-"
                              : profile?.evaluationSummary || app?.experience?.slice(0, 60) || "-"}</small>
                          </span>
                        </td>
                        <td data-label="Offer">
                          <span className="employeeStackValue">
                            <strong>{profile?.salaryOffered || app?.expectedSalary || "Chưa có"}</strong>
                            <small>{profile?.salaryOfferFeedback || "Chưa có phản hồi offer"}</small>
                          </span>
                        </td>
                        <td data-label="Hợp đồng">
                          <span className={`employeeContractBadge ${record.contractSummary?.completed ? "complete" : record.contractSummary?.updatedAt ? "partial" : "empty"}`}>
                            {record.contractSummary?.completed ? "Đã đủ" : record.contractSummary?.updatedAt ? "Đã nhập một phần" : "Chưa có"}
                          </span>
                        </td>
                        <td data-label="Cập nhật">
                          <span className="employeeUpdatedAt">{formatTimestamp(profile?.updatedAt || app?.updatedAt)}</span>
                        </td>
                        <td data-label="Thao tác">
                          <div className="employeeRowActions">
                            {(app?.employeeId || profile?.employeeId) ? <a href={`/contract?role=${role}&employeeId=${encodeURIComponent(app?.employeeId || profile?.employeeId || "")}`}>Hợp đồng</a> : null}
                            <button onClick={() => openEditor(record)} type="button">Sửa hồ sơ</button>
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

        <section className={`employeeRosterCard recruitmentSyncCard ${syncRuns.length === 0 ? "compact" : ""}`}>
          <div className="employeeRosterMeta">
            <strong>Nhật ký sync tuyển dụng</strong>
            <span>{syncRuns.length} lần chạy · {syncConflicts.length} conflict gần nhất</span>
          </div>

          {logsLoading ? <div className="employeeEmptyState compact">Đang tải log sync...</div> : null}

          {!logsLoading && syncRuns.length === 0 ? (
            <div className="employeeEmptyState compact">
              <Icon name="search" size={22} />
              <strong>Chưa có log sync</strong>
              <span>Hãy thử kéo từ sheet hoặc đẩy website lên sheet để bắt đầu lưu lịch sử.</span>
            </div>
          ) : null}

          {!logsLoading && syncRuns.length > 0 ? (
            <div className="recruitmentSyncLogLayout">
              <div className="employeeTableWrap">
                <table className="employeeTable recruitmentLogTable">
                  <thead>
                    <tr>
                      <th>Thời điểm</th>
                      <th>Hướng</th>
                      <th>Kết quả</th>
                      <th>Số liệu</th>
                      <th>Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncRuns.map((run) => (
                      <tr key={run.runId}>
                        <td data-label="Thời điểm">
                          <span className="employeeStackValue">
                            <strong>{formatTimestamp(run.finishedAt)}</strong>
                            <small>{run.operation === "import_profiles" ? "Pull sheet -> web" : "Push web -> sheet"}</small>
                          </span>
                        </td>
                        <td data-label="Hướng">
                          <span className={`recruitmentSyncBadge ${run.direction === "sheet_to_website" ? "synced" : "push"}`}>
                            {run.direction === "sheet_to_website" ? "Sheet -> Web" : "Web -> Sheet"}
                          </span>
                        </td>
                        <td data-label="Kết quả">
                          <span className={`employeeContractBadge ${run.success ? "complete" : "empty"}`}>
                            {run.success ? "Thành công" : "Lỗi"}
                          </span>
                        </td>
                        <td data-label="Số liệu">
                          <span className="employeeStackValue">
                            <strong>
                              {run.direction === "sheet_to_website"
                                ? `${run.updatedProfiles || 0} profile · ${run.updatedEmployees || 0} roster update · ${run.createdEmployees || 0} roster create · ${run.updatedContracts || 0} contract`
                                : `${run.updatedSheetRows || 0} update · ${run.appendedSheetRows || 0} append`}
                            </strong>
                            <small>{run.conflictCount} conflict · {run.skippedRows || 0} bỏ qua</small>
                          </span>
                        </td>
                        <td data-label="Ghi chú">
                          <span className="employeeStackValue">
                            <strong>{run.message || run.error || "-"}</strong>
                            <small>Run ID: {run.runId.slice(0, 8)}</small>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="employeeTableWrap">
                <table className="employeeTable recruitmentConflictTable">
                  <thead>
                    <tr>
                      <th>Conflict gần nhất</th>
                      <th>Loại</th>
                      <th>Đối tượng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncConflicts.length === 0 ? (
                      <tr>
                        <td colSpan={3}>
                          <div className="employeeEmptyState compact inline">
                            <strong>Chưa có conflict</strong>
                            <span>Luồng sync hiện đang sạch.</span>
                          </div>
                        </td>
                      </tr>
                    ) : syncConflicts.map((conflict) => (
                      <tr key={`${conflict.runId}-${conflict.createdAt}-${conflict.kind}`}>
                        <td data-label="Conflict gần nhất">
                          <span className="employeeStackValue">
                            <strong>{conflict.details}</strong>
                            <small>{formatTimestamp(conflict.createdAt)}</small>
                          </span>
                        </td>
                        <td data-label="Loại">
                          <span className={`recruitmentSyncBadge ${conflict.direction === "sheet_to_website" ? "failed" : "push"}`}>
                            {conflict.kind}
                          </span>
                        </td>
                        <td data-label="Đối tượng">
                          <span className="employeeStackValue">
                            <strong>{conflict.employeeId || "-"}</strong>
                            <small>{conflict.role || "-"}{conflict.tabName ? ` · ${conflict.tabName}` : ""}{conflict.rowNumber ? ` · dòng ${conflict.rowNumber}` : ""}</small>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>
      </section>

      {editorOpen && editorForm ? (
        <div className="employeeEditorBackdrop" role="presentation">
          <form className="employeeEditor" onSubmit={saveProfile}>
            <header>
              <div>
                <span>RECRUITMENT PROFILE</span>
                <strong>{editorForm.aliasName || editorForm.fullName || "Hồ sơ tuyển dụng"}</strong>
                <small>{editorForm.role === "host" ? "Host" : "Support"} · {editorForm.employeeId}</small>
              </div>
              <button aria-label="Đóng" onClick={() => setEditorOpen(false)} type="button"><Icon name="close" /></button>
            </header>
            <div className="employeeEditorBody">
              <fieldset><legend>Thông tin ứng viên</legend><div className="employeeFormGrid">
                <label className="wide"><span>Họ và tên</span><input value={editorForm.fullName} onChange={(event) => setEditorForm((current) => current ? { ...current, fullName: event.target.value } : current)} /></label>
                <label><span>Tên gọi khác</span><input value={editorForm.aliasName} onChange={(event) => setEditorForm((current) => current ? { ...current, aliasName: event.target.value } : current)} /></label>
                <label><span>Số điện thoại</span><input value={editorForm.phone} onChange={(event) => setEditorForm((current) => current ? { ...current, phone: event.target.value } : current)} /></label>
                <label className="wide"><span>Email</span><input value={editorForm.email} onChange={(event) => setEditorForm((current) => current ? { ...current, email: event.target.value } : current)} /></label>
                <label className="wide"><span>CV / Portfolio</span><input value={editorForm.cvUrl} onChange={(event) => setEditorForm((current) => current ? { ...current, cvUrl: event.target.value } : current)} /></label>
                <label className="wide"><span>Lương mong muốn</span><input value={editorForm.expectedSalary} onChange={(event) => setEditorForm((current) => current ? { ...current, expectedSalary: event.target.value } : current)} /></label>
              </div></fieldset>

              <fieldset><legend>Đánh giá tuyển dụng</legend><div className="employeeFormGrid">
                <label><span>Lương thỏa thuận</span><input value={editorForm.salaryOffered} onChange={(event) => setEditorForm((current) => current ? { ...current, salaryOffered: event.target.value } : current)} /></label>
                <label><span>Phản hồi offer</span><input value={editorForm.salaryOfferFeedback} onChange={(event) => setEditorForm((current) => current ? { ...current, salaryOfferFeedback: event.target.value } : current)} /></label>
                <label className="wide"><span>Thành tích</span><textarea rows={4} value={editorForm.achievements} onChange={(event) => setEditorForm((current) => current ? { ...current, achievements: event.target.value } : current)} /></label>
                <label className="wide"><span>Kinh nghiệm</span><textarea rows={4} value={editorForm.experience} onChange={(event) => setEditorForm((current) => current ? { ...current, experience: event.target.value } : current)} /></label>
                <label className="wide"><span>Kết quả đánh giá</span><textarea rows={5} value={editorForm.evaluationSummary} onChange={(event) => setEditorForm((current) => current ? { ...current, evaluationSummary: event.target.value } : current)} /></label>
              </div></fieldset>

              {editorForm.role === "host" ? (
                <fieldset><legend>Khả năng live của Host</legend><div className="employeeFormGrid">
                  <label><span>Ưu tiên nơi live</span><select value={editorForm.liveLocationPreference} onChange={(event) => setEditorForm((current) => current ? { ...current, liveLocationPreference: event.target.value as RecruitmentEditorForm["liveLocationPreference"] } : current)}><option value="">Chưa chọn</option><option value="home">Home</option><option value="studio">Studio</option></select></label>
                  <label><span>Ưu tiên tài khoản</span><select value={editorForm.liveAccountPreference} onChange={(event) => setEditorForm((current) => current ? { ...current, liveAccountPreference: event.target.value as RecruitmentEditorForm["liveAccountPreference"] } : current)}><option value="">Chưa chọn</option><option value="personal">Personal</option><option value="company">Company</option></select></label>
                  <label className="recruitmentBooleanField"><input checked={editorForm.canLiveHome} onChange={(event) => setEditorForm((current) => current ? { ...current, canLiveHome: event.target.checked } : current)} type="checkbox" /><span>Có thể live tại nhà</span></label>
                  <label className="recruitmentBooleanField"><input checked={editorForm.canLiveStudio} onChange={(event) => setEditorForm((current) => current ? { ...current, canLiveStudio: event.target.checked } : current)} type="checkbox" /><span>Có thể live tại Studio</span></label>
                  <label className="recruitmentBooleanField"><input checked={editorForm.canUsePersonalAccount} onChange={(event) => setEditorForm((current) => current ? { ...current, canUsePersonalAccount: event.target.checked } : current)} type="checkbox" /><span>Dùng được tài khoản cá nhân</span></label>
                  <label className="recruitmentBooleanField"><input checked={editorForm.canUseCompanyAccount} onChange={(event) => setEditorForm((current) => current ? { ...current, canUseCompanyAccount: event.target.checked } : current)} type="checkbox" /><span>Dùng được tài khoản công ty</span></label>
                  <label className="wide"><span>Link video</span><input value={editorForm.introVideoUrl} onChange={(event) => setEditorForm((current) => current ? { ...current, introVideoUrl: event.target.value } : current)} /></label>
                  <label className="wide"><span>Link TikTok</span><input value={editorForm.tiktokUrl} onChange={(event) => setEditorForm((current) => current ? { ...current, tiktokUrl: event.target.value } : current)} /></label>
                </div></fieldset>
              ) : null}

              <fieldset><legend>Ghi chú</legend><label className="employeeNotesField"><textarea rows={5} value={editorForm.notes} onChange={(event) => setEditorForm((current) => current ? { ...current, notes: event.target.value } : current)} /></label></fieldset>
            </div>
            <footer><button className="secondary" onClick={() => setEditorOpen(false)} type="button">Hủy</button><button className="primary" disabled={busy === "save"} type="submit">{busy === "save" ? "Đang lưu..." : "Lưu hồ sơ"}</button></footer>
          </form>
        </div>
      ) : null}

      {accountPanelOpen ? <AccountPanel isAdmin username={username} onClose={() => setAccountPanelOpen(false)} /> : null}
    </main>
  );
}
