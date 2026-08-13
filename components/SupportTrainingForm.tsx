"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";

type ChecklistItem = {
  id: string;
  label: string;
  detail: string;
};

type ChecklistSection = {
  id: string;
  title: string;
  items: ChecklistItem[];
};

type TrainingProfile = {
  employeeId: string;
  employeeName: string;
  answers: Record<string, boolean>;
  notes: string;
  evaluation: {
    totalItems: number;
    checkedItems: number;
    scorePercent: number;
    rating: "A" | "B" | "C" | "D";
    level: string;
    cashOffer: string;
    passed: boolean;
    trainingStatus: string;
  };
  updatedAt: string;
};

type Payload = {
  success?: boolean;
  message?: string;
  checklist?: ChecklistSection[];
  profile?: TrainingProfile | null;
};

export default function SupportTrainingForm({
  employeeId,
  employeeName,
  isAdmin
}: {
  employeeId: string;
  employeeName: string;
  isAdmin: boolean;
}) {
  const [checklist, setChecklist] = useState<ChecklistSection[]>([]);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [profile, setProfile] = useState<TrainingProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetch(`/api/support-training?employeeId=${encodeURIComponent(employeeId)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as Payload;
        if (!response.ok || !payload.success) {
          throw new Error(payload.message || "Không tải được checklist training.");
        }
        if (!active) return;
        setChecklist(payload.checklist || []);
        setProfile(payload.profile || null);
        setAnswers(payload.profile?.answers || {});
        setNotes(payload.profile?.notes || "");
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Không tải được checklist training.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [employeeId]);

  const totalItems = checklist.reduce((total, section) => total + section.items.length, 0);
  const checkedItems = checklist.reduce((total, section) => total + section.items.reduce((sectionTotal, item) => sectionTotal + (answers[item.id] ? 1 : 0), 0), 0);
  const progress = totalItems === 0 ? 0 : Math.round((checkedItems / totalItems) * 100);

  async function saveForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/support-training", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ employeeId, answers, notes })
      });
      const payload = await response.json() as Payload;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message || "Không lưu được checklist training.");
      }
      setChecklist(payload.checklist || []);
      setProfile(payload.profile || null);
      setAnswers(payload.profile?.answers || answers);
      setNotes(payload.profile?.notes || notes);
      setMessage(payload.message || "Đã lưu checklist training.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không lưu được checklist training.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="supportTrainingApp">
      <header className="appHeader supportTrainingHeader">
        <div className="brandBlock">
          <span className="brandMark"><img className="brandLogo" src="/rr-logo-submark-square.png" alt="" /></span>
          <span className="brandName">Training Support Live</span>
        </div>
        <div className="supportTrainingIdentity">
          <strong>{employeeName}</strong>
          <span>{employeeId}{isAdmin ? " · Admin view" : ""}</span>
        </div>
        <a className="todayButton" href={isAdmin ? "/employees" : "/"}>Quay lại</a>
      </header>

      <section className="supportTrainingWorkspace">
        <aside className="supportTrainingSidebar">
          <span className="contractEyebrow">CHECKLIST · SOP</span>
          <h1>Checklist training để chấm rating support live.</h1>
          <p>Dữ liệu này tự động suy ra `rating`, `level`, `cash offer` và trạng thái training của support.</p>
          <div className="supportTrainingProgressCard">
            <span>Tiến độ checklist</span>
            <strong>{checkedItems}/{totalItems}</strong>
            <i><b style={{ width: `${progress}%` }} /></i>
            <small>{progress}% hạng mục đã xác nhận</small>
          </div>
          {profile ? (
            <div className={`supportTrainingResultCard ${profile.evaluation.passed ? "pass" : "fail"}`}>
              <span>Đánh giá hiện tại</span>
              <strong>Rating {profile.evaluation.rating}</strong>
              <small>{profile.evaluation.level} · Cash Offer {profile.evaluation.cashOffer}</small>
              <small>{profile.evaluation.trainingStatus} · {profile.evaluation.scorePercent}%</small>
            </div>
          ) : null}
        </aside>

        <section className="supportTrainingSurface">
          {error ? <div className="notice errorNotice">{error}</div> : null}
          {message ? <div className="notice successNotice">{message}</div> : null}
          {loading ? <div className="contractLoading">Đang tải checklist training...</div> : (
            <form className="supportTrainingForm" onSubmit={saveForm}>
              {checklist.map((section) => (
                <section className="contractSection" key={section.id}>
                  <header>
                    <span>{section.title}</span>
                    <div>
                      <strong>{section.items.filter((item) => answers[item.id]).length}/{section.items.length}</strong>
                      <p>Đánh dấu các hạng mục đã thực hiện đúng SOP.</p>
                    </div>
                  </header>
                  <div className="supportTrainingChecklist">
                    {section.items.map((item, index) => (
                      <label className={`supportTrainingItem ${answers[item.id] ? "checked" : ""}`} key={item.id}>
                        <input
                          checked={Boolean(answers[item.id])}
                          onChange={(event) => setAnswers((current) => ({ ...current, [item.id]: event.target.checked }))}
                          type="checkbox"
                        />
                        <strong>{index + 1}. {item.label}</strong>
                        <span>{item.detail}</span>
                      </label>
                    ))}
                  </div>
                </section>
              ))}

              <section className="contractSection">
                <header>
                  <span>Ghi chú đào tạo</span>
                  <div>
                    <strong>Nhận xét</strong>
                    <p>Lưu ý điểm mạnh, lỗi lặp lại hoặc yêu cầu đào tạo lại.</p>
                  </div>
                </header>
                <textarea
                  className="supportTrainingNotes"
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Ví dụ: chưa quen thao tác voucher, cần ôn lại phần chuyển màn hình và xử lý comment."
                  rows={5}
                  value={notes}
                />
              </section>

              <footer className="contractFormFooter">
                <span>{profile?.updatedAt ? `Cập nhật gần nhất: ${new Date(profile.updatedAt).toLocaleString("vi-VN")}` : "Chưa lưu checklist lần nào"}</span>
                <button disabled={saving} type="submit">{saving ? "Đang lưu checklist..." : "Lưu kết quả training"}</button>
              </footer>
            </form>
          )}
        </section>
      </section>
    </main>
  );
}
