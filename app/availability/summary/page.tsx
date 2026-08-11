import { redirect } from "next/navigation";
import AvailabilityAdminDashboard from "@/components/AvailabilityAdminDashboard";
import { getDashboardSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

type AvailabilitySummaryPageProps = {
  searchParams: Promise<{
    role?: string;
    weekStartKey?: string;
  }>;
};

export default async function AvailabilitySummaryPage({ searchParams }: AvailabilitySummaryPageProps) {
  const session = await getDashboardSession();

  if (!session) {
    redirect("/login");
  }
  if (session.accountType !== "admin") {
    redirect("/availability");
  }

  const query = await searchParams;
  return (
    <AvailabilityAdminDashboard
      username={session.displayName}
      initialWeekStartKey={query.weekStartKey}
      initialRoleFilter={query.role === "host" || query.role === "support" ? query.role : undefined}
    />
  );
}
