import { redirect } from "next/navigation";
import AvailabilityBoard from "@/components/AvailabilityBoard";
import { getDashboardSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AvailabilityPage() {
  const session = await getDashboardSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <AvailabilityBoard
      username={session.displayName}
      isAdmin={session.accountType === "admin"}
      employeeRole={session.role}
      employeeId={session.employeeId}
    />
  );
}
