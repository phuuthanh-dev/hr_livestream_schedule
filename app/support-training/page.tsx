import { redirect } from "next/navigation";
import SupportTrainingForm from "@/components/SupportTrainingForm";
import { getDashboardSession } from "@/lib/auth";

export default async function SupportTrainingPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getDashboardSession();
  if (!session) redirect("/login");

  const query = await searchParams;
  const employeeId = typeof query.employeeId === "string" && query.employeeId.trim()
    ? query.employeeId.trim()
    : session.accountType === "employee" && session.role === "support" && session.employeeId
      ? session.employeeId
      : "";

  if (!employeeId) {
    if (session.accountType === "admin") redirect("/employees");
    redirect("/");
  }

  if (session.accountType === "employee" && (session.role !== "support" || session.employeeId !== employeeId)) {
    redirect("/");
  }

  const employeeName = typeof query.employeeName === "string" && query.employeeName.trim()
    ? query.employeeName.trim()
    : session.displayName;

  return (
    <SupportTrainingForm
      employeeId={employeeId}
      employeeName={employeeName}
      isAdmin={session.accountType === "admin"}
    />
  );
}
