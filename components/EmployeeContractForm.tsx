"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useState } from "react";
import AccountPanel from "@/components/AccountPanel";
import AppShellHeader from "@/components/AppShellHeader";
import type { EmployeeContractDocumentSide, EmployeeContractProfile } from "@/lib/employeeContract";
import type { EmployeeRole } from "@/lib/types";

type EmployeeContractFormProps = {
  username: string;
  isAdmin: boolean;
  targetRole?: EmployeeRole;
  targetEmployeeId?: string;
};

type ContractFormState = {
  gmail: string;
  dateOfBirth: string;
  citizenId: string;
  citizenIdIssuedDate: string;
  citizenIdIssuedPlace: string;
  permanentAddress: string;
  temporaryAddress: string;
  bankAccountNumber: string;
  bankName: string;
};

type ContractPayload = {
  success: boolean;
  target?: { role: EmployeeRole; employeeId: string; employeeName: string };
  profile?: EmployeeContractProfile | null;
  message?: string;
};

type ContractUploadPayload = ContractPayload & {
  upload?: {
    uploadUrl: string;
    apiKey: string;
    allowedFormats: string;
    publicId: string;
    timestamp: number;
    signature: string;
    deliveryType: "authenticated";
  };
};

const EMPTY_FORM: ContractFormState = {
  gmail: "",
  dateOfBirth: "",
  citizenId: "",
  citizenIdIssuedDate: "",
  citizenIdIssuedPlace: "",
  permanentAddress: "",
  temporaryAddress: "",
  bankAccountNumber: "",
  bankName: ""
};

function safeText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toForm(profile?: EmployeeContractProfile | null): ContractFormState {
  if (!profile) return { ...EMPTY_FORM };
  return {
    gmail: safeText(profile.gmail),
    dateOfBirth: safeText(profile.dateOfBirth),
    citizenId: safeText(profile.citizenId),
    citizenIdIssuedDate: safeText(profile.citizenIdIssuedDate),
    citizenIdIssuedPlace: safeText(profile.citizenIdIssuedPlace),
    permanentAddress: safeText(profile.permanentAddress),
    temporaryAddress: safeText(profile.temporaryAddress),
    bankAccountNumber: safeText(profile.bankAccountNumber),
    bankName: safeText(profile.bankName)
  };
}

function FileIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4" /><path d="m7 16 3.5-4 2.7 3 1.8-2 2 3M8 8h.01" /></svg>;
}

const REQUIRED_CONTRACT_FIELDS: Array<keyof ContractFormState> = [
  "gmail",
  "dateOfBirth",
  "citizenId",
  "citizenIdIssuedDate",
  "citizenIdIssuedPlace",
  "permanentAddress",
  "temporaryAddress",
  "bankAccountNumber",
  "bankName"
];

function hasValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function calculateContractProgress(form: ContractFormState, profile: EmployeeContractProfile | null) {
  const completedFieldCount = REQUIRED_CONTRACT_FIELDS.filter((field) => hasValue(form[field])).length;
  const completedDocumentCount = Number(Boolean(profile?.citizenIdFront)) + Number(Boolean(profile?.citizenIdBack));
  const totalItems = REQUIRED_CONTRACT_FIELDS.length + 2;
  const completedItems = completedFieldCount + completedDocumentCount;
  const percent = totalItems === 0 ? 0 : Math.round((completedItems / totalItems) * 100);
  const status = completedItems === 0 ? "Chưa bắt đầu" : completedItems >= totalItems ? "Hồ sơ hoàn tất" : "Đang bổ sung";
  return {
    completedItems,
    totalItems,
    percent,
    status
  };
}

