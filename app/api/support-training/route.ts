import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import {
  canAccessSupportTraining,
  createEmptySupportTrainingProfile,
  getSupportTrainingProfile,
  saveSupportTrainingProfile,
  SUPPORT_TRAINING_CHECKLIST
} from "@/lib/supportTraining";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Bạn cần đăng nhập." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employeeId")?.trim()
    || (session.accountType === "employee" && session.role === "support" ? session.employeeId : "");
  if (!employeeId) {
    return NextResponse.json({ success: false, message: "Thiếu mã nhân viên support." }, { status: 400 });
  }
  if (!canAccessSupportTraining(session, employeeId)) {
    return NextResponse.json({ success: false, message: "Bạn không có quyền xem checklist này." }, { status: 403 });
  }

  try {
    const profile = await getSupportTrainingProfile(employeeId)
      || createEmptySupportTrainingProfile(employeeId, searchParams.get("employeeName")?.trim() || employeeId);
    return NextResponse.json({
      success: true,
      checklist: SUPPORT_TRAINING_CHECKLIST,
      profile
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không tải được checklist training." },
      { status: 400 }
    );
  }
}

export async function PUT(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Bạn cần đăng nhập." }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      employeeId?: string;
      entries?: unknown;
      answers?: unknown;
      meta?: unknown;
      feedback?: unknown;
      notes?: unknown;
    };
    const employeeId = body.employeeId?.trim()
      || (session.accountType === "employee" && session.role === "support" ? session.employeeId : "");
    if (!employeeId) {
      return NextResponse.json({ success: false, message: "Thiếu mã nhân viên support." }, { status: 400 });
    }
    if (!canAccessSupportTraining(session, employeeId)) {
      return NextResponse.json({ success: false, message: "Bạn không có quyền cập nhật checklist này." }, { status: 403 });
    }

    const profile = await saveSupportTrainingProfile({
      employeeId,
      entries: body.entries,
      answers: body.answers,
      meta: body.meta,
      feedback: body.feedback,
      notes: body.notes,
      actorAccountKey: session.accountKey
    });
    return NextResponse.json({
      success: true,
      profile,
      checklist: SUPPORT_TRAINING_CHECKLIST,
      message: `Đã lưu đánh giá training. ${profile.evaluation.classification} · Rating ${profile.evaluation.rating} · Cash Offer ${profile.evaluation.cashOffer}.`
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không lưu được checklist training." },
      { status: 400 }
    );
  }
}
