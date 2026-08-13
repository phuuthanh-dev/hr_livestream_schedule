import type { DashboardSession } from "@/lib/auth";
import { findActiveSchedulePerson, findSchedulePerson } from "@/lib/employeeRoster";
import type { EmployeeRole } from "@/lib/types";

function readRole(value: unknown): EmployeeRole | null {
  return value === "host" || value === "support" ? value : null;
}

export async function resolveEmployeeContractPerson(input: {
  session: DashboardSession;
  role?: unknown;
  employeeId?: unknown;
}) {
  if (input.session.accountType === "employee") {
    if (!input.session.role || !input.session.employeeId) return null;
    return findActiveSchedulePerson(input.session.role, input.session.employeeId);
  }

  const role = readRole(input.role);
  const employeeId = String(input.employeeId ?? "").trim();
  if (!role || !employeeId) return null;
  return findSchedulePerson(role, employeeId);
}
