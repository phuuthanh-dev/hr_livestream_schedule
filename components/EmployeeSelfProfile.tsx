"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useState } from "react";
import AppShellHeader from "@/components/AppShellHeader";
import type { EmployeeAdminPayload, SchedulePerson } from "@/lib/types";

type EmployeeSelfProfileProps = { username: string };
type ProfileForm = { name: string; aliasName: string; phone: string; email: string };
type ProfilePayload = EmployeeAdminPayload & { sheetSynced?: boolean };

const EMPTY_FORM: ProfileForm = { name: "", aliasName: "", phone: "", email: "" };

function ProfileIcon({ name }: { name: "calendar" | "chevronDown" | "contract" | "image" | "profile" | "shield" }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "calendar") return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>;
  if (name === "chevronDown") return <svg {...common}><path d="m6 9 6 6 6-6" /></svg>;
  if (name === "contract") return <svg {...common}><path d="M6 2h9l4 4v16H6z" /><path d="M14 2v5h5M9 12h6M9 16h6" /></svg>;
  if (name === "image") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="2" /><path d="m21 15-5-5L5 20" /></svg>;
  if (name === "shield") return <svg {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></svg>;
  return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
}

function toForm(employee: SchedulePerson): ProfileForm {
  return {
    name: employee.name || "",
    aliasName: employee.aliasName || "",
    phone: employee.phone || "",
    email: employee.email || ""
  };
}

