import type { EmployeeRole } from "@/lib/types";

type CompensationInput = {
  rating?: unknown;
  level?: unknown;
  cashOffer?: unknown;
};

export type EmployeeCompensationProfile = {
  rating?: string;
  level?: string;
  cashOffer?: string;
};

type SupportRating = "A" | "B" | "C" | "D";
type SupportLevel = "Cấp 1" | "Cấp 2" | "Cấp 3" | "Cấp 4";
type HostGrade = "Thử việc" | "C" | "B" | "A" | "S";

const SUPPORT_BY_RATING: Record<SupportRating, { level: SupportLevel; cashOffer: string }> = {
  A: { level: "Cấp 4", cashOffer: "120.000" },
  B: { level: "Cấp 3", cashOffer: "70.000" },
  C: { level: "Cấp 2", cashOffer: "50.000" },
  D: { level: "Cấp 1", cashOffer: "30.000" }
};

const SUPPORT_RATING_BY_LEVEL: Record<SupportLevel, SupportRating> = {
  "Cấp 1": "D",
  "Cấp 2": "C",
  "Cấp 3": "B",
  "Cấp 4": "A"
};

const HOST_CASH_OFFER_BY_GRADE: Record<HostGrade, string> = {
  "Thử việc": "70.000 + 5% GMV",
  C: "100.000 + 7% GMV",
  B: "120.000 + 12% GMV",
  A: "200.000 + commission theo bậc GMV",
  S: "500.000 + commission theo bậc GMV"
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeSignal(value: unknown) {
  return normalizeText(value)
    .toLocaleLowerCase("vi")
    .replace(/[đĐ]/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeSupportRating(value: unknown): SupportRating | undefined {
  const signal = normalizeSignal(value);
  if (/^a(?:\s|$)/.test(signal)) return "A";
  if (/^b(?:\s|$)/.test(signal)) return "B";
  if (/^c(?:\s|$)/.test(signal)) return "C";
  if (/^d(?:\s|$)/.test(signal)) return "D";
  return undefined;
}

function normalizeSupportLevel(value: unknown): SupportLevel | undefined {
  const level = normalizeSignal(value).match(/(\d+)/)?.[1];
  if (level === "1") return "Cấp 1";
  if (level === "2") return "Cấp 2";
  if (level === "3") return "Cấp 3";
  if (level === "4") return "Cấp 4";
  return undefined;
}

function normalizeHostGrade(value: unknown): HostGrade | undefined {
  const signal = normalizeSignal(value);
  if (!signal) return undefined;
  if (signal.includes("thu viec") || signal.includes("trial") || signal.includes("trainee")) return "Thử việc";
  if (/^s(?:\s|$)/.test(signal)) return "S";
  if (/^a(?:\s|$)/.test(signal)) return "A";
  if (/^b(?:\s|$)/.test(signal)) return "B";
  if (/^c(?:\s|$)/.test(signal)) return "C";
  return undefined;
}

function fallbackCashOffer(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function deriveSupportCompensation(input: CompensationInput): EmployeeCompensationProfile {
  const normalizedLevel = normalizeSupportLevel(input.level);
  const rating = normalizeSupportRating(input.rating) || (normalizedLevel ? SUPPORT_RATING_BY_LEVEL[normalizedLevel] : undefined);
  const level = rating ? SUPPORT_BY_RATING[rating].level : normalizedLevel;
  const explicitCashOffer = fallbackCashOffer(input.cashOffer);
  const cashOffer = explicitCashOffer || (rating ? SUPPORT_BY_RATING[rating].cashOffer : undefined);
  return { rating, level, cashOffer };
}

function deriveHostCompensation(input: CompensationInput): EmployeeCompensationProfile {
  const grade = normalizeHostGrade(input.rating) || normalizeHostGrade(input.level);
  const cashOffer = grade ? HOST_CASH_OFFER_BY_GRADE[grade] : fallbackCashOffer(input.cashOffer);
  return {
    rating: grade,
    level: grade,
    cashOffer
  };
}

export function resolveEmployeeCompensation(role: EmployeeRole, input: CompensationInput): EmployeeCompensationProfile {
  return role === "support" ? deriveSupportCompensation(input) : deriveHostCompensation(input);
}
