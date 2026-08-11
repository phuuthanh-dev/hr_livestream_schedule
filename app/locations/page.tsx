import { redirect } from "next/navigation";
import LocationAdmin from "@/components/LocationAdmin";
import { getDashboardSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  const session = await getDashboardSession();
  if (!session) redirect("/login");
  if (session.accountType !== "admin") redirect("/availability");
  return <LocationAdmin username={session.displayName} />;
}
