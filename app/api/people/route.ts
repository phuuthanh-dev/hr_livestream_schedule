import { NextResponse } from "next/server";
import { getSchedulePeopleFromMongo } from "@/lib/employeeRoster";

export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await getSchedulePeopleFromMongo();
    const toPublicPerson = (person: NonNullable<typeof payload.hosts>[number]) => ({
      id: person.id,
      name: person.name,
      role: person.role,
      workLocation: person.workLocation
    });
    return NextResponse.json({
      success: payload.success,
      hosts: (payload.hosts || []).map(toPublicPerson),
      supports: (payload.supports || []).map(toPublicPerson),
      message: payload.message
    }, {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không tải được danh sách nhân viên." },
      { status: 503 }
    );
  }
}
