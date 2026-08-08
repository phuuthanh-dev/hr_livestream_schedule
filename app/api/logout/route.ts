import { NextResponse } from "next/server";
import { clearDashboardSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  await clearDashboardSession();
  return NextResponse.json({ success: true });
}
