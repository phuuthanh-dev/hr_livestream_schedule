import type { Metadata } from "next";
import ApplicationForm from "@/components/ApplicationForm";

export const metadata: Metadata = {
  title: "Ứng tuyển Livestream | Root Rotation",
  description: "Gửi hồ sơ ứng tuyển Host Livestream hoặc Support Live."
};

export default function ApplyPage() {
  return (
    <main className="applicationPage">
      <aside className="applicationStory">
        <div className="applicationBrand"><img alt="" src="/rr-logo-submark-square.png" /><span>ROOT ROTATION</span></div>
        <div className="applicationStoryCopy">
          <p className="applicationKicker"><i /> CƠ HỘI NGHỀ NGHIỆP</p>
          <h1>Đưa năng lượng của bạn <em>lên sóng.</em></h1>
          <p>Chúng tôi tìm kiếm những người làm livestream có cá tính, kỷ luật và muốn phát triển lâu dài cùng một đội ngũ vận hành thực chiến.</p>
        </div>
        <div className="applicationRoleNotes">
          <article><strong>HOST</strong><span>Truyền tải câu chuyện, tạo kết nối và dẫn dắt chuyển đổi.</span></article>
          <article><strong>SUPPORT</strong><span>Giữ phiên live vận hành mượt mà từ hậu trường.</span></article>
        </div>
        <div className="applicationStoryFooter"><span>Không chỉ là một ca live.</span><strong>Đây là nơi bạn xây nghề.</strong></div>
      </aside>

      <section className="applicationFormShell">
        <header className="applicationTopbar">
          <a href="/login"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>Đăng nhập hệ thống</a>
          <span>Hồ sơ được bảo mật</span>
        </header>
        <ApplicationForm />
      </section>
    </main>
  );
}
