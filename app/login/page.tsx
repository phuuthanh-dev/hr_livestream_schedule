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
    <main className="loginExperience">
      <section className="loginStory">
        <div className="loginBrand"><img alt="" src="/rr-logo-submark-square.png" /><span>ROOT ROTATION</span></div>
        <div className="loginStoryCopy">
          <p><i /> LIVE OPERATIONS</p>
          <h1>Mỗi phiên live.<br /><em>Đúng người, đúng nhịp.</em></h1>
          <span>Lịch làm việc, địa điểm và xác nhận ca được kết nối trong một không gian duy nhất.</span>
        </div>
        <div className="loginSignalBoard" aria-hidden="true">
          <div className="signalHeader"><span>LIVE CONTROL</span><strong><i /> ON AIR</strong></div>
          <div className="signalTimeline"><i /><i /><i /><i /><i /><i /></div>
          <div className="signalCards">
            <article><span>08:00</span><strong>Studio</strong><em>Host + Support</em></article>
            <article><span>10:00</span><strong>Home</strong><em>Host confirmed</em></article>
            <article><span>14:00</span><strong>Studio</strong><em>Ready to live</em></article>
          </div>
        </div>
        <p className="loginStoryFooter">Một hệ thống vận hành dành cho đội ngũ livestream.</p>
      </section>

      <section className="loginAccessPanel">
        <div className="loginAccessInner">
          <div className="loginAccessHeading">
            <p>CHÀO MỪNG TRỞ LẠI</p>
            <h2>Đăng nhập hệ thống</h2>
            <span>Chọn đúng vai trò và tài khoản của bạn để tiếp tục.</span>
          </div>
          <LoginForm />
          <div className="loginApplyPrompt">
            <span>Bạn muốn gia nhập đội ngũ?</span>
            <a href="/apply">Ứng tuyển Host / Support <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></a>
          </div>
        </div>
        <p className="loginLegal">Root Rotation · Livestream Operations</p>
      </section>
    </main>
  );
}
