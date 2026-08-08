import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { getDashboardSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getDashboardSession();

  if (session) {
    redirect("/");
  }

  return (
    <main className="loginShell">
      <section className="loginCard">
        <p className="eyebrow">Live Streaming Schedule</p>
        <p className="loginIntro">
          Nhân viên đăng nhập theo mã Host hoặc Support Live để xem và xác nhận đúng ca được phân công.
        </p>
        <LoginForm />
      </section>
      <aside className="loginAside" aria-label="Calendar preview">
        <div className="orbit orbitOne" />
        <div className="orbit orbitTwo" />
        <div className="previewCalendar">
          <span>Mon</span>
          <span>Tue</span>
          <span className="hot">Wed</span>
          <span>Thu</span>
          <span>Fri</span>
          <strong>Studio warning</strong>
          <strong>Support-only</strong>
          <strong>Confirmed</strong>
        </div>
      </aside>
    </main>
  );
}
