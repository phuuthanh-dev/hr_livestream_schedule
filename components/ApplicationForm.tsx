"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import type { EmployeeRole } from "@/lib/types";

type ApplicationFormState = {
  role: EmployeeRole;
  fullName: string;
  phone: string;
  email: string;
  cvUrl: string;
  experience: string;
  achievements: string;
  expectedSalary: string;
  liveLocationPreference: "" | "home" | "studio";
  liveAccountPreference: "" | "personal" | "company";
  introVideoUrl: string;
  tiktokUrl: string;
  notes: string;
  consent: boolean;
  website: string;
};

const INITIAL_FORM: ApplicationFormState = {
  role: "host",
  fullName: "",
  phone: "",
  email: "",
  cvUrl: "",
  experience: "",
  achievements: "",
  expectedSalary: "",
  liveLocationPreference: "home",
  liveAccountPreference: "company",
  introVideoUrl: "",
  tiktokUrl: "",
  notes: "",
  consent: false,
  website: ""
};

function RoleIcon({ role }: { role: EmployeeRole }) {
  if (role === "host") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M8 9a4 4 0 1 1 8 0v4a4 4 0 0 1-8 0V9Z" />
        <path d="M5 12v1a7 7 0 0 0 14 0v-1M12 20v2M8 22h8" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 13v-2a8 8 0 0 1 16 0v2" />
      <path d="M4 12H2v5a2 2 0 0 0 2 2h2v-7H4ZM20 12h2v5a2 2 0 0 1-2 2h-2v-7h2ZM18 19c0 2-2 3-5 3" />
    </svg>
  );
}

