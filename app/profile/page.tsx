import { redirect } from "next/navigation";
import EmployeeSelfProfile from "@/components/EmployeeSelfProfile";
import { getDashboardSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function EmployeeProfilePage() {
  const session = await getDashboardSession();
  if (!session) redirect("/login");
  if (session.accountType !== "employee" || !session.role || !session.employeeId) redirect("/employees");
  return <EmployeeSelfProfile username={session.displayName} />;
}
