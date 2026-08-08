import { redirect } from "next/navigation";
import ScheduleDashboard from "@/components/ScheduleDashboard";
import { getDashboardSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getDashboardSession();

  if (!session) {
    redirect("/login");
  }

  return <ScheduleDashboard username={session.user} />;
}
