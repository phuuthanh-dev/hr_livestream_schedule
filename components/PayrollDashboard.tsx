"use client";

import { useEffect, useRef, useState } from "react";
import type {
  PayrollDashboardPayload,
  PayrollRateCard,
  PayrollSettings
} from "@/lib/types";

type PayrollDashboardProps = {
  username: string;
  initialWeekStartKey?: string;
};

type Tab = "payroll" | "exceptions" | "rates";

function Icon({ name }: { name: "back" | "upload" | "calculate" | "lock" | "download" | "alert" | "money" | "clock" | "calendar" | "chevron" }) {
  const paths = {
    back: <path d="m15 18-6-6 6-6M9 12h10" />,
    upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5" /><path d="M5 15v4h14v-4" /></>,
    calculate: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 11h2m4 0h2M8 15h2m4 0h2M8 18h2m4 0h2" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    download: <><path d="M12 3v12m0 0 5-5m-5 5-5-5" /><path d="M5 20h14" /></>,
    alert: <><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v5m0 3h.01" /></>,
    money: <><circle cx="12" cy="12" r="9" /><path d="M15 8.5c-.7-.5-1.5-.8-2.5-.8-1.4 0-2.5.7-2.5 1.8 0 2.8 5 1.2 5 4 0 1.1-1.1 1.8-2.5 1.8-1 0-2-.3-2.8-.9M12.5 6v12" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4m8-4v4M3 10h18" /></>,
    chevron: <path d="m6 9 6 6 6-6" />
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function keyFromDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(key: string, days: number) {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return keyFromDate(date);
}

function currentWeekStart() {
  const bangkokKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const date = dateFromKey(bangkokKey);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return keyFromDate(date);
}

function formatDate(key?: string) {
  if (!key) return "-";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(dateFromKey(key));
}

function formatMoney(value = 0) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value = 0) {
  return new Intl.NumberFormat("vi-VN", { style: "percent", maximumFractionDigits: 2 }).format(value);
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export default function PayrollDashboard({ username, initialWeekStartKey }: PayrollDashboardProps) {
  const [weekStartKey, setWeekStartKey] = useState(initialWeekStartKey || currentWeekStart());
  const [payload, setPayload] = useState<PayrollDashboardPayload | null>(null);
  const [tab, setTab] = useState<Tab>("payroll");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [draftRates, setDraftRates] = useState<PayrollRateCard[]>([]);
  const [draftSettings, setDraftSettings] = useState<PayrollSettings | null>(null);
  const [personHoursOpen, setPersonHoursOpen] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadDashboard(signal?: AbortSignal) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/payroll?weekStartKey=${encodeURIComponent(weekStartKey)}`, { signal, cache: "no-store" });
      const result = await response.json() as PayrollDashboardPayload;
      if (!response.ok || !result.success) throw new Error(result.message || "Không tải được bảng lương.");
      setPayload(result);
      setDraftRates(result.rates || []);
      setDraftSettings(result.settings || null);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Không tải được bảng lương.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadDashboard(controller.signal);
    return () => controller.abort();
  }, [weekStartKey]);

  async function uploadReport() {
    if (!file) {
      fileInputRef.current?.click();
      return;
    }
    setWorking("upload");
    setError("");
    setNotice("");
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/payroll/import", { method: "POST", body: formData });
      const result = await response.json() as { success: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message || "Không import được báo cáo.");
      setNotice(result.message || "Đã import báo cáo.");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadDashboard();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Không import được báo cáo.");
    } finally {
      setWorking("");
    }
  }

  async function runAction(action: "generate" | "lock") {
    if (action === "lock" && !window.confirm("Khóa bảng lương tuần này? Sau khi khóa sẽ không thể tính lại.")) return;
    setWorking(action);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/payroll/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekStartKey })
      });
      const result = await response.json() as PayrollDashboardPayload;
      if (!response.ok || !result.success) throw new Error(result.message || "Thao tác không thành công.");
      setPayload(result);
      setDraftRates(result.rates || []);
      setDraftSettings(result.settings || null);
      setNotice(result.message || (action === "generate" ? "Đã tính lương." : "Đã khóa tuần lương."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Thao tác không thành công.");
    } finally {
      setWorking("");
    }
  }

  async function saveRates() {
    if (!draftSettings) return;
    setWorking("rates");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/payroll/rates", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rates: draftRates, settings: draftSettings })
      });
      const result = await response.json() as { success: boolean; message?: string; rates?: PayrollRateCard[]; settings?: PayrollSettings };
      if (!response.ok || !result.success) throw new Error(result.message || "Không lưu được bảng giá.");
      setDraftRates(result.rates || draftRates);
      setDraftSettings(result.settings || draftSettings);
      setPayload((current) => current ? { ...current, rates: result.rates, settings: result.settings } : current);
      setNotice(result.message || "Đã lưu bảng giá.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không lưu được bảng giá.");
    } finally {
      setWorking("");
    }
  }

  function exportCsv() {
    const entries = payload?.entries || [];
    if (entries.length === 0) return;
    const header = ["Ngày", "Vai trò", "Mã nhân viên", "Họ tên", "Grade", "Địa điểm", "TikTok account", "Session ID", "Live ID", "Giờ lịch", "Đơn giá/giờ", "Gross GMV", "Hoàn tiền", "GMV tính HH", "Tỷ lệ HH", "Lương cứng", "Hoa hồng", "Thuế", "Thực nhận"];
    const rows = entries.map((entry) => [
      entry.dateKey, entry.role, entry.employeeId, entry.employeeName, entry.grade, entry.location,
      entry.accountId, entry.sessionIds.join(" | "), entry.tiktokLiveIds.join(" | "), entry.scheduledHours,
      entry.hourlyRate, entry.grossGmv, entry.returnedGmv, entry.eligibleGmv, entry.commissionRate,
      entry.basePay, entry.commissionPay, entry.taxAmount, entry.netPay
    ]);
    const blob = new Blob(["\uFEFF", [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `payroll_${weekStartKey}_${addDays(weekStartKey, 6)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const summary = payload?.summary;
  function formatHours(value = 0) {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }
  const isLocked = payload?.periodStatus === "locked";
  const entries = payload?.entries || [];
  const personHours = payload?.personHours || [];
  const exceptions = payload?.exceptions || [];
  const latestImport = payload?.imports?.[0];

  return (
    <main className="payrollApp">
      <header className="payrollHeader">
        <a className="payrollBack" href="/" aria-label="Về lịch chính"><Icon name="back" /></a>
        <div className="payrollBrand">
          <img src="/rr-logo-submark-square.png" alt="" />
          <span><small>ROOT ROTATION</small><strong>Trung tâm tính lương</strong></span>
        </div>
        <div className="payrollHeaderUser"><span>{username.slice(0, 1).toUpperCase()}</span><div><small>Admin</small><strong>{username}</strong></div></div>
      </header>

      <section className="payrollHero">
        <div className="payrollHeroCopy">
          <span className="payrollEyebrow">PAYROLL LIVESTREAM · VẬN HÀNH</span>
          <h1>Từ ca đã xác nhận<br />đến bảng lương có thể đối soát.</h1>
          <p>
            Bộ máy payroll đối chiếu ca làm đã xác nhận với dữ liệu báo cáo livestream, sau đó tính lương cứng,
            hoa hồng, thuế và xử lý ngoại lệ trong một luồng vận hành nội bộ thống nhất.
          </p>
        </div>
        <div className="payrollImportCard">
          <div className="payrollImportIcon"><Icon name="upload" /></div>
          <div><strong>Nhập báo cáo livestream</strong><span>Nhận batch báo cáo định dạng .xlsx hoặc .csv · tối đa 10 MB</span></div>
          <input ref={fileInputRef} type="file" accept=".xlsx,.csv" onChange={(event) => setFile(event.target.files?.[0] || null)} hidden />
          <button className="payrollFilePicker" onClick={() => fileInputRef.current?.click()} type="button">
            <span>{file ? file.name : "Chọn batch báo cáo"}</span><small>{file ? `${(file.size / 1024).toFixed(0)} KB` : "Chọn file báo cáo livestream đã xuất"}</small>
          </button>
          <button className="payrollPrimaryButton" disabled={working === "upload"} onClick={() => void uploadReport()} type="button">
            <Icon name="upload" />{working === "upload" ? "Đang nhập..." : "Nhập batch báo cáo"}
          </button>
        </div>
      </section>

      <section className="payrollSyncPanel">
        <div className="payrollSyncCard primary">
          <span>Đồng bộ báo cáo livestream</span>
          <strong>{latestImport ? "Đã nhận batch báo cáo" : "Đang chờ batch báo cáo"}</strong>
          <small>
            {latestImport
              ? `Batch gần nhất: ${latestImport.fileName}`
              : "Tuần đang chọn chưa có batch báo cáo livestream nào được nhập vào."}
          </small>
        </div>
        <div className="payrollSyncCard">
          <span>Nguồn dữ liệu</span>
          <strong>Pipeline nhập báo cáo livestream</strong>
          <small>Dữ liệu báo cáo sẽ được chuẩn hóa trước khi bắt đầu đối chiếu payroll.</small>
        </div>
        <div className="payrollSyncCard">
          <span>Phạm vi batch</span>
          <strong>{latestImport ? `${formatDate(latestImport.dateFrom)} - ${formatDate(latestImport.dateTo)}` : "-"}</strong>
          <small>{latestImport ? `${latestImport.totalRows} dòng · ${latestImport.inserted} dòng đã nhập` : "Chưa có dòng dữ liệu nào được nhập."}</small>
        </div>
        <div className="payrollSyncCard">
          <span>Lần nhập gần nhất</span>
          <strong>{latestImport ? new Date(latestImport.importedAt).toLocaleString("vi-VN") : "-"}</strong>
          <small>Dữ liệu này sẽ tiếp tục được đối chiếu với ca đã xác nhận để tính lương.</small>
        </div>
      </section>

      <section className="payrollToolbar">
        <div className="payrollWeekControl">
          <Icon name="calendar" />
          <button onClick={() => setWeekStartKey(addDays(weekStartKey, -7))} aria-label="Tuần trước" type="button">‹</button>
          <span><small>Tuần lương</small><strong>{formatDate(weekStartKey)} - {formatDate(addDays(weekStartKey, 6))}</strong></span>
          <button onClick={() => setWeekStartKey(addDays(weekStartKey, 7))} aria-label="Tuần sau" type="button">›</button>
        </div>
        <div className="payrollActions">
          <span className={`payrollStatus ${isLocked ? "locked" : "draft"}`}>{isLocked ? "Đã khóa" : "Bản nháp"}</span>
          <button className="payrollActionButton" disabled={isLocked || Boolean(working)} onClick={() => void runAction("generate")} type="button"><Icon name="calculate" />{working === "generate" ? "Đang tính..." : "Tính lương tuần"}</button>
          <button className="payrollActionButton subtle" disabled={entries.length === 0} onClick={exportCsv} type="button"><Icon name="download" />Xuất CSV</button>
          <button className="payrollIconAction" disabled={isLocked || entries.length === 0 || Boolean(working)} onClick={() => void runAction("lock")} title="Khóa bảng lương" type="button"><Icon name="lock" /></button>
        </div>
      </section>

      {error ? <div className="payrollMessage error"><Icon name="alert" /><span>{error}</span></div> : null}
      {notice ? <div className="payrollMessage success"><span>{notice}</span></div> : null}

      <section className="payrollSummaryGrid" aria-busy={loading}>
        <article className="payrollSummaryCard featured"><span>Thực nhận toàn tuần</span><strong>{formatMoney(summary?.netPay)}</strong><small>{summary?.employeeCount || 0} nhân sự · {summary?.entryCount || 0} dòng lương</small><i><Icon name="money" /></i></article>
        <article className="payrollSummaryCard"><span>Giờ theo lịch</span><strong>{summary?.scheduledHours || 0}<em> giờ</em></strong><small>Lương cứng {formatMoney(summary?.basePay)}</small><i><Icon name="clock" /></i></article>
        <article className="payrollSummaryCard"><span>Gross GMV đối soát</span><strong>{formatMoney(summary?.grossGmv)}</strong><small>Hoa hồng {formatMoney(summary?.commissionPay)}</small></article>
        <article className={`payrollSummaryCard ${exceptions.length ? "warning" : ""}`}><span>Cần kiểm tra</span><strong>{exceptions.length}<em> ngoại lệ</em></strong><small>{exceptions.length ? "Chưa tự động tính các dòng lỗi" : "Dữ liệu đang đầy đủ"}</small><i><Icon name="alert" /></i></article>
      </section>

      {personHours.length > 0 ? (
        <section className="payrollPersonHours">
          <div className="payrollPanelTitle">
            <div><strong>Tổng giờ live theo từng người</strong><span>Giờ theo ca đã xác nhận và khớp báo cáo livestream trong tuần đang chọn</span></div>
            <div className="payrollPersonHoursActions">
              <small>{personHours.length} nhân sự</small>
              <button
                aria-expanded={personHoursOpen}
                className={`payrollCollapseButton ${personHoursOpen ? "open" : ""}`.trim()}
                onClick={() => setPersonHoursOpen((current) => !current)}
                type="button"
              >
                <span>{personHoursOpen ? "Thu gọn" : "Mở rộng"}</span>
                <Icon name="chevron" />
              </button>
            </div>
          </div>
          {personHoursOpen ? (
            <div className="payrollPersonHoursList">
              {personHours.map((person) => (
                <article className={`payrollPersonRow ${person.role}`} key={`${person.role}-${person.employeeId}`}>
                  <div className="payrollPersonRowIdentity">
                    <span className={`payrollRoleTag ${person.role}`}>{person.role === "host" ? "Host" : "Support"}</span>
                    <div>
                      <strong>{person.employeeName}</strong>
                      <small>{person.employeeId}{person.grade ? ` · ${person.grade}` : ""}</small>
                    </div>
                  </div>
                  <div className="payrollPersonRowMetrics">
                    <div><em>{formatHours(person.scheduledHours)}</em><span>Giờ live</span></div>
                    <div><em>{person.sessionCount}</em><span>Ca</span></div>
                    <div><em>{formatMoney(person.netPay)}</em><span>Thực nhận</span></div>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="payrollWorkspace">
        <nav className="payrollTabs" aria-label="Nội dung bảng lương">
          <button className={tab === "payroll" ? "active" : ""} onClick={() => setTab("payroll")} type="button">Bảng lương <span>{entries.length}</span></button>
          <button className={tab === "exceptions" ? "active" : ""} onClick={() => setTab("exceptions")} type="button">Ngoại lệ <span>{exceptions.length}</span></button>
          <button className={tab === "rates" ? "active" : ""} onClick={() => setTab("rates")} type="button">Bảng giá & quy tắc</button>
        </nav>

        {tab === "payroll" ? (
          <div className="payrollTablePanel">
            <div className="payrollPanelTitle"><div><strong>Payroll entries by livestream session</strong><span>Confirmed session time + matched livestream report data + payroll rules</span></div><small>{payload?.generatedAt ? `Calculated at ${new Date(payload.generatedAt).toLocaleString("vi-VN")}` : "Not calculated yet"}</small></div>
            {loading ? <div className="payrollEmpty">Loading selected payroll week...</div> : entries.length === 0 ? <div className="payrollEmpty"><Icon name="calculate" /><strong>No payroll entries yet</strong><span>Ingest a livestream report batch, then run payroll calculation for the selected week.</span></div> : (
              <div className="payrollTableScroll"><table className="payrollTable"><thead><tr><th>Nhân sự</th><th>Phiên</th><th>Giờ / Đơn giá</th><th>GMV tính HH</th><th>Lương cứng</th><th>Hoa hồng</th><th>Thuế</th><th>Thực nhận</th></tr></thead><tbody>
                {entries.map((entry) => <tr key={entry.entryKey}>
                  <td data-label="Nhân sự"><span className={`payrollPerson ${entry.role}`}><i>{entry.employeeName.slice(0, 1)}</i><span><strong>{entry.employeeName}</strong><small>{entry.employeeId} · {entry.role === "host" ? "Host" : "Support"} {entry.grade ? `· ${entry.grade}` : ""}</small></span></span></td>
                  <td data-label="Phiên"><strong>{formatDate(entry.dateKey)} · {entry.location === "studio" ? "Studio" : "Home"}</strong><small>@{entry.accountId} · {entry.tiktokLiveIds.length} Live ID</small></td>
                  <td data-label="Giờ / Đơn giá"><strong>{entry.scheduledHours}h</strong><small>{formatMoney(entry.hourlyRate)}/h</small></td>
                  <td data-label="GMV tính HH"><strong>{formatMoney(entry.eligibleGmv)}</strong><small>Gross {formatMoney(entry.grossGmv)} · Hoàn {formatMoney(entry.returnedGmv)}</small></td>
                  <td data-label="Lương cứng">{formatMoney(entry.basePay)}</td>
                  <td data-label="Hoa hồng"><strong>{formatMoney(entry.commissionPay)}</strong><small>{formatPercent(entry.commissionRate)}</small></td>
                  <td data-label="Thuế">-{formatMoney(entry.taxAmount)}</td>
                  <td data-label="Thực nhận"><strong className="payrollNetValue">{formatMoney(entry.netPay)}</strong></td>
                </tr>)}
              </tbody></table></div>
            )}
          </div>
        ) : null}

        {tab === "exceptions" ? (
          <div className="payrollExceptionGrid">
            <div className="payrollTablePanel payrollExceptionPanel"><div className="payrollPanelTitle"><div><strong>Exception review queue</strong><span>These records require admin review before they can be finalized in payroll</span></div></div>
              {exceptions.length === 0 ? <div className="payrollEmpty"><strong>No exceptions</strong><span>Confirmed sessions and livestream report data are currently aligned.</span></div> : exceptions.map((item) => <article className="payrollException" key={item.exceptionKey}><i><Icon name="alert" /></i><div><span>{item.type.replace(/_/g, " ")}</span><strong>{item.message}</strong><small>{formatDate(item.dateKey)}{item.accountId ? ` · @${item.accountId}` : ""}{item.sessionId ? ` · ${item.sessionId}` : ""}</small></div></article>)}
            </div>
            <aside className="payrollImports"><div className="payrollPanelTitle"><div><strong>Ingestion history</strong><span>Report batches linked to the selected payroll week</span></div></div>
              {(payload?.imports || []).length === 0 ? <div className="payrollEmpty compact">No report batches for this week yet.</div> : payload?.imports?.map((item) => <article key={item.batchId}><span>.{item.fileName.split(".").pop()?.toUpperCase()}</span><div><strong>{item.fileName}</strong><small>{formatDate(item.dateFrom)} - {formatDate(item.dateTo)} · {item.totalRows} rows</small></div><time>{new Date(item.importedAt).toLocaleDateString("vi-VN")}</time></article>)}
            </aside>
          </div>
        ) : null}

        {tab === "rates" && draftSettings ? (
          <div className="payrollRatesLayout">
            <div className="payrollTablePanel"><div className="payrollPanelTitle"><div><strong>Bảng giá theo grade</strong><span>Thay đổi chỉ áp dụng khi tính lại tuần draft</span></div></div><div className="payrollTableScroll"><table className="payrollTable payrollRateTable"><thead><tr><th>Vai trò</th><th>Grade</th><th>Lương/giờ</th><th>Cách tính HH</th><th>Tỷ lệ cố định</th><th>Hoạt động</th></tr></thead><tbody>
              {draftRates.map((rate, index) => <tr key={rate.id}><td data-label="Vai trò"><span className={`payrollRoleTag ${rate.role}`}>{rate.role === "host" ? "Host" : "Support"}</span></td><td data-label="Grade"><strong>{rate.grade}</strong></td><td data-label="Lương/giờ"><input type="number" min="0" step="1000" value={rate.hourlyRate} onChange={(event) => setDraftRates((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, hourlyRate: Number(event.target.value) } : item))} /></td><td data-label="Cách tính HH"><select value={rate.commissionMode} onChange={(event) => setDraftRates((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, commissionMode: event.target.value as PayrollRateCard["commissionMode"] } : item))}><option value="none">Không hoa hồng</option><option value="fixed">Tỷ lệ cố định</option><option value="gmv_tier">Theo bậc GMV</option></select></td><td data-label="Tỷ lệ cố định"><input disabled={rate.commissionMode !== "fixed"} type="number" min="0" max="100" step="0.1" value={rate.commissionRate * 100} onChange={(event) => setDraftRates((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, commissionRate: Number(event.target.value) / 100 } : item))} /></td><td data-label="Hoạt động"><input type="checkbox" checked={rate.active} onChange={(event) => setDraftRates((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, active: event.target.checked } : item))} /></td></tr>)}
            </tbody></table></div></div>
            <aside className="payrollRulePanel"><div className="payrollPanelTitle"><div><strong>Quy tắc chung</strong><span>Snapshot khi tính lương</span></div></div><label><span>Thuế khấu trừ</span><div><input type="number" min="0" max="100" value={draftSettings.taxRate * 100} onChange={(event) => setDraftSettings((current) => current ? { ...current, taxRate: Number(event.target.value) / 100 } : current)} /><em>%</em></div></label><label><span>Nối fragment tối đa</span><div><input type="number" min="0" max="60" value={draftSettings.joinGapMinutes} onChange={(event) => setDraftSettings((current) => current ? { ...current, joinGapMinutes: Number(event.target.value) } : current)} /><em>phút</em></div></label><strong className="payrollRuleHeading">Bậc GMV cho Host A / S</strong>{draftSettings.hostGmvTiers.map((tier, index) => <div className="payrollTier" key={index}><input aria-label="Mức GMV" type="number" min="0" step="1000000" value={tier.minimumGmv} onChange={(event) => setDraftSettings((current) => current ? { ...current, hostGmvTiers: current.hostGmvTiers.map((item, itemIndex) => itemIndex === index ? { ...item, minimumGmv: Number(event.target.value) } : item) } : current)} /><span>→</span><input aria-label="Hoa hồng" type="number" min="0" max="100" step="0.1" value={tier.commissionRate * 100} onChange={(event) => setDraftSettings((current) => current ? { ...current, hostGmvTiers: current.hostGmvTiers.map((item, itemIndex) => itemIndex === index ? { ...item, commissionRate: Number(event.target.value) / 100 } : item) } : current)} /><em>%</em></div>)}<button className="payrollPrimaryButton" disabled={working === "rates"} onClick={() => void saveRates()} type="button">{working === "rates" ? "Đang lưu..." : "Lưu bảng giá"}</button></aside>
          </div>
        ) : null}
      </section>
    </main>
  );
}
