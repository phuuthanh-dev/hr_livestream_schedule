"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";

type ChecklistItem = {
  id: string;
  label: string;
  detail: string;
  allowNa?: boolean;
};

type ChecklistSection = {
  id: string;
  title: string;
  items: ChecklistItem[];
};

type TrainingEntry = {
  score: 0 | 1 | 2 | 3 | 4;
  note: string;
  notApplicable: boolean;
};

type TrainingMeta = {
  isFinalShift: boolean;
  reviewedShift: string;
  reviewedLocation: string;
  evaluatorName: string;
};

type TrainingFeedback = {
  strengths: string;
  improvementAreas: string;
  incidentNotes: string;
  trainingProposal: string;
  conclusion: string;
  generalNotes: string;
};

type TrainingProfile = {
  employeeId: string;
  employeeName: string;
  entries: Record<string, TrainingEntry>;
  meta: TrainingMeta;
  feedback: TrainingFeedback;
  evaluation: {
    totalItems: number;
    applicableItems: number;
    excludedItems: number;
    maxScore: number;
    achievedScore: number;
    scorePercent: number;
    classification: string;
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

const SCORE_OPTIONS = [0, 1, 2, 3, 4] as const;
const END_OF_DAY_ITEM_IDS = new Set(["final_shift_report", "final_shift_shutdown"]);

function buildEmptyEntry(notApplicable = false): TrainingEntry {
  return {
    score: 0,
    note: notApplicable ? "Không thuộc ca cuối ngày." : "",
    notApplicable
  };
}

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
  const [entries, setEntries] = useState<Record<string, TrainingEntry>>({});
  const [meta, setMeta] = useState<TrainingMeta>({
    isFinalShift: true,
    reviewedShift: "",
    reviewedLocation: "",
    evaluatorName: ""
  });
  const [feedback, setFeedback] = useState<TrainingFeedback>({
    strengths: "",
    improvementAreas: "",
    incidentNotes: "",
    trainingProposal: "",
    conclusion: "",
    generalNotes: ""
  });
  const [profile, setProfile] = useState<TrainingProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetch(
      `/api/support-training?employeeId=${encodeURIComponent(employeeId)}&employeeName=${encodeURIComponent(employeeName)}`,
      { cache: "no-store" }
    )
      .then(async (response) => {
        const payload = await response.json() as Payload;
        if (!response.ok || !payload.success) {
          throw new Error(payload.message || "Không tải được checklist training.");
        }
        if (!active) return;
        setChecklist(payload.checklist || []);
        setProfile(payload.profile || null);
        setEntries(payload.profile?.entries || {});
        setMeta(payload.profile?.meta || {
          isFinalShift: true,
          reviewedShift: "",
          reviewedLocation: "",
          evaluatorName: ""
        });
        setFeedback(payload.profile?.feedback || {
          strengths: "",
          improvementAreas: "",
          incidentNotes: "",
          trainingProposal: "",
          conclusion: "",
          generalNotes: ""
        });
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
  }, [employeeId, employeeName]);

  useEffect(() => {
    if (checklist.length === 0) return;
    setEntries((current) => {
      const next = { ...current };
      for (const section of checklist) {
        for (const item of section.items) {
          const forcedNa = meta.isFinalShift === false && END_OF_DAY_ITEM_IDS.has(item.id);
          const previous = next[item.id] || buildEmptyEntry(forcedNa);
          next[item.id] = forcedNa
            ? { ...previous, notApplicable: true, note: previous.note || "Không thuộc ca cuối ngày." }
            : item.allowNa
              ? previous
              : { ...previous, notApplicable: false };
        }
      }
      return next;
    });
  }, [checklist, meta.isFinalShift]);

  const totals = useMemo(() => {
    let totalItems = 0;
    let applicableItems = 0;
    let achievedScore = 0;
    for (const section of checklist) {
      for (const item of section.items) {
        totalItems += 1;
        const entry = entries[item.id];
        if (entry?.notApplicable) continue;
        applicableItems += 1;
        achievedScore += entry?.score ?? 0;
      }
    }
    const maxScore = applicableItems * 4;
    const percent = maxScore === 0 ? 0 : Math.round((achievedScore / maxScore) * 100);
    return { totalItems, applicableItems, achievedScore, maxScore, percent };
  }, [checklist, entries]);

  async function saveForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/support-training", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ employeeId, entries, meta, feedback })
      });
      const payload = await response.json() as Payload;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message || "Không lưu được checklist training.");
      }
      setChecklist(payload.checklist || []);
      setProfile(payload.profile || null);
      setEntries(payload.profile?.entries || entries);
      setMeta(payload.profile?.meta || meta);
      setFeedback(payload.profile?.feedback || feedback);
      setMessage(payload.message || "Đã lưu checklist training.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không lưu được checklist training.");
    } finally {
      setSaving(false);
    }
  }

  function updateEntry(itemId: string, patch: Partial<TrainingEntry>) {
    setEntries((current) => ({
      ...current,
      [itemId]: {
        ...(current[itemId] || buildEmptyEntry()),
        ...patch
      }
    }));
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
          <span className="contractEyebrow">SCORECARD · PDF SOP</span>
          <h1>Đánh giá Support Live theo thang điểm 0 - 4.</h1>
          <p>Form này bám theo mẫu PDF đánh giá Support Live: chấm từng tiêu chí, có N/A cho ca cuối ngày và tự suy ra level cùng cash offer.</p>
          <div className="supportTrainingProgressCard">
            <span>Tổng điểm hiện tại</span>
            <strong>{totals.achievedScore}/{totals.maxScore || 0}</strong>
            <i><b style={{ width: `${totals.percent}%` }} /></i>
            <small>{totals.percent}% · {totals.applicableItems}/{totals.totalItems} tiêu chí đang được tính</small>
          </div>
          {profile ? (
            <div className={`supportTrainingResultCard ${profile.evaluation.passed ? "pass" : "fail"}`}>
              <span>Đánh giá hiện tại</span>
              <strong>{profile.evaluation.classification}</strong>
              <small>Rating {profile.evaluation.rating} · {profile.evaluation.level} · Cash Offer {profile.evaluation.cashOffer}</small>
              <small>{profile.evaluation.trainingStatus} · {profile.evaluation.scorePercent}% · loại trừ {profile.evaluation.excludedItems} tiêu chí</small>
            </div>
          ) : null}
        </aside>

        <section className="supportTrainingSurface">
          {error ? <div className="notice errorNotice">{error}</div> : null}
          {message ? <div className="notice successNotice">{message}</div> : null}
          {loading ? <div className="contractLoading">Đang tải form đánh giá support live...</div> : (
            <form className="supportTrainingForm" onSubmit={saveForm}>
              <section className="contractSection">
                <header>
                  <span>Thông tin đánh giá</span>
                  <div>
                    <strong>Bối cảnh chấm điểm</strong>
                    <p>Điền ca được đánh giá, người chấm và đánh dấu nếu đây không phải ca cuối ngày.</p>
                  </div>
                </header>
                <div className="supportTrainingMetaGrid">
                  <label>
                    <span>Ca làm việc</span>
                    <input
                      onChange={(event) => setMeta((current) => ({ ...current, reviewedShift: event.target.value }))}
                      placeholder="Ví dụ: 18:00 - 20:00 ngày 22/08/2026"
                      value={meta.reviewedShift}
                    />
                  </label>
                  <label>
                    <span>Địa điểm</span>
                    <input
                      onChange={(event) => setMeta((current) => ({ ...current, reviewedLocation: event.target.value }))}
                      placeholder="Ví dụ: Studio Phan Xích Long"
                      value={meta.reviewedLocation}
                    />
                  </label>
                  <label>
                    <span>Người đánh giá</span>
                    <input
                      onChange={(event) => setMeta((current) => ({ ...current, evaluatorName: event.target.value }))}
                      placeholder="Tên người đánh giá"
                      value={meta.evaluatorName}
                    />
                  </label>
                  <label className="supportTrainingSwitch">
                    <input
                      checked={meta.isFinalShift}
                      onChange={(event) => setMeta((current) => ({ ...current, isFinalShift: event.target.checked }))}
                      type="checkbox"
                    />
                    <span>Nhân sự này là ca cuối ngày</span>
                    <small>Nếu bỏ chọn, 2 mục “Report ca cuối” và “Đóng ca cuối” sẽ tự chuyển sang N/A.</small>
                  </label>
                </div>
              </section>

              {checklist.map((section) => {
                const sectionItems = section.items;
                const sectionApplicable = sectionItems.filter((item) => !entries[item.id]?.notApplicable);
                const sectionScore = sectionApplicable.reduce((total, item) => total + (entries[item.id]?.score || 0), 0);
                const sectionMax = sectionApplicable.length * 4;
                return (
                  <section className="contractSection" key={section.id}>
                    <header>
                      <span>{section.title}</span>
                      <div>
                        <strong>{sectionScore}/{sectionMax || 0}</strong>
                        <p>Chấm từng tiêu chí theo thang 0 - 4, thêm ghi chú nếu cần.</p>
                      </div>
                    </header>
                    <div className="supportTrainingChecklist">
                      {section.items.map((item, index) => {
                        const entry = entries[item.id] || buildEmptyEntry();
                        return (
                          <article className={`supportTrainingItem ${entry.notApplicable ? "na" : ""}`} key={item.id}>
                            <div className="supportTrainingItemHead">
                              <div>
                                <strong>{index + 1}. {item.label}</strong>
                                <span>{item.detail}</span>
                              </div>
                              {item.allowNa ? (
                                <label className="supportTrainingNaToggle">
                                  <input
                                    checked={entry.notApplicable}
                                    onChange={(event) => updateEntry(item.id, {
                                      notApplicable: event.target.checked,
                                      note: event.target.checked
                                        ? (entry.note || "Không thuộc ca cuối ngày.")
                                        : (entry.note === "Không thuộc ca cuối ngày." ? "" : entry.note)
                                    })}
                                    type="checkbox"
                                  />
                                  <span>N/A</span>
                                </label>
                              ) : null}
                            </div>
                            <div className="supportTrainingScoreRow">
                              {SCORE_OPTIONS.map((score) => (
                                <button
                                  className={`supportTrainingScoreButton ${!entry.notApplicable && entry.score === score ? "active" : ""}`}
                                  disabled={entry.notApplicable}
                                  key={score}
                                  onClick={() => updateEntry(item.id, { score, notApplicable: false })}
                                  type="button"
                                >
                                  {score}
                                </button>
                              ))}
                            </div>
                            <textarea
                              className="supportTrainingItemNote"
                              onChange={(event) => updateEntry(item.id, { note: event.target.value })}
                              placeholder="Ghi chú cho tiêu chí này..."
                              rows={2}
                              value={entry.note}
                            />
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })}

              <section className="contractSection">
                <header>
                  <span>Nhận xét và hướng xử lý</span>
                  <div>
                    <strong>Tổng kết theo mẫu PDF</strong>
                    <p>Ghi rõ điểm mạnh, điểm cần cải thiện, lỗi phát sinh và đề xuất đào tạo.</p>
                  </div>
                </header>
                <div className="supportTrainingFeedbackGrid">
                  <label>
                    <span>Điểm mạnh</span>
                    <textarea
                      onChange={(event) => setFeedback((current) => ({ ...current, strengths: event.target.value }))}
                      rows={4}
                      value={feedback.strengths}
                    />
                  </label>
                  <label>
                    <span>Điểm cần cải thiện</span>
                    <textarea
                      onChange={(event) => setFeedback((current) => ({ ...current, improvementAreas: event.target.value }))}
                      rows={4}
                      value={feedback.improvementAreas}
                    />
                  </label>
                  <label>
                    <span>Lỗi phát sinh liên quan hàng hóa / thiết bị / BBBG</span>
                    <textarea
                      onChange={(event) => setFeedback((current) => ({ ...current, incidentNotes: event.target.value }))}
                      rows={4}
                      value={feedback.incidentNotes}
                    />
                  </label>
                  <label>
                    <span>Đề xuất đào tạo hoặc nhắc nhở</span>
                    <textarea
                      onChange={(event) => setFeedback((current) => ({ ...current, trainingProposal: event.target.value }))}
                      rows={4}
                      value={feedback.trainingProposal}
                    />
                  </label>
                  <label>
                    <span>Kết luận</span>
                    <textarea
                      onChange={(event) => setFeedback((current) => ({ ...current, conclusion: event.target.value }))}
                      rows={4}
                      value={feedback.conclusion}
                    />
                  </label>
                  <label>
                    <span>Ghi chú bổ sung</span>
                    <textarea
                      onChange={(event) => setFeedback((current) => ({ ...current, generalNotes: event.target.value }))}
                      placeholder="Thông tin nội bộ thêm nếu cần."
                      rows={4}
                      value={feedback.generalNotes}
                    />
                  </label>
                </div>
              </section>

              <footer className="contractFormFooter">
                <span>{profile?.updatedAt ? `Cập nhật gần nhất: ${new Date(profile.updatedAt).toLocaleString("vi-VN")}` : "Chưa lưu đánh giá lần nào"}</span>
                <button disabled={saving} type="submit">{saving ? "Đang lưu đánh giá..." : "Lưu kết quả training"}</button>
              </footer>
            </form>
          )}
        </section>
      </section>
    </main>
  );
}
