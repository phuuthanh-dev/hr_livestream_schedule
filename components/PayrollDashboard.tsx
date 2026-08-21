"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { getScheduleWeekStartKey } from "@/lib/scheduleDate";
import type {
  EmployeeAdminPayload,
  PayrollDashboardPayload,
  PayrollRateCard,
  PayrollSettings,
  PayrollSheetExportRecord
} from "@/lib/types";

type PayrollDashboardProps = {
  username: string;
  initialWeekStartKey?: string;
};

type Tab = "payroll" | "exceptions" | "rates";
type PayrollEmployeeOption = { id: string; name: string; role: "host" | "support"; grade?: string };

function Icon({ name }: { name: "back" | "upload" | "calculate" | "lock" | "download" | "alert" | "money" | "clock" | "calendar" | "chevron" | "chevronDown" | "search" }) {
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
    chevron: <path d="m6 9 6 6 6-6" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>
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
  const [personHoursOpen, setPersonHoursOpen] = useState(false);
  const [sheetExportOpen, setSheetExportOpen] = useState(false);
  const [payslipRangeOpen, setPayslipRangeOpen] = useState(false);
  const [sheetRangeOpen, setSheetRangeOpen] = useState(false);
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false);
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);
  const [sheetFromDate, setSheetFromDate] = useState(initialWeekStartKey || currentWeekStart());
  const [sheetToDate, setSheetToDate] = useState(addDays(initialWeekStartKey || currentWeekStart(), 6));
  const [payslipFromDate, setPayslipFromDate] = useState(initialWeekStartKey || currentWeekStart());
  const [payslipToDate, setPayslipToDate] = useState(addDays(initialWeekStartKey || currentWeekStart(), 6));
  const [adjustmentRole, setAdjustmentRole] = useState<"host" | "support">("support");
  const [adjustmentEmployeeId, setAdjustmentEmployeeId] = useState("");
  const [adjustmentDateKey, setAdjustmentDateKey] = useState(initialWeekStartKey || currentWeekStart());
  const [adjustmentHours, setAdjustmentHours] = useState("2");
  const [adjustmentNote, setAdjustmentNote] = useState("Công bù");
  const [rosterEmployeeOptions, setRosterEmployeeOptions] = useState<PayrollEmployeeOption[]>([]);
  const [employeeOptions, setEmployeeOptions] = useState<PayrollEmployeeOption[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const adjustmentEmployeePickerRef = useRef<HTMLDivElement>(null);
  const [adjustmentEmployeePickerOpen, setAdjustmentEmployeePickerOpen] = useState(false);
  const [adjustmentEmployeePickerQuery, setAdjustmentEmployeePickerQuery] = useState("");

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

  async function loadEmployeeOptions(signal?: AbortSignal) {
    try {
      const response = await fetch("/api/people", { signal, cache: "no-store" });
      const result = await response.json() as {
        success?: boolean;
        hosts?: Array<{ id: string; name: string; role: "host"; level?: string }>;
        supports?: Array<{ id: string; name: string; role: "support"; level?: string }>;
      };
      if (!response.ok || !result.success) throw new Error("Không tải được roster nhân sự.");
      const nextOptions: PayrollEmployeeOption[] = [
        ...(result.hosts || []).map((person) => ({ id: person.id, name: person.name, role: "host" as const, grade: person.level })),
        ...(result.supports || []).map((person) => ({ id: person.id, name: person.name, role: "support" as const, grade: person.level }))
      ];
      setRosterEmployeeOptions(nextOptions.sort((left, right) =>
        left.role.localeCompare(right.role) || left.name.localeCompare(right.name, "vi")
      ));
    } catch {
      // Keep the in-memory fallback from current payroll entries if roster API is unavailable.
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadDashboard(controller.signal);
    void loadEmployeeOptions(controller.signal);
    return () => controller.abort();
  }, [weekStartKey]);

  useEffect(() => {
    const nextToDate = addDays(weekStartKey, 6);
    setSheetFromDate(weekStartKey);
    setSheetToDate(nextToDate);
    setPayslipFromDate(weekStartKey);
    setPayslipToDate(nextToDate);
    setAdjustmentDateKey(weekStartKey);
  }, [weekStartKey]);

  useEffect(() => {
    const unique = new Map<string, PayrollEmployeeOption>();
    rosterEmployeeOptions.forEach((person) => {
      unique.set(`${person.role}:${person.id.toLowerCase()}`, person);
    });
    (payload?.personHours || []).forEach((person) => {
      unique.set(`${person.role}:${person.employeeId.toLowerCase()}`, {
        id: person.employeeId,
        name: person.employeeName,
        role: person.role,
        grade: person.grade
      });
    });
    (payload?.entries || []).forEach((entry) => {
      unique.set(`${entry.role}:${entry.employeeId.toLowerCase()}`, {
        id: entry.employeeId,
        name: entry.employeeName,
        role: entry.role,
        grade: entry.grade
      });
    });
    setEmployeeOptions(Array.from(unique.values()).sort((left, right) =>
      left.role.localeCompare(right.role) || left.name.localeCompare(right.name, "vi")
    ));
  }, [payload, rosterEmployeeOptions]);

  useEffect(() => {
    const firstMatch = employeeOptions.find((item) => item.role === adjustmentRole);
    if (!adjustmentEmployeeId || !employeeOptions.some((item) => item.role === adjustmentRole && item.id === adjustmentEmployeeId)) {
      setAdjustmentEmployeeId(firstMatch?.id || "");
    }
  }, [adjustmentRole, adjustmentEmployeeId, employeeOptions]);

  useEffect(() => {
    setAdjustmentEmployeePickerOpen(false);
    setAdjustmentEmployeePickerQuery("");
  }, [adjustmentRole, adjustmentModalOpen]);

  useEffect(() => {
    if (!adjustmentEmployeePickerOpen) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (!adjustmentEmployeePickerRef.current?.contains(event.target as Node)) {
        setAdjustmentEmployeePickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [adjustmentEmployeePickerOpen]);

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
      if (action === "lock") setLockConfirmOpen(false);
      setNotice(result.message || (action === "generate" ? "Đã tính lương." : "Đã khóa tuần lương."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Thao tác không thành công.");
    } finally {
      setWorking("");
    }
  }

  async function exportToSheet() {
    setWorking("export-sheet");
    setError("");
    setNotice("");
    try {
      const fromDate = sheetFromDate;
      const toDate = sheetToDate;
      if (fromDate > toDate) {
        throw new Error("Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc.");
      }
      const response = await fetch("/api/payroll/export-sheet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekStartKey, fromDate, toDate })
      });
      const result = await response.json() as PayrollSheetExportRecord & { success: boolean; message?: string; sheetUrl?: string; summarySheetUrl?: string };
      if (!response.ok || !result.success) throw new Error(result.message || "Không đồng bộ được bảng lương sang Google Sheet.");
      const summarySuffix = result.summarySheetUrl ? ` · Summary: ${result.summarySheetUrl}` : "";
      setNotice(`${result.message || "Đã đồng bộ bảng lương."}${result.sheetUrl ? ` Detail: ${result.sheetUrl}` : ""}${summarySuffix}`);
      setSheetRangeOpen(false);
      await loadDashboard();
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Không đồng bộ được bảng lương sang Google Sheet.");
    } finally {
      setWorking("");
    }
  }

  async function generatePayslips() {
    setWorking("payslips");
    setError("");
    setNotice("");
    try {
      const fromDate = payslipFromDate;
      const toDate = payslipToDate;
      if (fromDate > toDate) {
        throw new Error("Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc.");
      }
      const response = await fetch("/api/payroll/generate-payslips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          weekStartKey,
          fromDate,
          toDate
        })
      });
      const result = await response.json() as {
        success: boolean;
        message?: string;
        generatedCount?: number;
        failedCount?: number;
        documents?: Array<{ documentUrl: string }>;
      };
      if (!response.ok || (!result.success && !result.generatedCount)) {
        throw new Error(result.message || "Không tạo được phiếu lương.");
      }
      const suffix = result.documents?.length
        ? ` Mở phiếu đầu tiên: ${result.documents[0].documentUrl}`
        : "";
      setNotice(`${result.message || "Đã tạo phiếu lương."}${suffix}`);
      setPayslipRangeOpen(false);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Không tạo được phiếu lương.");
    } finally {
      setWorking("");
    }
  }

  async function saveAdjustment() {
    setWorking("adjustment");
    setError("");
    setNotice("");
    try {
      const targetWeekStartKey = getScheduleWeekStartKey(adjustmentDateKey);
      const response = await fetch("/api/payroll/adjustments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          weekStartKey: targetWeekStartKey,
          dateKey: adjustmentDateKey,
          employeeId: adjustmentEmployeeId,
          role: adjustmentRole,
          hours: Number(adjustmentHours),
          note: adjustmentNote
        })
      });
      const result = await response.json() as PayrollDashboardPayload;
      if (!response.ok || !result.success) throw new Error(result.message || "Không lưu được công bù.");
      setPayload(result);
      setWeekStartKey(targetWeekStartKey);
      setNotice(result.message || "Đã lưu công bù.");
      setAdjustmentModalOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không lưu được công bù.");
    } finally {
      setWorking("");
    }
  }

  async function removeAdjustment(adjustmentId: string) {
    if (!window.confirm("Xóa công bù này và tính lại payroll tuần hiện tại?")) return;
    setWorking("adjustment-delete");
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/payroll/adjustments?adjustmentId=${encodeURIComponent(adjustmentId)}`, {
        method: "DELETE"
      });
      const result = await response.json() as PayrollDashboardPayload;
      if (!response.ok || !result.success) throw new Error(result.message || "Không xóa được công bù.");
      setPayload(result);
      setNotice(result.message || "Đã xóa công bù.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Không xóa được công bù.");
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
  const adjustments = payload?.adjustments || [];
  const exceptions = payload?.exceptions || [];
  const latestImport = payload?.imports?.[0];
  const sheetExport = payload?.sheetExport;
  const filteredAdjustmentPeople = useMemo(() => {
    const normalizedQuery = adjustmentEmployeePickerQuery.trim().toLowerCase();
    return employeeOptions.filter((item) => {
      if (item.role !== adjustmentRole) return false;
      if (!normalizedQuery) return true;
      return item.name.toLowerCase().includes(normalizedQuery) || item.id.toLowerCase().includes(normalizedQuery);
    });
  }, [adjustmentEmployeePickerQuery, adjustmentRole, employeeOptions]);
  const selectedAdjustmentEmployee = employeeOptions.find((item) => item.role === adjustmentRole && item.id === adjustmentEmployeeId) || null;

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
          <button className={`payrollActionButton subtle ${adjustmentModalOpen ? "active" : ""}`.trim()} disabled={isLocked || Boolean(working)} onClick={() => setAdjustmentModalOpen(true)} type="button"><Icon name="clock" />Công bù</button>
          <button className={`payrollActionButton subtle ${payslipRangeOpen ? "active" : ""}`.trim()} disabled={Boolean(working)} onClick={() => setPayslipRangeOpen((current) => !current)} type="button"><Icon name="download" />Tạo phiếu lương</button>
          <button className="payrollActionButton subtle" disabled={entries.length === 0} onClick={exportCsv} type="button"><Icon name="download" />Xuất CSV</button>
          <button className={`payrollActionButton subtle ${sheetRangeOpen ? "active" : ""}`.trim()} disabled={Boolean(working)} onClick={() => setSheetRangeOpen((current) => !current)} type="button"><Icon name="upload" />Sync Payroll Sheets</button>
          <button className="payrollIconAction" disabled={isLocked || entries.length === 0 || Boolean(working)} onClick={() => setLockConfirmOpen(true)} title="Khóa bảng lương" type="button"><Icon name="lock" /></button>
        </div>
      </section>

      {sheetRangeOpen ? (
        <section className="payrollRangePanel">
          <div className="payrollPanelTitle">
            <div>
              <strong>Đồng bộ payroll ra Google Sheet theo khoảng ngày</strong>
              <span>Chọn khoảng ngày cần ghi vào <code>Payroll_Sheet</code> và <code>Payroll_Summary_Raw</code>. Hệ thống sẽ replace đúng phạm vi ngày này trên sheet.</span>
            </div>
          </div>
          <div className="payrollRangeFields">
            <label>
              <span>Từ ngày</span>
              <input
                onChange={(event) => setSheetFromDate(event.target.value)}
                type="date"
                value={sheetFromDate}
              />
            </label>
            <label>
              <span>Đến ngày</span>
              <input
                onChange={(event) => setSheetToDate(event.target.value)}
                type="date"
                value={sheetToDate}
              />
            </label>
            <div className="payrollRangeActions">
              <button className="payrollActionButton subtle" disabled={Boolean(working)} onClick={() => { const nextToDate = addDays(weekStartKey, 6); setSheetFromDate(weekStartKey); setSheetToDate(nextToDate); setSheetRangeOpen(false); }} type="button">Đóng</button>
              <button className="payrollActionButton" disabled={Boolean(working)} onClick={() => void exportToSheet()} type="button">
                <Icon name="upload" />{working === "export-sheet" ? "Đang đồng bộ..." : "Xác nhận sync sheet"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {payslipRangeOpen ? (
        <section className="payrollRangePanel">
          <div className="payrollPanelTitle">
            <div>
              <strong>Tạo phiếu lương theo khoảng ngày</strong>
              <span>Chọn khoảng ngày cần tổng hợp. Hệ thống sẽ tạo phiếu cho mọi nhân sự có dữ liệu payroll trong khoảng này, không phụ thuộc tuần đang mở.</span>
            </div>
          </div>
          <div className="payrollRangeFields">
            <label>
              <span>Từ ngày</span>
              <input
                onChange={(event) => setPayslipFromDate(event.target.value)}
                type="date"
                value={payslipFromDate}
              />
            </label>
            <label>
              <span>Đến ngày</span>
              <input
                onChange={(event) => setPayslipToDate(event.target.value)}
                type="date"
                value={payslipToDate}
              />
            </label>
            <div className="payrollRangeActions">
              <button className="payrollActionButton subtle" disabled={Boolean(working)} onClick={() => { const nextToDate = addDays(weekStartKey, 6); setPayslipFromDate(weekStartKey); setPayslipToDate(nextToDate); setPayslipRangeOpen(false); }} type="button">Đóng</button>
              <button className="payrollActionButton" disabled={Boolean(working)} onClick={() => void generatePayslips()} type="button">
                <Icon name="download" />{working === "payslips" ? "Đang tạo phiếu..." : "Xác nhận tạo phiếu"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {error ? <div className="payrollMessage error"><Icon name="alert" /><span>{error}</span></div> : null}
      {notice ? <div className="payrollMessage success"><span>{notice}</span></div> : null}

      {adjustmentModalOpen ? (
        <div className="payrollModalBackdrop" role="dialog" aria-modal="true" aria-label="Công bù payroll">
          <section className="payrollAdjustmentModal">
            <div className="payrollPanelTitle">
              <div>
                <strong>Công bù theo ngày</strong>
                <span>Áp dụng cho tuần đang chọn, lưu vào DB và tự regenerate payroll nếu tuần chưa khóa.</span>
              </div>
              <button className="payrollIconAction" disabled={Boolean(working)} onClick={() => setAdjustmentModalOpen(false)} type="button">×</button>
            </div>
            <div className="payrollAdjustmentGrid">
              <label>
                <span>Vai trò</span>
                <select value={adjustmentRole} onChange={(event) => setAdjustmentRole(event.target.value as "host" | "support")}>
                  <option value="support">Support</option>
                  <option value="host">Host</option>
                </select>
              </label>
              <label>
                <span>Nhân sự</span>
                <div className={`payrollEmployeePicker ${adjustmentEmployeePickerOpen ? "isOpen" : ""}`} ref={adjustmentEmployeePickerRef}>
                  <button
                    className="payrollEmployeePickerTrigger"
                    onClick={() => setAdjustmentEmployeePickerOpen((current) => !current)}
                    type="button"
                  >
                    <span>
                      {selectedAdjustmentEmployee
                        ? `${selectedAdjustmentEmployee.name} · ${selectedAdjustmentEmployee.id}${selectedAdjustmentEmployee.grade ? ` · ${selectedAdjustmentEmployee.grade}` : ""}`
                        : "Chọn nhân sự"}
                    </span>
                    <em>{filteredAdjustmentPeople.length}</em>
                    <Icon name="chevronDown" />
                  </button>
                  {adjustmentEmployeePickerOpen ? (
                    <div className="payrollEmployeePickerPanel">
                      <div className="payrollEmployeePickerSearch">
                        <Icon name="search" />
                        <input
                          autoFocus
                          value={adjustmentEmployeePickerQuery}
                          onChange={(event) => setAdjustmentEmployeePickerQuery(event.target.value)}
                          placeholder="Tìm tên hoặc mã..."
                        />
                      </div>
                      <div className="payrollEmployeePickerList" role="listbox" aria-label="Danh sách nhân sự payroll">
                        {filteredAdjustmentPeople.map((item) => (
                          <button
                            className={`payrollEmployeePickerOption ${adjustmentEmployeeId === item.id ? "isSelected" : ""}`}
                            key={`${item.role}-${item.id}`}
                            onClick={() => {
                              setAdjustmentEmployeeId(item.id);
                              setAdjustmentEmployeePickerOpen(false);
                              setAdjustmentEmployeePickerQuery("");
                            }}
                            type="button"
                          >
                            <strong>{item.name}</strong>
                            <small>{item.id}{item.grade ? ` · ${item.grade}` : ""}</small>
                          </button>
                        ))}
                        {filteredAdjustmentPeople.length === 0 ? (
                          <div className="payrollEmployeePickerEmpty">Không tìm thấy nhân sự phù hợp.</div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </label>
              <label>
                <span>Ngày</span>
                <input type="date" value={adjustmentDateKey} onChange={(event) => setAdjustmentDateKey(event.target.value)} />
              </label>
              <label>
                <span>Số giờ bù</span>
                <input type="number" min="0.5" max="24" step="0.5" value={adjustmentHours} onChange={(event) => setAdjustmentHours(event.target.value)} />
              </label>
              <label className="wide">
                <span>Ghi chú</span>
                <input type="text" maxLength={160} value={adjustmentNote} onChange={(event) => setAdjustmentNote(event.target.value)} placeholder="Ví dụ: Deal fix fail không có host" />
              </label>
            </div>
            <div className="payrollAdjustmentList">
              <strong>Công bù hiện có trong tuần</strong>
              {adjustments.length === 0 ? (
                <div className="payrollEmpty compact">Chưa có công bù nào trong tuần này.</div>
              ) : adjustments.map((adjustment) => (
                <article className="payrollAdjustmentItem" key={adjustment.adjustmentId}>
                  <div>
                    <strong>{adjustment.employeeName} · {adjustment.employeeId}</strong>
                    <small>{formatDate(adjustment.dateKey)} · {adjustment.hours}h · {adjustment.role === "host" ? "Host" : "Support"}{adjustment.note ? ` · ${adjustment.note}` : ""}</small>
                  </div>
                  <button className="payrollAdjustmentDelete" disabled={Boolean(working)} onClick={() => void removeAdjustment(adjustment.adjustmentId)} type="button">Xóa</button>
                </article>
              ))}
            </div>
            <div className="payrollRangeActions">
              <button className="payrollActionButton subtle" disabled={Boolean(working)} onClick={() => setAdjustmentModalOpen(false)} type="button">Đóng</button>
              <button className="payrollActionButton" disabled={Boolean(working) || !adjustmentEmployeeId} onClick={() => void saveAdjustment()} type="button">
                <Icon name="clock" />{working === "adjustment" ? "Đang lưu..." : "Lưu công bù"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <section className="payrollExportPanel">
        <div className="payrollPanelTitle">
          <div>
            <strong>Đồng bộ bảng lương vào file master</strong>
            <span>Ghi chi tiết vào <code>Payroll_Sheet</code> và tổng hợp theo người vào <code>Payroll_Summary_Raw</code>, rồi read-back ngay sau khi ghi.</span>
          </div>
          <div className="payrollPersonHoursActions">
            <small>{sheetExport ? `${sheetExport.rowCount} dòng · ${sheetExport.tabTitle}` : "Chưa có lần đồng bộ nào"}</small>
            <button
              aria-expanded={sheetExportOpen}
              className={`payrollCollapseButton ${sheetExportOpen ? "open" : ""}`.trim()}
              onClick={() => setSheetExportOpen((current) => !current)}
              type="button"
            >
              <span>{sheetExportOpen ? "Thu gọn" : "Xem chi tiết"}</span>
              <Icon name="chevron" />
            </button>
          </div>
        </div>

        {sheetExportOpen ? (
          <>
            <div className="payrollExportSummary">
              <article className="payrollExportChip primary">
                <span>Trạng thái xuất</span>
                <strong>{sheetExport ? "Đã đồng bộ" : "Chưa đồng bộ"}</strong>
                <small>{sheetExport ? new Date(sheetExport.exportedAt).toLocaleString("vi-VN") : "Bấm nút sync để ghi vào file master."}</small>
              </article>
              <article className="payrollExportChip">
                <span>Tab chi tiết</span>
                <strong>{sheetExport?.tabTitle || "Payroll_Sheet"}</strong>
                <small>{sheetExport?.sheetUrl ? <a href={sheetExport.sheetUrl} target="_blank" rel="noreferrer">Mở Payroll_Sheet</a> : "Tab chi tiết nằm trong file master."}</small>
              </article>
              <article className="payrollExportChip">
                <span>Tab tổng hợp</span>
                <strong>{sheetExport?.summaryTabTitle || "Payroll_Summary_Raw"}</strong>
                <small>{sheetExport?.summarySheetUrl ? <a href={sheetExport.summarySheetUrl} target="_blank" rel="noreferrer">Mở Payroll_Summary_Raw</a> : "Tab tổng hợp nằm trong file master."}</small>
              </article>
              <article className="payrollExportChip">
                <span>Read-back</span>
                <strong>{sheetExport ? (sheetExport.verification.ok ? "Khớp 100%" : `Lệch ${sheetExport.verification.mismatches} ô`) : "-"}</strong>
                <small>{sheetExport ? `${sheetExport.verification.checked} ô đã được đối chiếu.` : "Sau khi ghi, hệ thống đọc lại đúng vùng vừa xuất."}</small>
              </article>
              <article className={`payrollExportChip ${exceptions.length ? "warning" : ""}`.trim()}>
                <span>Đối chiếu ca ↔ lương</span>
                <strong>{exceptions.length === 0 ? "Không ngoại lệ" : `${exceptions.length} ngoại lệ`}</strong>
                <small>{exceptions.length === 0 ? "Ca đã xác nhận đang khớp báo cáo TikTok." : "Xem tab Ngoại lệ trước khi chốt lương."}</small>
              </article>
            </div>
            <div className="payrollExportDetails">
              <article className="payrollExportDetailCard">
                <span>Lần xuất gần nhất</span>
                <strong>{sheetExport ? `Đã đồng bộ lúc ${new Date(sheetExport.exportedAt).toLocaleTimeString("vi-VN")} ${formatDate(sheetExport.weekStartKey)}` : "Chưa có dữ liệu"}</strong>
                <small>{sheetExport ? `${sheetExport.rowCount} dòng chi tiết và ${sheetExport.summaryRowCount || 0} dòng tổng hợp đã được ghi vào file master.` : "Lần sync đầu sẽ tạo tab chi tiết và tab tổng hợp nếu chưa có."}</small>
              </article>
              <article className="payrollExportDetailCard">
                <span>Xác minh sau ghi</span>
                <strong>{sheetExport ? (sheetExport.verification.ok ? "Đã read-back khớp hoàn toàn" : `Cần kiểm tra ${sheetExport.verification.mismatches} ô`) : "Chưa xác minh"}</strong>
                <small>{sheetExport ? `Hệ thống đọc lại ${sheetExport.verification.checked} ô trong đúng tab vừa xuất.` : "Khi xuất xong, hệ thống sẽ kiểm tra lại ngay trong cùng request."}</small>
              </article>
              <article className="payrollExportDetailCard">
                <span>Luồng dữ liệu</span>
                <strong>Payroll app → HR master file</strong>
                <small>Payroll giờ được ghi trực tiếp vào file master để HR, vận hành và downstream dùng chung.</small>
              </article>
            </div>
          </>
        ) : (
          <div className="payrollExportCollapsed">
            <span className="payrollExportCollapsedItem"><strong>Trạng thái:</strong> {sheetExport ? "Đã đồng bộ" : "Chưa đồng bộ"}</span>
            <span className="payrollExportCollapsedItem"><strong>Chi tiết:</strong> {sheetExport?.tabTitle || "Payroll_Sheet"}</span>
            <span className="payrollExportCollapsedItem"><strong>Tổng hợp:</strong> {sheetExport?.summaryTabTitle || "Payroll_Summary_Raw"}</span>
            <span className="payrollExportCollapsedItem"><strong>Read-back:</strong> {sheetExport ? (sheetExport.verification.ok ? "Khớp 100%" : `Lệch ${sheetExport.verification.mismatches} ô`) : "-"}</span>
            <span className="payrollExportCollapsedItem"><strong>Ngoại lệ:</strong> {exceptions.length}</span>
          </div>
        )}
      </section>

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
      <AlertDialog.Root open={lockConfirmOpen} onOpenChange={setLockConfirmOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="employeeDeleteOverlay" />
          <AlertDialog.Content className="employeeDeleteDialog">
            <AlertDialog.Title>Khóa bảng lương tuần</AlertDialog.Title>
            <AlertDialog.Description>
              Bảng lương tuần {formatDate(weekStartKey)} - {formatDate(addDays(weekStartKey, 6))} sẽ bị khóa.
            </AlertDialog.Description>
            <p>Sau khi khóa, tuần này không thể tính lại cho đến khi có can thiệp kỹ thuật.</p>
            <div className="employeeDeleteActions">
              <AlertDialog.Cancel asChild>
                <button disabled={Boolean(working)} type="button">Huỷ</button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  className="danger"
                  disabled={Boolean(working)}
                  onClick={() => void runAction("lock")}
                  type="button"
                >
                  {working === "lock" ? "Đang khóa..." : "Xác nhận khóa"}
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </main>
  );
}
