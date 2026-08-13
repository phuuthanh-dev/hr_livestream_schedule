import { redirect } from "next/navigation";
import EmployeeContractForm from "@/components/EmployeeContractForm";
import { getDashboardSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

type ContractPageProps = {
  searchParams: Promise<{ role?: string; employeeId?: string }>;
};

export default async function ContractPage({ searchParams }: ContractPageProps) {
  const session = await getDashboardSession();
  if (!session) redirect("/login");

  const query = await searchParams;
  const targetRole = query.role === "host" || query.role === "support" ? query.role : undefined;
  const targetEmployeeId = query.employeeId?.trim();
  if (session.accountType === "admin" && (!targetRole || !targetEmployeeId)) redirect("/employees");

  return (
    <EmployeeContractForm
      isAdmin={session.accountType === "admin"}
      targetRole={targetRole}
      targetEmployeeId={targetEmployeeId}
      username={session.displayName}
    />
  );
}
