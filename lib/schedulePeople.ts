import { findActiveSchedulePerson } from "@/lib/employeeRoster";
import type { EmployeeRole, SchedulePerson } from "@/lib/types";

export async function findSchedulePerson(role: EmployeeRole, employeeId: string): Promise<SchedulePerson | null> {
  return findActiveSchedulePerson(role, employeeId);
}
