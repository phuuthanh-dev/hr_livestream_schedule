import { redirect } from "next/navigation";
import PayrollDashboard from "@/components/PayrollDashboard";
import { getDashboardSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

type PayrollPageProps = {
  searchParams: Promise<{ weekStartKey?: string }>;
};

export default async function PayrollPage({ searchParams }: PayrollPageProps) {
  const session = await getDashboardSession();
  if (!session) redirect("/login");
  if (session.accountType !== "admin") redirect("/");
  const query = await searchParams;
  return <PayrollDashboard username={session.displayName} initialWeekStartKey={query.weekStartKey} />;
}
