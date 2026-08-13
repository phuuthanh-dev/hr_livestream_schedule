import type { EmployeeRole } from "@/lib/types";
import type { SchedulePersonMutation } from "@/lib/employeeRoster";

export type ApplicationAutomationInput = {
  applicationId?: string;
  submittedAt?: string;
  role: EmployeeRole;
  fullName: string;
  phone: string;
  email: string;
  cvUrl: string;
  experience: string;
  achievements: string;
  expectedSalary: string;
  liveLocationPreference?: "home" | "studio" | "";
  liveAccountPreference?: "personal" | "company" | "";
  introVideoUrl?: string;
  tiktokUrl?: string;
  notes: string;
};

function employeeIdPrefix(role: EmployeeRole) {
  return role === "host" ? "HRLT" : "HRSL";
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePhone(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return "";
  if (raw.startsWith("+")) return `+${raw.slice(1).replace(/\D/g, "")}`;
  return raw.replace(/\D/g, "");
}

function compactParagraphs(lines: string[]) {
  return lines.map((line) => line.trim()).filter(Boolean).join("\n");
}

export function buildEmployeeId(role: EmployeeRole, sequence: number) {
  return `${employeeIdPrefix(role)}${String(sequence).padStart(2, "0")}`;
}

export function parseEmployeeIdSequence(role: EmployeeRole, employeeId: string) {
  const match = cleanText(employeeId).toUpperCase().match(/^([A-Z]+)(\d+)/);
  if (!match || match[1] !== employeeIdPrefix(role)) return null;
  return Number.parseInt(match[2], 10);
}

export function nextEmployeeIdForRole(role: EmployeeRole, employeeIds: string[]) {
  const max = employeeIds.reduce((highest, employeeId) => {
    const next = parseEmployeeIdSequence(role, employeeId);
    return next && next > highest ? next : highest;
  }, 0);
  return buildEmployeeId(role, max + 1);
}

export function buildEmployeeMutationFromApplication(
  input: ApplicationAutomationInput,
  employeeId: string
): SchedulePersonMutation {
  const baseNotes = [
    input.email ? `Email: ${input.email}` : "",
    input.introVideoUrl ? `Video: ${input.introVideoUrl}` : "",
    input.tiktokUrl ? `TikTok: ${input.tiktokUrl}` : "",
    input.notes ? `Ghi chú: ${input.notes}` : ""
  ];

  if (input.role === "host") {
    return {
      id: employeeId,
      role: "host",
      name: input.fullName,
      level: "Mới ứng tuyển",
      workLocation: input.liveLocationPreference || "home",
      phone: normalizePhone(input.phone),
      cvReference: input.cvUrl,
      cashOffer: input.expectedSalary,
      castStatus: "Chờ thỏa thuận",
      experience: input.experience,
      trainingStatus: "Chưa training",
      notes: compactParagraphs(baseNotes),
      achievements: input.achievements,
      zaloStatus: "",
      liveAccountType: input.liveAccountPreference === "personal" ? "Cá nhân" : "Công ty",
      liveChannelId: ""
    };
  }

  return {
    id: employeeId,
    role: "support",
    name: input.fullName,
    level: "Mới ứng tuyển",
    phone: normalizePhone(input.phone),
    cvReference: input.cvUrl,
    cashOffer: input.expectedSalary,
    castStatus: "Chờ thỏa thuận",
    experience: input.experience,
    trainingStatus: "Chưa training",
    notes: compactParagraphs(baseNotes)
  };
}

export function buildAppsScriptApplicationPayload(input: ApplicationAutomationInput & {
  applicationId: string;
  submittedAt: string;
  employeeId: string;
}) {
  return {
    action: "submit_application",
    applicationId: input.applicationId,
    submittedAt: input.submittedAt,
    employeeId: input.employeeId,
    role: input.role,
    fullName: input.fullName,
    phone: normalizePhone(input.phone),
    email: input.email,
    cvUrl: input.cvUrl,
    experience: input.experience,
    achievements: input.achievements,
    expectedSalary: input.expectedSalary,
    liveLocationPreference: input.liveLocationPreference || "",
    liveAccountPreference: input.liveAccountPreference || "",
    introVideoUrl: input.introVideoUrl || "",
    tiktokUrl: input.tiktokUrl || "",
    notes: input.notes
  };
}
