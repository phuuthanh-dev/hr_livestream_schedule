import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import {
  listPeopleApplications,
  submitPeopleApplication,
  type PeopleApplicationInput
} from "@/lib/peopleApplication";

export const runtime = "nodejs";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_SUBMISSIONS = 5;

type SubmissionBucket = { count: number; resetAt: number };

declare global {
  var __hrStreamingApplicationBuckets: Map<string, SubmissionBucket> | undefined;
}

function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

function consumeSubmissionAttempt(key: string) {
  const buckets = globalThis.__hrStreamingApplicationBuckets
    || (globalThis.__hrStreamingApplicationBuckets = new Map());
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (bucket.count >= MAX_SUBMISSIONS) return false;
  bucket.count += 1;
  return true;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PeopleApplicationInput & { website?: string };
    if (body.website) return NextResponse.json({ success: true, message: "Đã tiếp nhận hồ sơ." });
    if (!consumeSubmissionAttempt(clientIp(request))) {
      return NextResponse.json(
        { success: false, message: "Bạn đã gửi quá nhiều lần. Vui lòng thử lại sau." },
        { status: 429 }
      );
    }

    const result = await submitPeopleApplication(body);
    return NextResponse.json({
      success: true,
      applicationId: result.application.applicationId,
      message: result.updated
        ? "Hồ sơ trước đó đã được cập nhật bằng thông tin mới nhất."
        : "Hồ sơ đã được gửi thành công. Đội ngũ tuyển dụng sẽ liên hệ với bạn."
    }, { status: result.updated ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không gửi được hồ sơ.";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}

export async function GET() {
  const session = await getDashboardSession();
  if (!session || session.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ Admin được xem hồ sơ ứng tuyển." }, { status: 403 });
  }

  try {
    const applications = await listPeopleApplications();
    return NextResponse.json({ success: true, applications, total: applications.length });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không tải được hồ sơ ứng tuyển." },
      { status: 503 }
    );
  }
}
