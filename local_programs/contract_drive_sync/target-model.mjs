function cleanText(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

export function normalizeEmployeeId(value) {
  return cleanText(value).toLowerCase();
}

export function normalizePhone(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  if (raw.startsWith("+")) return `+${raw.slice(1).replace(/\D/g, "")}`;
  return raw.replace(/\D/g, "");
}

function toMillis(value) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function maxTimestamp(values) {
  const best = values.reduce((latest, current) => {
    const currentMs = toMillis(current);
    return currentMs > latest ? currentMs : latest;
  }, 0);
  return best > 0 ? new Date(best).toISOString() : "";
}

function preferText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function buildTargetKey(parts) {
  return preferText(...parts) || "unknown";
}

export function isHttpUrl(value) {
  try {
    const url = new URL(cleanText(value));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function deriveCvReference(target) {
  return preferText(target?.recruitment?.cvUrl, target?.application?.cvUrl, target?.person?.cvReference);
}

export function buildSyncStamp(target) {
  return maxTimestamp([
    target?.person?.updatedAt,
    target?.person?.lastSeenAt,
    target?.contract?.updatedAt,
    target?.contract?.submittedAt,
    target?.recruitment?.updatedAt,
    target?.application?.updatedAt,
    target?.application?.submittedAt,
    target?.supportTraining?.updatedAt,
    target?.supportTraining?.completedAt
  ]);
}

function ensureTarget(map, key) {
  if (!map.has(key)) {
    map.set(key, {
      key,
      employeeId: "",
      role: "",
      employeeName: "",
        phone: "",
        person: null,
        contract: null,
        recruitment: null,
        application: null,
        supportTraining: null,
        updatedAt: ""
      });
  }
  return map.get(key);
}

export function buildSyncTargets({
  people = [],
  contracts = [],
  recruitmentProfiles = [],
  applications = [],
  supportTrainingProfiles = [],
  employeeId = ""
} = {}) {
  const normalizedFilter = normalizeEmployeeId(employeeId);
  const targets = new Map();
  const personKeyByPhoneRole = new Map();

  for (const person of people) {
    const key = buildTargetKey([
      normalizeEmployeeId(person.employeeId),
      `${cleanText(person.role)}:${normalizePhone(person.phone)}`
    ]);
    const target = ensureTarget(targets, key);
    target.person = person;
    target.employeeId = preferText(target.employeeId, person.employeeId);
    target.role = preferText(target.role, person.role);
    target.employeeName = preferText(target.employeeName, person.name, person.employeeId);
    target.phone = preferText(target.phone, person.phone);
    if (target.phone && target.role) {
      personKeyByPhoneRole.set(`${target.role}:${normalizePhone(target.phone)}`, key);
    }
  }

  for (const contract of contracts) {
    const key = buildTargetKey([
      normalizeEmployeeId(contract.employeeId),
      cleanText(contract.personKey)
    ]);
    const target = ensureTarget(targets, key);
    target.contract = contract;
    target.employeeId = preferText(target.employeeId, contract.employeeId);
    target.role = preferText(target.role, contract.role);
    target.employeeName = preferText(target.employeeName, contract.employeeName, contract.employeeId);
  }

  for (const recruitment of recruitmentProfiles) {
    const key = buildTargetKey([
      normalizeEmployeeId(recruitment.employeeId),
      `${cleanText(recruitment.role)}:${normalizePhone(recruitment.phone)}`,
      cleanText(recruitment.personKey)
    ]);
    const target = ensureTarget(targets, key);
    target.recruitment = recruitment;
    target.employeeId = preferText(target.employeeId, recruitment.employeeId);
    target.role = preferText(target.role, recruitment.role);
    target.employeeName = preferText(target.employeeName, recruitment.aliasName, recruitment.fullName, recruitment.employeeId);
    target.phone = preferText(target.phone, recruitment.phone);
    if (target.phone && target.role) {
      personKeyByPhoneRole.set(`${target.role}:${normalizePhone(target.phone)}`, key);
    }
  }

  for (const application of applications) {
    const phoneRoleKey = `${cleanText(application.role)}:${normalizePhone(application.phone || application.normalizedPhone)}`;
    const key = buildTargetKey([
      normalizeEmployeeId(application.employeeId),
      personKeyByPhoneRole.get(phoneRoleKey),
      `application:${cleanText(application.applicationId) || phoneRoleKey}`
    ]);
    const target = ensureTarget(targets, key);
    target.application = application;
    target.employeeId = preferText(target.employeeId, application.employeeId);
    target.role = preferText(target.role, application.role);
    target.employeeName = preferText(target.employeeName, application.fullName, application.employeeId);
    target.phone = preferText(target.phone, application.phone, application.normalizedPhone);
  }

  for (const supportTraining of supportTrainingProfiles) {
    const key = buildTargetKey([
      normalizeEmployeeId(supportTraining.employeeId),
      cleanText(supportTraining.personKey)
    ]);
    const target = ensureTarget(targets, key);
    target.supportTraining = supportTraining;
    target.employeeId = preferText(target.employeeId, supportTraining.employeeId);
    target.role = preferText(target.role, "support");
    target.employeeName = preferText(target.employeeName, supportTraining.employeeName, supportTraining.employeeId);
  }

  const rows = Array.from(targets.values())
    .map((target) => ({
      ...target,
      employeeId: preferText(target.employeeId),
      role: preferText(target.role),
      employeeName: preferText(target.employeeName, target.employeeId),
      phone: preferText(target.phone),
      updatedAt: buildSyncStamp(target)
    }))
    .filter((target) => {
      if (!normalizedFilter) return true;
      return normalizeEmployeeId(target.employeeId) === normalizedFilter;
    })
    .sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) return left.updatedAt.localeCompare(right.updatedAt);
      return `${left.employeeId}:${left.role}:${left.employeeName}`.localeCompare(
        `${right.employeeId}:${right.role}:${right.employeeName}`,
        "vi"
      );
    });

  return rows;
}
