import { fetchSchedulePeople } from "@/lib/googleSchedule";
import type { EmployeeRole, SchedulePerson } from "@/lib/types";

export async function findSchedulePerson(role: EmployeeRole, employeeId: string): Promise<SchedulePerson | null> {
  const payload = await fetchSchedulePeople();
  const people = role === "host" ? payload.hosts || [] : payload.supports || [];
  const normalizedId = employeeId.trim().toLowerCase();
  return people.find((person) => person.id.toLowerCase() === normalizedId) || null;
}
