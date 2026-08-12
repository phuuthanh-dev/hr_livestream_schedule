import { redirect } from "next/navigation";
import ScheduleDashboard from "@/components/ScheduleDashboard";
import { getDashboardSession } from "@/lib/auth";
import { getScheduleWeekStartKey, isValidScheduleDateKey } from "@/lib/scheduleDate";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams: Promise<{ weekStartKey?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const session = await getDashboardSession();

  if (!session) {
    redirect("/login");
  }

  const query = await searchParams;
  const initialWeekStartKey = query.weekStartKey && isValidScheduleDateKey(query.weekStartKey)
    ? getScheduleWeekStartKey(query.weekStartKey)
    : undefined;

  return (
    <ScheduleDashboard
      username={session.displayName}
      isAdmin={session.accountType === "admin"}
      employeeRole={session.role}
      employeeId={session.employeeId}
      initialWeekStartKey={initialWeekStartKey}
    />
  );
}
