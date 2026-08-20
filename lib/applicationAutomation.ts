import type { EmployeeRole } from "@/lib/types";
import type { SchedulePersonMutation } from "@/lib/employeeRoster";

export type ApplicationAutomationInput = {
  applicationId?: string;
  submittedAt?: string;
  role: EmployeeRole;
  fullName: string;
  aliasName?: string;
  phone: string;
  email: string;
  cvUrl: string;
  experience: string;
  achievements: string;
  expectedSalary: string;
  canLiveHome?: boolean;
  canLiveStudio?: boolean;
  canUsePersonalAccount?: boolean;
  canUseCompanyAccount?: boolean;
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
    input.aliasName && input.aliasName !== input.fullName ? `Tên gọi khác: ${input.aliasName}` : "",
    input.email ? `Email: ${input.email}` : "",
    input.introVideoUrl ? `Video: ${input.introVideoUrl}` : "",
    input.tiktokUrl ? `TikTok: ${input.tiktokUrl}` : "",
    input.expectedSalary ? `Mức ứng viên đề xuất: ${input.expectedSalary}` : "",
    input.notes ? `Ghi chú: ${input.notes}` : ""
  ];

  if (input.role === "host") {
    const canLiveHome = input.canLiveHome ?? input.liveLocationPreference === "home";
    const canLiveStudio = input.canLiveStudio ?? input.liveLocationPreference === "studio";
    const workLocation = canLiveHome && canLiveStudio ? "both" : canLiveStudio ? "studio" : "home";
    const canUsePersonalAccount = input.canUsePersonalAccount ?? input.liveAccountPreference === "personal";
    const canUseCompanyAccount = input.canUseCompanyAccount ?? input.liveAccountPreference === "company";
    const liveAccountType = canUsePersonalAccount && canUseCompanyAccount
      ? "Cá nhân + Công ty"
      : canUsePersonalAccount
        ? "Cá nhân"
        : "Công ty";
    return {
      id: employeeId,
      role: "host",
      name: input.fullName,
      rating: "Thử việc",
      level: "Thử việc",
      workLocation,
      phone: normalizePhone(input.phone),
      cvReference: input.cvUrl,
      experience: input.experience,
      trainingStatus: "Chưa training",
      notes: compactParagraphs(baseNotes),
      achievements: input.achievements,
      zaloStatus: "",
      liveAccountType,
      liveChannelId: ""
    };
  }

  return {
    id: employeeId,
    role: "support",
    name: input.fullName,
    rating: "D",
    level: "Cấp 1",
    phone: normalizePhone(input.phone),
    cvReference: input.cvUrl,
    experience: input.experience,
    trainingStatus: "Chưa training",
    notes: compactParagraphs(baseNotes)
  };
}

