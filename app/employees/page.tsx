import { redirect } from "next/navigation";
import EmployeeAdmin from "@/components/EmployeeAdmin";
import { getDashboardSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  const session = await getDashboardSession();
  if (!session) redirect("/login");
  if (session.accountType !== "admin") redirect("/availability");
  return <EmployeeAdmin username={session.displayName} />;
}