export default function EmployeeContractForm({
  username,
  isAdmin,
  targetRole,
  targetEmployeeId
}: EmployeeContractFormProps) {
  const [form, setForm] = useState<ContractFormState>(EMPTY_FORM);
  const [target, setTarget] = useState<ContractPayload["target"]>();
  const [profile, setProfile] = useState<EmployeeContractProfile | null>(null);
  const [files, setFiles] = useState<Record<EmployeeContractDocumentSide, File | null>>({ front: null, back: null });
  const [previewUrls, setPreviewUrls] = useState<Record<EmployeeContractDocumentSide, string>>({ front: "", back: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);

  function targetParams() {
    const params = new URLSearchParams();
    if (isAdmin && targetRole && targetEmployeeId) {
      params.set("role", targetRole);
      params.set("employeeId", targetEmployeeId);
    }
    return params;
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = targetParams();
    void fetch(`/api/contract-profile${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as ContractPayload;
        if (!response.ok || !payload.success || !payload.target) {
          throw new Error(payload.message || "Không tải được thông tin hợp đồng.");
        }
        if (!active) return;
        setTarget(payload.target);
        setProfile(payload.profile || null);
        setForm(toForm(payload.profile));
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Không tải được thông tin hợp đồng.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [isAdmin, targetEmployeeId, targetRole]);

  useEffect(() => {
    const nextFront = files.front ? URL.createObjectURL(files.front) : "";
    const nextBack = files.back ? URL.createObjectURL(files.back) : "";
    setPreviewUrls({ front: nextFront, back: nextBack });

    return () => {
      if (nextFront) URL.revokeObjectURL(nextFront);
      if (nextBack) URL.revokeObjectURL(nextBack);
    };
  }, [files.front, files.back]);

  function updateField(field: keyof ContractFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function selectFile(side: EmployeeContractDocumentSide, event: ChangeEvent<HTMLInputElement>) {
    setFiles((current) => ({ ...current, [side]: event.target.files?.[0] || null }));
  }

  async function uploadFile(side: EmployeeContractDocumentSide, file: File) {
    const targetValues = isAdmin ? { role: targetRole, employeeId: targetEmployeeId } : {};
    const signatureResponse = await fetch("/api/contract-profile/upload/signature", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...targetValues,
        side,
        contentType: file.type,
        size: file.size
      })
    });
    const signaturePayload = await signatureResponse.json() as ContractUploadPayload;
    if (!signatureResponse.ok || !signaturePayload.success || !signaturePayload.upload) {
      throw new Error(signaturePayload.message || "Không tạo được phiên tải CCCD.");
    }

    const upload = signaturePayload.upload;
    const cloudinaryBody = new FormData();
    cloudinaryBody.set("file", file);
    cloudinaryBody.set("api_key", upload.apiKey);
    cloudinaryBody.set("allowed_formats", upload.allowedFormats);
    cloudinaryBody.set("public_id", upload.publicId);
    cloudinaryBody.set("timestamp", String(upload.timestamp));
    cloudinaryBody.set("signature", upload.signature);
    cloudinaryBody.set("type", upload.deliveryType);
    const cloudinaryResponse = await fetch(upload.uploadUrl, { method: "POST", body: cloudinaryBody });
    const cloudinaryPayload = await cloudinaryResponse.json() as { public_id?: string; error?: { message?: string } };
    if (!cloudinaryResponse.ok || cloudinaryPayload.public_id !== upload.publicId) {
      throw new Error(cloudinaryPayload.error?.message || "Cloudinary không nhận được ảnh CCCD.");
    }

    const completeResponse = await fetch("/api/contract-profile/upload/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...targetValues,
        side,
        publicId: upload.publicId,
        originalFilename: file.name
      })
    });
    const completePayload = await completeResponse.json() as ContractPayload;
    if (!completeResponse.ok || !completePayload.success || !completePayload.profile) {
      throw new Error(completePayload.message || "Không xác nhận được ảnh CCCD.");
    }
    return completePayload.profile;
  }

  async function saveContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/contract-profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, role: targetRole, employeeId: targetEmployeeId })
      });
      const payload = await response.json() as ContractPayload;
      if (!response.ok || !payload.success || !payload.profile) {
        throw new Error(payload.message || "Không lưu được thông tin hợp đồng.");
      }

      let nextProfile = payload.profile;
      setProfile(nextProfile);
      for (const side of ["front", "back"] as const) {
        const file = files[side];
        if (file) {
          nextProfile = await uploadFile(side, file);
          setProfile(nextProfile);
          setFiles((current) => ({ ...current, [side]: null }));
        }
      }
      setProfile(nextProfile);
      setMessage(nextProfile.completed ? "Hồ sơ hợp đồng đã đầy đủ và được lưu an toàn." : "Đã lưu thông tin. Hãy tải đủ hai mặt CCCD để hoàn tất hồ sơ.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không lưu được thông tin hợp đồng.");
    } finally {
      setSaving(false);
    }
  }

  function documentUrl(side: EmployeeContractDocumentSide) {
    const params = targetParams();
    params.set("side", side);
    return `/api/contract-profile/document?${params.toString()}`;
  }

  const employeeName = target?.employeeName || username;
  const identity = target ? `${target.role === "host" ? "Host" : "Support Live"} · ${target.employeeId}` : "Đang tải hồ sơ";
  const contractCode = profile?.contractCode || (target?.employeeId ? `${target.employeeId}_HDLT2026` : "");
  const contractProgress = calculateContractProgress(form, profile);
  const employeeLocked = !isAdmin && profile?.completed === true;

  return (
    <main className="contractApp">
      <AppShellHeader
        className="contractHeader"
        middleContent={<a className="todayButton" href={isAdmin ? "/employees" : "/"}>{isAdmin ? "Danh sách nhân sự" : "Lịch chính"}</a>}
        onLogout={async () => {
          await fetch("/api/logout", { method: "POST" });
          window.location.href = "/login";
        }}
        onOpenAccount={() => setAccountPanelOpen(true)}
        rightContent={<div className="contractHeaderIdentity"><strong>{employeeName}</strong><span>{identity}</span></div>}
        title="Hồ sơ hợp đồng"
        username={username}
      />

      <section className="contractWorkspace">
        <aside className="contractIntro">
          <span className="contractEyebrow">PERSONAL RECORD · PRIVATE</span>
          <h1>Thông tin để hoàn thiện hợp đồng.</h1>
          <p>Nhân viên trực tiếp cung cấp dữ liệu. Hệ thống không thu thập thông tin BHXH trong biểu mẫu này.</p>
          <div className="contractPrivacyNote"><strong>Mã hợp đồng</strong><span>{contractCode || "Sẽ tạo sau khi xác định mã nhân viên"}</span></div>
          <div className={`contractProgress ${contractProgress.percent >= 100 ? "complete" : ""}`}>
            <span>{contractProgress.status}</span>
            <strong>{contractProgress.percent}%</strong>
            <i><b style={{ width: `${contractProgress.percent}%` }} /></i>
            <small>{contractProgress.completedItems}/{contractProgress.totalItems} mục đã hoàn thành</small>
          </div>
          <div className="contractPrivacyNote"><strong>Dữ liệu được giới hạn quyền truy cập</strong><span>Ảnh CCCD lưu ở chế độ riêng tư. Chỉ chính nhân viên và Admin mới mở được qua liên kết có thời hạn.</span></div>
        </aside>

        <section className="contractSurface">
          {error ? <div className="notice errorNotice">{error}</div> : null}
          {message ? <div className="notice successNotice">{message}</div> : null}
          {employeeLocked ? <div className="notice successNotice">Hồ sơ hợp đồng đã hoàn tất 100%. Nhân viên chỉ còn quyền xem, không thể chỉnh sửa thêm.</div> : null}
          {loading ? <div className="contractLoading">Đang tải hồ sơ hợp đồng...</div> : (
            <form className={`contractForm${employeeLocked ? " isLocked" : ""}`} onSubmit={saveContract}>
              <section className={`contractSection${employeeLocked ? " isLocked" : ""}`}>
                <header><span>01</span><div><strong>Thông tin cá nhân</strong><p>Dùng đúng thông tin trên CCCD.</p></div></header>
                <div className="contractFieldGrid">
                  <label className="wide"><span>Gmail *</span><input autoComplete="email" disabled={employeeLocked} maxLength={180} onChange={(event) => updateField("gmail", event.target.value)} placeholder="tennhanvien@gmail.com" required type="email" value={form.gmail} /></label>
                  <label><span>Ngày sinh *</span><input disabled={employeeLocked} onChange={(event) => updateField("dateOfBirth", event.target.value)} required type="date" value={form.dateOfBirth} /></label>
                  <label><span>CCCD *</span><input disabled={employeeLocked} inputMode="numeric" maxLength={12} onChange={(event) => updateField("citizenId", event.target.value.replace(/\D/g, ""))} placeholder="12 chữ số" required value={form.citizenId} /></label>
                  <label><span>Ngày cấp *</span><input disabled={employeeLocked} onChange={(event) => updateField("citizenIdIssuedDate", event.target.value)} required type="date" value={form.citizenIdIssuedDate} /></label>
                  <label><span>Nơi cấp *</span><input disabled={employeeLocked} maxLength={240} onChange={(event) => updateField("citizenIdIssuedPlace", event.target.value)} required value={form.citizenIdIssuedPlace} /></label>
                  <label className="wide"><span>Địa chỉ thường trú *</span><textarea disabled={employeeLocked} maxLength={1000} onChange={(event) => updateField("permanentAddress", event.target.value)} required rows={3} value={form.permanentAddress} /></label>
                  <label className="wide"><span>Địa chỉ tạm trú *</span><textarea disabled={employeeLocked} maxLength={1000} onChange={(event) => updateField("temporaryAddress", event.target.value)} required rows={3} value={form.temporaryAddress} /></label>
                </div>
              </section>

              <section className={`contractSection${employeeLocked ? " isLocked" : ""}`}>
                <header><span>02</span><div><strong>Thông tin nhận thanh toán</strong><p>Tài khoản ngân hàng phải thuộc về nhân viên.</p></div></header>
                <div className="contractFieldGrid">
                  <label><span>Số tài khoản *</span><input disabled={employeeLocked} inputMode="numeric" maxLength={30} onChange={(event) => updateField("bankAccountNumber", event.target.value.replace(/\D/g, ""))} required value={form.bankAccountNumber} /></label>
                  <label><span>Ngân hàng *</span><input disabled={employeeLocked} maxLength={120} onChange={(event) => updateField("bankName", event.target.value)} placeholder="Ví dụ: Vietcombank" required value={form.bankName} /></label>
                </div>
              </section>

              <section className={`contractSection${employeeLocked ? " isLocked" : ""}`}>
                <header><span>03</span><div><strong>Ảnh hai mặt CCCD</strong><p>JPEG, PNG hoặc WebP; tối đa 10 MB mỗi ảnh.</p></div></header>
                <div className="contractUploadGrid">
                  {(["front", "back"] as const).map((side) => {
                    const uploaded = side === "front" ? profile?.citizenIdFront : profile?.citizenIdBack;
                    return <label className={`contractUploadCard ${uploaded ? "uploaded" : ""}${employeeLocked ? " locked" : ""}`} key={side}>
                      <FileIcon />
                      <strong>{side === "front" ? "Mặt trước CCCD" : "Mặt sau CCCD"}</strong>
                      <span>{files[side]?.name || (uploaded ? "Đã lưu an toàn" : "Chọn ảnh để tải lên")}</span>
                      {previewUrls[side] ? <img alt={side === "front" ? "Preview mặt trước CCCD" : "Preview mặt sau CCCD"} className="contractUploadPreview" src={previewUrls[side]} /> : null}
                      <input accept="image/jpeg,image/png,image/webp" disabled={employeeLocked} onChange={(event) => selectFile(side, event)} type="file" />
                      {uploaded ? <a href={documentUrl(side)} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank">Xem ảnh đã lưu</a> : null}
                    </label>;
                  })}
                </div>
              </section>

              <footer className="contractFormFooter"><span>{profile?.updatedAt ? `Cập nhật gần nhất: ${new Date(profile.updatedAt).toLocaleString("vi-VN")}` : "Chưa lưu lần nào"}</span><button disabled={saving || employeeLocked} type="submit">{employeeLocked ? "Hồ sơ đã khóa" : saving ? "Đang lưu hồ sơ..." : "Lưu hồ sơ hợp đồng"}</button></footer>
            </form>
          )}
        </section>
      </section>

      {accountPanelOpen ? (
        <AccountPanel isAdmin={isAdmin} username={username} onClose={() => setAccountPanelOpen(false)} />
      ) : null}
    </main>
  );
}
