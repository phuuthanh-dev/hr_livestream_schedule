import type { PayrollEntry, PayrollPersonHours } from "@/lib/types";

export function buildPayrollPersonHours(entries: PayrollEntry[], taxRate: number): PayrollPersonHours[] {
  const grouped = new Map<string, PayrollPersonHours>();

  entries.forEach((entry) => {
    const key = `${entry.role}:${entry.employeeId.toLowerCase()}`;
    const current = grouped.get(key) || {
      employeeId: entry.employeeId,
      employeeName: entry.employeeName,
      role: entry.role,
      grade: entry.grade,
      sessionCount: 0,
      scheduledHours: 0,
      basePay: 0,
      commissionPay: 0,
      adjustments: 0,
      grossPay: 0,
      taxAmount: 0,
      netPay: 0
    };

    current.employeeName = current.employeeName || entry.employeeName;
    current.grade = current.grade || entry.grade;
    current.sessionCount += entry.sessionIds.length;
    current.scheduledHours += entry.scheduledHours;
    current.basePay += entry.basePay;
    current.commissionPay += entry.commissionPay;
    current.adjustments += entry.adjustments;
    current.grossPay += entry.grossPay;
    grouped.set(key, current);
  });

  const result = Array.from(grouped.values()).map((person) => {
    const taxablePay = person.basePay + person.adjustments;
    const effectiveTax = person.role === "host" ? Math.round(taxablePay * taxRate) : 0;
    person.taxAmount = effectiveTax;
    person.netPay = taxablePay - effectiveTax;
    return person;
  });

  return result.sort((left, right) =>
    right.scheduledHours - left.scheduledHours
    || left.employeeName.localeCompare(right.employeeName, "vi")
  );
}
