import { redirect } from "next/navigation";
import AvailabilityBoard from "@/components/AvailabilityBoard";
import { getDashboardSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

type AvailabilityPageProps = {
  searchParams: Promise<{
    role?: string;
    employeeId?: string;
    weekStartKey?: string;
  }>;
};

export default async function AvailabilityPage({ searchParams }: AvailabilityPageProps) {
  const session = await getDashboardSession();

  if (!session) {
    redirect("/login");
  }

  const query = await searchParams;
  if (session.accountType === "admin" && !query.employeeId?.trim()) {
    const params = new URLSearchParams();
    if (query.weekStartKey) params.set("weekStartKey", query.weekStartKey);
    if (query.role === "host" || query.role === "support") params.set("role", query.role);
    redirect(`/availability/summary${params.size ? `?${params.toString()}` : ""}`);
  }
  const initialAdminRole = session.accountType === "admin" && (query.role === "host" || query.role === "support")
    ? query.role
    : undefined;

  return (
    <AvailabilityBoard
      username={session.displayName}
      isAdmin={session.accountType === "admin"}
      employeeRole={session.role}
      employeeId={session.employeeId}
      initialWeekStartKey={query.weekStartKey}
      initialAdminRole={initialAdminRole}
      initialAdminEmployeeId={session.accountType === "admin" ? query.employeeId : undefined}
    />
  );
}
