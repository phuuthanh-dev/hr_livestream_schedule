import ScheduleDashboard from "@/components/ScheduleDashboard";
import { getDashboardSession } from "@/lib/auth";
import { getScheduleWeekStartKey, isValidScheduleDateKey } from "@/lib/scheduleDate";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams: Promise<{ weekStartKey?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const session = await getDashboardSession();
  if (!session) {
    return (
      <main className="marketingPage">
        <header className="marketingHeader">
          <div className="marketingBrand">
            <img alt="" src="/rr-logo-submark-square.png" />
            <span>
              <small>ROOT ROTATION</small>
              <strong>Hệ thống vận hành Livestream</strong>
            </span>
          </div>
          <nav className="marketingNav">
            <a href="#modules">Phân hệ</a>
            <a href="#workflow">Quy trình</a>
            <a href="#integration">Đồng bộ báo cáo</a>
          </nav>
          <div className="marketingHeaderActions">
            <a className="marketingGhostButton" href="/apply">Ứng tuyển</a>
            <a className="marketingPrimaryButton" href="/login">Đăng nhập quản trị</a>
          </div>
        </header>

        <section className="marketingHero">
          <div className="marketingHeroCopy">
            <span className="marketingEyebrow">WEBSITE DOANH NGHIỆP · PHẦN MỀM NỘI BỘ</span>
            <h1>Phần mềm nội bộ cho vận hành nhân sự livestream.</h1>
            <p>
              Root Rotation sử dụng hệ thống này để quản lý tiếp nhận ứng viên, hồ sơ nhân sự, đào tạo support,
              xếp lịch, hoàn thiện hợp đồng, đồng bộ báo cáo livestream và tính lương cho đội ngũ vận hành livestream.
            </p>
            <div className="marketingHeroActions">
              <a className="marketingPrimaryButton" href="/login">Vào hệ thống</a>
              <a className="marketingGhostButton" href="#workflow">Xem quy trình</a>
            </div>
          </div>
          <div className="marketingHeroPanel">
            <article>
              <span>Mục đích sử dụng</span>
              <strong>Nhân sự và vận hành livestream</strong>
              <small>Đây không phải trang bán hàng. Đây là phần mềm phục vụ vận hành nội bộ.</small>
            </article>
            <article>
              <span>Kết quả chính</span>
              <strong>Xếp lịch + tính lương</strong>
              <small>Ca làm đã xác nhận sẽ được đối soát với báo cáo livestream để tính lương.</small>
            </article>
            <article>
              <span>Luồng dữ liệu</span>
              <strong>Từ ứng tuyển đến thanh toán</strong>
              <small>Ứng tuyển, đào tạo, phân ca, đồng bộ báo cáo và chốt lương tuần trong một hệ thống.</small>
            </article>
          </div>
        </section>

        <section className="marketingSection" id="modules">
          <div className="marketingSectionHeading">
            <span className="marketingEyebrow">PHÂN HỆ</span>
            <h2>Những gì hệ thống đang quản lý</h2>
          </div>
          <div className="marketingModuleGrid">
            <article><strong>Tiếp nhận ứng viên</strong><p>Ứng viên gửi hồ sơ host hoặc support qua website. Hệ thống tự động tạo mới hoặc cập nhật hồ sơ nhân sự.</p></article>
            <article><strong>Hồ sơ nhân sự</strong><p>HR quản lý nhân sự host và support, thông tin hợp đồng, trạng thái vận hành và giấy tờ định danh nội bộ.</p></article>
            <article><strong>Đào tạo support</strong><p>Nhân sự support hoàn thành checklist đào tạo theo SOP để sinh rating, level và cash offer.</p></article>
            <article><strong>Xếp lịch</strong><p>Khai báo lịch rảnh, tạo lịch làm, theo dõi phân ca và xác nhận ca được xử lý trực tiếp trong hệ thống.</p></article>
            <article><strong>Đồng bộ báo cáo livestream</strong><p>Các batch báo cáo livestream được đưa vào luồng payroll và chuẩn hóa để đối chiếu với ca đã xác nhận.</p></article>
            <article><strong>Tính lương</strong><p>Hệ thống tính lương từ ca làm đã xác nhận và dữ liệu báo cáo livestream, đồng thời đánh dấu các trường hợp lệch dữ liệu.</p></article>
          </div>
        </section>

        <section className="marketingSection" id="workflow">
          <div className="marketingSectionHeading">
            <span className="marketingEyebrow">QUY TRÌNH</span>
            <h2>Luồng vận hành bên trong hệ thống</h2>
          </div>
          <div className="marketingFlow">
            <article><b>1</b><strong>Ứng tuyển</strong><p>Website tiếp nhận hồ sơ và tạo dữ liệu nhân sự có cấu trúc cho host và support.</p></article>
            <article><b>2</b><strong>Đào tạo và hợp đồng</strong><p>Checklist SOP cho support, hồ sơ hợp đồng và thông tin nhân sự được lưu trong cùng một hệ thống nội bộ.</p></article>
            <article><b>3</b><strong>Xếp lịch</strong><p>Nhân sự gửi lịch rảnh, quản trị tạo hoặc rà soát lịch làm.</p></article>
            <article><b>4</b><strong>Đồng bộ báo cáo livestream</strong><p>Dữ liệu báo cáo được đưa vào luồng payroll để đối soát với các ca đã xác nhận.</p></article>
            <article><b>5</b><strong>Tính lương</strong><p>Hệ thống tính lương theo tuần và làm nổi bật các ngoại lệ cần quản trị kiểm tra.</p></article>
          </div>
        </section>

        <section className="marketingSection marketingIntegrationSection" id="integration">
          <div className="marketingSectionHeading">
            <span className="marketingEyebrow">ĐỒNG BỘ BÁO CÁO</span>
            <h2>Đồng bộ báo cáo livestream là một phần của vận hành payroll</h2>
          </div>
          <div className="marketingIntegrationCard">
            <div>
              <strong>Kết nối báo cáo livestream</strong>
              <p>Phân hệ payroll nhận các batch báo cáo livestream, chuẩn hóa dữ liệu và đối chiếu với ca làm đã xác nhận trước khi tính lương.</p>
            </div>
            <ul>
              <li>Đầu vào: batch báo cáo livestream</li>
              <li>Xử lý: đối chiếu session và phát hiện ngoại lệ</li>
              <li>Đầu ra: dòng lương, danh sách ngoại lệ và bảng lương tuần có thể xuất file</li>
            </ul>
          </div>
        </section>
      </main>
    );
  }

  const query = await searchParams;
  const initialWeekStartKey = query.weekStartKey && isValidScheduleDateKey(query.weekStartKey)
    ? getScheduleWeekStartKey(query.weekStartKey)
    : undefined;

  return (
    <ScheduleDashboard
      username={session.displayName}
      isAdmin={session.accountType === "admin"}
      employeeRole={session.role}
      employeeId={session.employeeId}
      initialWeekStartKey={initialWeekStartKey}
    />
  );
}