export default function EmployeeSelfProfile({ username }: EmployeeSelfProfileProps) {
  const [employee, setEmployee] = useState<SchedulePerson | null>(null);
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [deleteAvatarOpen, setDeleteAvatarOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadProfile() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/profile", { cache: "no-store" });
      const payload = await response.json() as ProfilePayload;
      if (!response.ok || !payload.success || !payload.employee) throw new Error(payload.message || "Không tải được hồ sơ cá nhân.");
      setEmployee(payload.employee);
      setForm(toForm(payload.employee));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không tải được hồ sơ cá nhân.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadProfile(); }, []);

  useEffect(() => {
    if (window.location.hash !== "#security") return;
    setSecurityOpen(true);
    window.requestAnimationFrame(() => document.getElementById("security")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, []);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview("");
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  function updateField(field: keyof ProfileForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function selectAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Avatar chỉ nhận định dạng JPEG, PNG hoặc WebP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Avatar không được vượt quá 5 MB.");
      return;
    }
    setError("");
    setMessage("");
    setAvatarFile(file);
  }

  async function saveAvatar() {
    if (!avatarFile) return;
    setAvatarBusy(true);
    setError("");
    setMessage("");
    try {
      const signatureResponse = await fetch("/api/profile/avatar/signature", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contentType: avatarFile.type, size: avatarFile.size })
      });
      const signaturePayload = await signatureResponse.json() as {
        success?: boolean;
        message?: string;
        upload?: { uploadUrl: string; apiKey: string; allowedFormats: string; publicId: string; timestamp: number; signature: string; deliveryType: string };
      };
      if (!signatureResponse.ok || !signaturePayload.success || !signaturePayload.upload) {
        throw new Error(signaturePayload.message || "Không tạo được phiên tải avatar.");
      }
      const upload = signaturePayload.upload;
      const body = new FormData();
      body.set("file", avatarFile);
      body.set("api_key", upload.apiKey);
      body.set("allowed_formats", upload.allowedFormats);
      body.set("public_id", upload.publicId);
      body.set("timestamp", String(upload.timestamp));
      body.set("signature", upload.signature);
      body.set("type", upload.deliveryType);
      const cloudinaryResponse = await fetch(upload.uploadUrl, { method: "POST", body });
      const cloudinaryPayload = await cloudinaryResponse.json() as { public_id?: string; error?: { message?: string } };
      if (!cloudinaryResponse.ok || cloudinaryPayload.public_id !== upload.publicId) {
        throw new Error(cloudinaryPayload.error?.message || "Cloudinary không nhận được avatar.");
      }
      const completeResponse = await fetch("/api/profile/avatar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicId: upload.publicId })
      });
      const completePayload = await completeResponse.json() as ProfilePayload;
      if (!completeResponse.ok || !completePayload.success || !completePayload.employee) {
        throw new Error(completePayload.message || "Không xác nhận được avatar.");
      }
      setEmployee(completePayload.employee);
      setAvatarFile(null);
      setMessage("Ảnh đại diện đã được cập nhật.");
    } catch (avatarError) {
      setError(avatarError instanceof Error ? avatarError.message : "Không cập nhật được avatar.");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function deleteAvatar() {
    setAvatarBusy(true);
    setError("");
    try {
      const response = await fetch("/api/profile/avatar", { method: "DELETE" });
      const payload = await response.json() as ProfilePayload;
      if (!response.ok || !payload.success || !payload.employee) throw new Error(payload.message || "Không xóa được avatar.");
      setEmployee(payload.employee);
      setAvatarFile(null);
      setDeleteAvatarOpen(false);
      setMessage("Đã xóa ảnh đại diện.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Không xóa được avatar.");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form)
      });
      const payload = await response.json() as ProfilePayload;
      if (!response.ok || !payload.success || !payload.employee) throw new Error(payload.message || "Không lưu được hồ sơ.");
      setEmployee(payload.employee);
      setForm(toForm(payload.employee));
      setMessage(payload.message || "Đã lưu hồ sơ cá nhân.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không lưu được hồ sơ cá nhân.");
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChangingPassword(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
      });
      const payload = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !payload.success) throw new Error(payload.message || "Không đổi được mật khẩu.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage(payload.message || "Đã đổi mật khẩu.");
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "Không đổi được mật khẩu.");
    } finally {
      setChangingPassword(false);
    }
  }

  function openSecurity() {
    setSecurityOpen(true);
    window.history.replaceState(null, "", "#security");
    window.requestAnimationFrame(() => document.getElementById("security")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const displayedAvatar = avatarPreview || employee?.avatarUrl || "";

  return (
    <main className="selfProfileApp">
      <AppShellHeader
        className="selfProfileHeader"
        middleContent={<nav className="selfProfileNav"><a href="/">Lịch chính</a><a href="/availability">Lịch rảnh</a><a href="/contract">Hợp đồng</a></nav>}
        onLogout={logout}
        onOpenAccount={openSecurity}
        title="Hồ sơ của tôi"
        username={employee?.name || username}
      />

      <section className="selfProfileWorkspace">
        <header className="selfProfileHero">
          <div><span>PERSONAL PROFILE</span><h1>Một hồ sơ đúng,<br />mọi thông tin đều nhất quán.</h1><p>Chủ động cập nhật thông tin liên hệ và ảnh đại diện của bạn. Mã nhân viên, vai trò và dữ liệu vận hành được hệ thống bảo vệ.</p></div>
          <div className="selfProfileHeroMeta"><ProfileIcon name="shield" /><span><small>Quyền chỉnh sửa</small><strong>Chỉ hồ sơ của bạn</strong></span></div>
        </header>

        {error ? <div className="selfProfileNotice error" role="alert">{error}</div> : null}
        {message ? <div className="selfProfileNotice success" role="status">{message}</div> : null}

        {loading ? <div className="selfProfileLoading">Đang tải hồ sơ cá nhân...</div> : null}
        {!loading && employee ? (
          <div className="selfProfileLayout">
            <aside className="selfProfilePortraitCard">
              <div className={`selfProfileAvatar ${employee.role}`}>
                {displayedAvatar ? <img alt={`Ảnh đại diện ${employee.name}`} src={displayedAvatar} /> : <span>{employee.name.slice(0, 1).toUpperCase()}</span>}
              </div>
              <div className="selfProfileIdentity"><small>{employee.role === "host" ? "HOST LIVESTREAM" : "SUPPORT LIVE"}</small><h2>{employee.name}</h2><code>{employee.id}</code></div>
              <div className="selfProfileAvatarGuide"><ProfileIcon name="image" /><span><strong>Ảnh đại diện</strong><small>Ảnh vuông, rõ khuôn mặt. JPEG, PNG hoặc WebP, tối đa 5 MB.</small></span></div>
              <div className="selfProfileAvatarActions">
                <label><input accept="image/jpeg,image/png,image/webp" onChange={selectAvatar} type="file" /><span>{avatarFile ? "Chọn ảnh khác" : employee.avatarUrl ? "Thay ảnh" : "Chọn ảnh"}</span></label>
                {avatarFile ? <button className="primary" disabled={avatarBusy} onClick={() => void saveAvatar()} type="button">{avatarBusy ? "Đang tải..." : "Lưu ảnh"}</button> : null}
                {employee.avatarUrl && !avatarFile ? <button className="danger" disabled={avatarBusy} onClick={() => setDeleteAvatarOpen(true)} type="button">Xóa ảnh</button> : null}
                {avatarFile ? <button onClick={() => setAvatarFile(null)} type="button">Hủy chọn</button> : null}
              </div>
            </aside>

            <div className="selfProfileContent">
              <form className="selfProfileForm" onSubmit={saveProfile}>
                <div className="selfProfileSectionHeading"><b>01</b><span><strong>Thông tin cá nhân</strong><small>Nhập thông tin đang sử dụng để HR và vận hành liên hệ chính xác.</small></span></div>
                <div className="selfProfileFormGrid">
                  <label className="wide"><span>Họ và tên *</span><input autoComplete="name" maxLength={180} required value={form.name} onChange={(event) => updateField("name", event.target.value)} /></label>
                  <label><span>Tên gọi khác</span><input maxLength={120} value={form.aliasName} onChange={(event) => updateField("aliasName", event.target.value)} placeholder="Tên thường dùng / nickname" /></label>
                  <label><span>Số điện thoại</span><input autoComplete="tel" inputMode="tel" type="tel" value={form.phone} onChange={(event) => updateField("phone", event.target.value)} placeholder="0901 234 567" /></label>
                  <label className="wide"><span>Email</span><input autoComplete="email" maxLength={180} type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} placeholder="tenban@example.com" /></label>
                </div>

                <div className="selfProfileReadonlyBlock">
                  <div className="selfProfileSectionHeading"><b>02</b><span><strong>Thông tin hệ thống</strong><small>Các trường này do HR quản lý và không thể sửa tại đây.</small></span></div>
                  <div className="selfProfileReadonlyGrid">
                    <article><small>Mã nhân viên</small><strong>{employee.id}</strong></article>
                    <article><small>Vai trò</small><strong>{employee.role === "host" ? "Host" : "Support Live"}</strong></article>
                    <article><small>Level / Grade</small><strong>{employee.level || "Chưa cập nhật"}</strong></article>
                    <article><small>Trạng thái</small><strong>{employee.active === false ? "Tạm ngưng" : "Đang hoạt động"}</strong></article>
                  </div>
                </div>

                <footer><span><ProfileIcon name="shield" /> Thông tin được lưu vào hồ sơ nhân sự trên ứng dụng.</span><button disabled={saving} type="submit">{saving ? "Đang lưu..." : "Lưu thay đổi"}</button></footer>
              </form>

              <details className="selfProfileSecurity" id="security" open={securityOpen} onToggle={(event) => setSecurityOpen(event.currentTarget.open)}>
                <summary>
                  <span className="selfProfileSectionHeading"><b>03</b><span><strong>Bảo mật & mật khẩu</strong><small>Đổi mật khẩu đăng nhập và thu hồi các phiên cũ.</small></span></span>
                  <i aria-hidden="true"><ProfileIcon name="chevronDown" /></i>
                </summary>
                <form className="selfProfilePasswordForm" onSubmit={changePassword}>
                  <label><span>Mật khẩu hiện tại *</span><input autoComplete="current-password" required type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
                  <label><span>Mật khẩu mới *</span><input autoComplete="new-password" required type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
                  <label><span>Nhập lại mật khẩu mới *</span><input autoComplete="new-password" required type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
                  <div><small>Sau khi đổi mật khẩu, các phiên đăng nhập cũ sẽ bị thu hồi để bảo vệ tài khoản.</small><button disabled={changingPassword} type="submit">{changingPassword ? "Đang đổi..." : "Đổi mật khẩu"}</button></div>
                </form>
              </details>
            </div>
          </div>
        ) : null}
      </section>

      <AlertDialog.Root open={deleteAvatarOpen} onOpenChange={(open) => !avatarBusy && setDeleteAvatarOpen(open)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="employeeDeleteOverlay" />
          <AlertDialog.Content className="employeeDeleteDialog">
            <AlertDialog.Title>Xóa ảnh đại diện?</AlertDialog.Title>
            <AlertDialog.Description>Ảnh hiện tại sẽ bị xóa khỏi hồ sơ và Cloudinary.</AlertDialog.Description>
            <p>Bạn có thể tải ảnh mới lên bất cứ lúc nào.</p>
            <div className="employeeDeleteActions"><AlertDialog.Cancel asChild><button disabled={avatarBusy} type="button">Giữ lại</button></AlertDialog.Cancel><AlertDialog.Action asChild><button className="danger" disabled={avatarBusy} onClick={() => void deleteAvatar()} type="button">{avatarBusy ? "Đang xóa..." : "Xóa ảnh"}</button></AlertDialog.Action></div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </main>
  );
}
