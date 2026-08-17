import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { generateEmployeeContractGoogleDoc } from "@/lib/contractDocumentGeneration";
import { resolveEmployeeContractPerson } from "@/lib/employeeContractAccess";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session || session.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ Admin được tạo hợp đồng Google Doc." }, { status: 403 });
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const person = await resolveEmployeeContractPerson({
      session,
      role: body.role,
      employeeId: body.employeeId
    });
    if (!person) {
      return NextResponse.json({ success: false, message: "Không tìm thấy nhân viên để tạo hợp đồng." }, { status: 404 });
    }

    const result = await generateEmployeeContractGoogleDoc({
      role: person.role,
      employeeId: person.id,
      actorAccountKey: session.accountKey
    });

    return NextResponse.json({
      success: true,
      target: { role: person.role, employeeId: person.id, employeeName: person.name },
      profile: result.profile,
      document: {
        id: result.documentId,
        url: result.documentUrl,
        fileName: result.fileName
      },
      message: `Đã tạo hợp đồng Google Doc cho ${person.name}. Những field chưa có dữ liệu đang được điền tạm bằng "...".`
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "Không tạo được hợp đồng Google Doc."
    }, { status: 400 });
  }
}
