export type EmployeeContractInput = {
  gmail?: unknown;
  dateOfBirth?: unknown;
  citizenId?: unknown;
  citizenIdIssuedDate?: unknown;
  citizenIdIssuedPlace?: unknown;
  permanentAddress?: unknown;
  temporaryAddress?: unknown;
  bankAccountNumber?: unknown;
  bankName?: unknown;
};

export type NormalizedEmployeeContractInput = {
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

type ContractDocuments = {
  citizenIdFront?: { publicId?: string } | null;
  citizenIdBack?: { publicId?: string } | null;
};

function requiredText(value: unknown, label: string, maxLength: number) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
  if (!normalized) throw new Error(`${label} không được để trống.`);
  return normalized;
}

function requiredMultilineText(value: unknown, label: string, maxLength: number) {
  const normalized = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join("\n")
    .slice(0, maxLength);
  if (!normalized) throw new Error(`${label} không được để trống.`);
  return normalized;
}

function requiredDate(value: unknown, label: string, today: Date) {
  const normalized = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) throw new Error(`${label} không hợp lệ.`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label} không hợp lệ.`);
  }

  const todayKey = [
    today.getUTCFullYear(),
    String(today.getUTCMonth() + 1).padStart(2, "0"),
    String(today.getUTCDate()).padStart(2, "0")
  ].join("-");
  if (normalized > todayKey) throw new Error(`${label} không được nằm trong tương lai.`);
  return normalized;
}

export function normalizeEmployeeContractInput(
  input: EmployeeContractInput,
  today = new Date()
): NormalizedEmployeeContractInput {
  const gmail = requiredText(input.gmail, "Gmail", 180).toLowerCase();
  if (!/^[^\s@]+@gmail\.com$/i.test(gmail)) {
    throw new Error("Gmail phải là địa chỉ @gmail.com hợp lệ.");
  }

  const citizenId = String(input.citizenId ?? "").replace(/\s+/g, "");
  if (!/^\d{12}$/.test(citizenId)) throw new Error("CCCD phải gồm đúng 12 chữ số.");

  const bankAccountNumber = String(input.bankAccountNumber ?? "").replace(/\s+/g, "");
  if (!/^\d{6,30}$/.test(bankAccountNumber)) {
    throw new Error("Số tài khoản phải gồm từ 6 đến 30 chữ số.");
  }

  return {
    gmail,
    dateOfBirth: requiredDate(input.dateOfBirth, "Ngày sinh", today),
    citizenId,
    citizenIdIssuedDate: requiredDate(input.citizenIdIssuedDate, "Ngày cấp", today),
    citizenIdIssuedPlace: requiredText(input.citizenIdIssuedPlace, "Nơi cấp", 240),
    permanentAddress: requiredMultilineText(input.permanentAddress, "Địa chỉ thường trú", 1000),
    temporaryAddress: requiredMultilineText(input.temporaryAddress, "Địa chỉ tạm trú", 1000),
    bankAccountNumber,
    bankName: requiredText(input.bankName, "Ngân hàng", 120)
  };
}

export function isEmployeeContractComplete(documents: ContractDocuments) {
  return Boolean(documents.citizenIdFront?.publicId && documents.citizenIdBack?.publicId);
}
