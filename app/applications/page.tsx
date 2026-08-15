import { redirect } from "next/navigation";
import RecruitmentAdmin from "@/components/RecruitmentAdmin";
import { getDashboardSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage() {
  const session = await getDashboardSession();
  if (!session) redirect("/login");
  if (session.accountType !== "admin") redirect("/availability");
  return <RecruitmentAdmin username={session.displayName} />;
}