export default function ApplicationForm() {
  const [form, setForm] = useState<ApplicationFormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function updateField<K extends keyof ApplicationFormState>(key: K, value: ApplicationFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  }

  function chooseRole(role: EmployeeRole) {
    setForm((current) => ({
      ...current,
      role,
      ...(role === "host"
        ? {
            liveLocationPreference: current.liveLocationPreference || "home",
            liveAccountPreference: current.liveAccountPreference || "company"
          }
        : {
            liveLocationPreference: "",
            liveAccountPreference: "",
            introVideoUrl: "",
            tiktokUrl: ""
          })
    }));
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form)
      });
      const payload = (await response.json()) as { success?: boolean; message?: string };
      if (!response.ok || !payload.success) throw new Error(payload.message || "Không gửi được hồ sơ.");
      setSuccess(payload.message || "Hồ sơ đã được gửi thành công.");
      setForm({ ...INITIAL_FORM, role: form.role });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Không gửi được hồ sơ.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <section className="applicationSuccess" aria-live="polite">
        <span className="applicationSuccessMark">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>
        </span>
        <p>Hồ sơ đã lên sóng</p>
        <h2>Cảm ơn bạn đã ứng tuyển.</h2>
        <span>{success}</span>
        <div>
          <button onClick={() => setSuccess("")} type="button">Gửi hồ sơ khác</button>
          <a href="/login">Về trang đăng nhập</a>
        </div>
      </section>
    );
  }

  return (
    <form className="applicationForm" onSubmit={submit}>
      <div className="applicationFormHeading">
        <p>HỒ SƠ ỨNG TUYỂN</p>
        <h2>Bắt đầu với vai trò phù hợp</h2>
        <span>Các trường có dấu * là thông tin bắt buộc.</span>
      </div>

      <fieldset className="applicationRolePicker">
        <legend>Vị trí ứng tuyển *</legend>
        <button
          aria-pressed={form.role === "host"}
          className={form.role === "host" ? "active host" : "host"}
          onClick={() => chooseRole("host")}
          type="button"
        >
          <i><RoleIcon role="host" /></i>
          <span><strong>Host Livestream</strong><small>Tự tin trước ống kính, dẫn dắt phiên live</small></span>
          <em>{form.role === "host" ? "Đã chọn" : "Chọn"}</em>
        </button>
        <button
          aria-pressed={form.role === "support"}
          className={form.role === "support" ? "active support" : "support"}
          onClick={() => chooseRole("support")}
          type="button"
        >
          <i><RoleIcon role="support" /></i>
          <span><strong>Support Live</strong><small>Vận hành, phối hợp và giữ nhịp phiên live</small></span>
          <em>{form.role === "support" ? "Đã chọn" : "Chọn"}</em>
        </button>
      </fieldset>

      <section className="applicationFormSection">
        <header><span>01</span><div><h3>Thông tin liên hệ</h3><p>Để đội ngũ có thể liên hệ và trao đổi công việc.</p></div></header>
        <div className="applicationFields">
          <label><span>Họ và tên *</span><input autoComplete="name" maxLength={120} onChange={(event) => updateField("fullName", event.target.value)} placeholder="Nguyễn Minh Anh" required value={form.fullName} /></label>
          <label><span>Số điện thoại *</span><input autoComplete="tel" inputMode="tel" maxLength={30} onChange={(event) => updateField("phone", event.target.value)} placeholder="0901 234 567" required value={form.phone} /></label>
          <label className="wide"><span>Email</span><input autoComplete="email" maxLength={180} onChange={(event) => updateField("email", event.target.value)} placeholder="minhanh@email.com" type="email" value={form.email} /></label>
        </div>
      </section>

      <section className="applicationFormSection">
        <header><span>02</span><div><h3>Năng lực & kỳ vọng</h3><p>Chia sẻ ngắn gọn nhưng cụ thể về kinh nghiệm của bạn.</p></div></header>
        <div className="applicationFields">
          <label className="wide"><span>Link CV / Portfolio *</span><input maxLength={1000} onChange={(event) => updateField("cvUrl", event.target.value)} placeholder="https://drive.google.com/..." required type="url" value={form.cvUrl} /><small>Hãy bật quyền xem cho link Google Drive hoặc PDF.</small></label>
          <label className="wide"><span>Kinh nghiệm *</span><textarea maxLength={3000} onChange={(event) => updateField("experience", event.target.value)} placeholder={form.role === "host" ? "Ví dụ: 1 năm livestream ngành mỹ phẩm, trung bình 4 giờ/phiên..." : "Ví dụ: vận hành OBS, quản lý comment, phối hợp Host trong phiên live..."} required rows={5} value={form.experience} /></label>
          <label className="wide"><span>Thành tích nổi bật</span><textarea maxLength={2000} onChange={(event) => updateField("achievements", event.target.value)} placeholder="Doanh số, số phiên live, thương hiệu từng hợp tác hoặc kết quả nổi bật..." rows={4} value={form.achievements} /></label>
          <label className="wide"><span>Lương mong muốn *</span><input maxLength={120} onChange={(event) => updateField("expectedSalary", event.target.value)} placeholder="Ví dụ: 150.000đ/giờ hoặc 12.000.000đ/tháng" required value={form.expectedSalary} /></label>
        </div>
      </section>

      {form.role === "host" ? (
        <section className="applicationFormSection hostPortfolioSection">
          <header><span>03</span><div><h3>Hồ sơ lên hình</h3><p>Dành riêng cho Host để đội ngũ hiểu rõ phong cách của bạn.</p></div></header>
          <div className="applicationFields">
            <label>
              <span>Nơi live mong muốn *</span>
              <select required value={form.liveLocationPreference} onChange={(event) => updateField("liveLocationPreference", event.target.value as ApplicationFormState["liveLocationPreference"])}>
                <option value="home">Live tại nhà</option>
                <option value="studio">Live tại Studio</option>
              </select>
            </label>
            <label>
              <span>Tài khoản live *</span>
              <select required value={form.liveAccountPreference} onChange={(event) => updateField("liveAccountPreference", event.target.value as ApplicationFormState["liveAccountPreference"])}>
                <option value="personal">Live tài khoản cá nhân</option>
                <option value="company">Live tài khoản công ty</option>
              </select>
            </label>
            <label className="wide"><span>Link video giới thiệu / video live</span><input maxLength={1000} onChange={(event) => updateField("introVideoUrl", event.target.value)} placeholder="YouTube, Google Drive hoặc video công khai" type="url" value={form.introVideoUrl} /></label>
            <label className="wide"><span>Link TikTok</span><input maxLength={1000} onChange={(event) => updateField("tiktokUrl", event.target.value)} placeholder="https://www.tiktok.com/@username" type="url" value={form.tiktokUrl} /></label>
          </div>
        </section>
      ) : null}

      <section className="applicationFormSection finalSection">
        <header><span>{form.role === "host" ? "04" : "03"}</span><div><h3>Thông tin thêm</h3><p>Những điều bạn muốn đội ngũ tuyển dụng biết trước.</p></div></header>
        <div className="applicationFields">
          <label className="wide"><span>Ghi chú</span><textarea maxLength={2000} onChange={(event) => updateField("notes", event.target.value)} placeholder="Khung giờ có thể làm việc, ngày bắt đầu, mong muốn khác..." rows={4} value={form.notes} /></label>
          <label className="applicationConsent wide"><input checked={form.consent} onChange={(event) => updateField("consent", event.target.checked)} required type="checkbox" /><span>Tôi đồng ý để Root Rotation lưu và sử dụng thông tin này cho mục đích tuyển dụng. *</span></label>
          <label className="applicationHoneypot" aria-hidden="true"><span>Website</span><input autoComplete="off" onChange={(event) => updateField("website", event.target.value)} tabIndex={-1} value={form.website} /></label>
        </div>
      </section>

      {error ? <p className="applicationFormError" aria-live="polite">{error}</p> : null}
      <div className="applicationSubmitRow">
        <span>Kiểm tra lại các đường link trước khi gửi.</span>
        <button disabled={submitting} type="submit">
          {submitting ? "Đang gửi hồ sơ..." : "Gửi hồ sơ ứng tuyển"}
          {!submitting ? <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg> : null}
        </button>
      </div>
    </form>
  );
}
