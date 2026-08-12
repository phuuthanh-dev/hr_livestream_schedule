import type { SchedulePerson } from "@/lib/types";

export const EMPLOYEE_MIGRATION_SOURCE = "HR_STREAMING_ MASTER FILE.xlsx · 11/08/2026";

export const EMPLOYEE_MIGRATION_SEED: SchedulePerson[] = [
  {
    id: "HRLT01", name: "Nguyễn Thị Thanh Thảo", role: "host", phone: "0333805063", cvReference: "CV",
    workLocation: "both", level: "B", zaloStatus: "Có", castStatus: "Đồng ý",
    cashOffer: "100.000 + 7% GMV", experience: "Có", liveAccountType: "Công ty",
    trainingStatus: "Rồi", liveChannelId: "ledanguyenlinh_", notes: "Giữ tài khoản: Le Dang Uyen Linh"
  },
  {
    id: "HRLT04", name: "Thanh Đạt", role: "host", phone: "0384019042", cvReference: "CV",
    workLocation: "studio", level: "B", zaloStatus: "Có", castStatus: "Đồng ý",
    cashOffer: "120.000 + 12% GMV", experience: "Có", achievements: "2-3tr",
    liveAccountType: "Công ty", trainingStatus: "Rồi", liveChannelId: "vuminhkhangg02"
  },
  {
    id: "HRLT05", name: "Taddie", role: "host", phone: "0919990069", cvReference: "Port",
    workLocation: "studio", level: "A", zaloStatus: "Có", castStatus: "Đồng ý",
    cashOffer: "200.000+ % GMV", experience: "Có", achievements: "từ 5-7tr",
    liveAccountType: "Công ty", trainingStatus: "Rồi", liveChannelId: "vuminhkhangg02"
  },
  {
    id: "HRLT06", name: "Thảo Ly", role: "host", phone: "0352885605", cvReference: "Video live",
    workLocation: "studio", level: "A", zaloStatus: "Có", castStatus: "Đồng ý",
    cashOffer: "200.000 + 18% GMV", experience: "Có", achievements: "0-7tr",
    liveAccountType: "Công ty", trainingStatus: "Rồi", liveChannelId: "vuminhkhangg02"
  },
  {
    id: "HRLT08", name: "Tuấn Duy", role: "host", phone: "0939556515", cvReference: "CV",
    workLocation: "studio", level: "Thử việc", zaloStatus: "Có", castStatus: "Đồng ý",
    cashOffer: "70.000 + 5% GMV", experience: "Không", achievements: "0.0",
    liveAccountType: "Công ty", trainingStatus: "Rồi", liveChannelId: "vuminhkhangg02"
  },
  {
    id: "HRLT11", name: "Mỹ Duyên", role: "host", phone: "0862044803", cvReference: "CV",
    workLocation: "studio", level: "C", zaloStatus: "Có", castStatus: "Đồng ý",
    cashOffer: "100.000 + 7% GMV", experience: "Có", achievements: "3-15tr",
    liveAccountType: "Công ty", trainingStatus: "Chưa", liveChannelId: "vuminhkhangg02"
  },
  {
    id: "HRLT12", name: "Vân Anh", role: "host", phone: "0937612272", cvReference: "CV",
    workLocation: "studio", level: "B", zaloStatus: "Có", castStatus: "Đồng ý",
    cashOffer: "120.000 + 12% GMV", experience: "Có", achievements: "3-10tr",
    liveAccountType: "Công ty", trainingStatus: "Chưa", liveChannelId: "vuminhkhangg02"
  },
  {
    id: "HRLT16", name: "Như Ngọc (Sannye)", role: "host", phone: "0583343649", cvReference: "CV",
    workLocation: "studio", level: "B", zaloStatus: "Có", castStatus: "Đồng ý",
    cashOffer: "100.000 + 7% GMV", experience: "Có", achievements: "2-3tr",
    liveAccountType: "Công ty", trainingStatus: "Rồi", liveChannelId: "vuminhkhangg02"
  },
  {
    id: "HRLT17", name: "Đông Bảo", role: "host", phone: "0869149719", cvReference: "CV",
    workLocation: "studio", level: "B", zaloStatus: "Có", castStatus: "Đồng ý",
    cashOffer: "100.000 + 7% GMV", experience: "Có", liveAccountType: "Công ty",
    trainingStatus: "Rồi", liveChannelId: "vuminhkhangg02"
  },
  {
    id: "HRLT18", name: "Hoàng Minh", role: "host", phone: "0777797332", cvReference: "CV",
    workLocation: "studio", level: "Thử việc", zaloStatus: "Có", castStatus: "Đồng ý",
    cashOffer: "70.000 + 5% GMV", experience: "Có", liveAccountType: "Công ty",
    trainingStatus: "Chưa", liveChannelId: "vuminhkhangg02"
  },
  {
    id: "HRLT19", name: "Nguyễn Hoàng Đại", role: "host", phone: "0366362393", cvReference: "CV",
    workLocation: "studio", level: "B", zaloStatus: "Có", castStatus: "Đồng ý",
    cashOffer: "120.000 + 12% GMV", experience: "Có", achievements: "3-8tr",
    liveAccountType: "Công ty", trainingStatus: "Rồi", liveChannelId: "vuminhkhangg02"
  },
  {
    id: "HRLT20", name: "Cao Nguyễn Thanh Thảo", role: "host", phone: "0907918553", cvReference: "CV",
    workLocation: "studio", level: "Thử việc", zaloStatus: "Có", castStatus: "Đồng ý",
    cashOffer: "70.000 + 5% GMV", experience: "Không", liveAccountType: "Công ty",
    trainingStatus: "Chưa", liveChannelId: "vuminhkhangg02", notes: "học việc"
  },
  {
    id: "HRLT21", name: "Nguyễn Huỳnh Ngọc Trân", role: "host", phone: "0798848108",
    workLocation: "studio", level: "Thử việc", zaloStatus: "Có", castStatus: "Đồng ý",
    cashOffer: "70.000 + 5% GMV", experience: "Không", liveAccountType: "Công ty",
    trainingStatus: "Chưa", liveChannelId: "vuminhkhangg02", notes: "học việc"
  },
  {
    id: "HRLT22", name: "Thanh Trúc", role: "host", workLocation: "studio", level: "Thử việc",
    zaloStatus: "Có", castStatus: "Đồng ý", cashOffer: "70.000 + 5% GMV", experience: "Có",
    liveAccountType: "Công ty", trainingStatus: "Chưa"
  },
  {
    id: "HRLT23", name: "Nguyễn Trần Tường Vi", role: "host", phone: "0783421607",
    workLocation: "studio", level: "Thử việc", zaloStatus: "Có", castStatus: "Đồng ý",
    cashOffer: "70.000 + 5% GMV", experience: "Có", liveAccountType: "Công ty", trainingStatus: "Chưa"
  },
  {
    id: "HRLT24", name: "Ngô Bùi Mai Vy", role: "host", phone: "0354604457",
    workLocation: "studio", level: "Thử việc", zaloStatus: "Có", castStatus: "Đồng ý",
    cashOffer: "80.000 + 5% GMV", experience: "Có", liveAccountType: "Công ty", trainingStatus: "Chưa"
  },
  {
    id: "HRSL01_6H", name: "Trần Công Hậu", role: "support", phone: "0332517003", level: "Cấp 1",
    cashOffer: "30.000", castStatus: "Đồng ý", experience: "Có", trainingStatus: "Đã Training",
    cvReference: "CV", notes: "Nền tảng Marketing tốt, cần đào tạo thêm về kỹ năng vận hành giỏ hàng & thiết bị Support"
  },
  {
    id: "HRSL02_6H", name: "Nguyễn Anh Huy", role: "support", phone: "0706614157", level: "Cấp 2",
    cashOffer: "45.000", castStatus: "Đồng ý", experience: "Có", trainingStatus: "Đã Training",
    cvReference: "CV", notes: "Thích hợp nhất cho live Thời trang: Hiểu sp, biết tư vấn chất liệu/form dáng, phối hợp tốt với Host."
  },
  {
    id: "HRSL05", name: "Hoàng Kỳ Anh", role: "support", phone: "0329496107", level: "Cấp 3",
    cashOffer: "70.000", castStatus: "Đồng ý", experience: "Có", trainingStatus: "Đã Training",
    cvReference: "CV", notes: "Toàn diện: Kinh nghiệm Brand lớn, thạo OBS cross sàn, biết makeup & Backup làm Host"
  },
  {
    id: "HRSL06", name: "Trần Thanh Huy", role: "support", phone: "0829049099", level: "Cấp 3",
    cashOffer: "70.000", castStatus: "Đồng ý", experience: "Có", trainingStatus: "Đã Training",
    cvReference: "CV", notes: "Chuyên nghiệp: Từng chạy cho các Brand lớn, thạo OBS, có thể Co-host/Live backup."
  },
  {
    id: "HRSL09", name: "Đỗ Chí Khâm", role: "support", phone: "0344289465", level: "Cấp 1",
    cashOffer: "30.000", castStatus: "Đồng ý", experience: "Không", trainingStatus: "Đã Training",
    cvReference: "CV", notes: "kinh nghiệm thực tập làm Content Marketing, nghiên cứu thị trường mỹ phẩm và tư vấn Zalo. Chưa có kinh nghiệm đứng live hoặc làm Support vận hành phòng live trực tiếp."
  },
  {
    id: "HRSL10", name: "Đoàn Phước Thiện", role: "support", phone: "0389400885", level: "Cấp 1",
    cashOffer: "30.000", castStatus: "Đồng ý", experience: "Không", trainingStatus: "Đã Training", cvReference: "CV"
  },
  {
    id: "HRSL11", name: "Trần Phan Trà My", role: "support", phone: "0974277400", level: "Cấp 1",
    cashOffer: "30.000", castStatus: "Đồng ý", experience: "Không", trainingStatus: "Đã Training",
    cvReference: "CV", notes: "Ứng viên có nền tảng tư vấn bán hàngOffline và biểu diễn xuất sắc, tuy nhiên chưa ghi nhận kinh nghiệm đứng live chính thức trên các nền tảng TMĐT (TikTok Shop, Shopee) cũng như chưa thể hiện kỹ năng thao tác thiết bị kỹ thuật (OBS, ghim giỏ hàng)."
  },
  {
    id: "HRSL12", name: "Trịnh Xuân Quỳnh", role: "support", phone: "0707816379", level: "Cấp 2",
    cashOffer: "45.000", castStatus: "Đồng ý", experience: "Có", trainingStatus: "Đã Training",
    cvReference: "CV", notes: "có 6 tháng kinh nghiệm Live (các ngành Mẹ & Bé, Mỹ phẩm, Gia dụng, Đồ điện tử) và 2 tháng kinh nghiệm Trợ live (biết dung OBS"
  },
  {
    id: "HRSL13", name: "Nguyễn Thị Huyền Trang", role: "support", phone: "0933475579", level: "Cấp 2",
    cashOffer: "35.000", castStatus: "Đồng ý", experience: "Không", trainingStatus: "Chưa Training", cvReference: "CV"
  },
  {
    id: "HRSL14", name: "Nguyễn Thị Bích Trâm", role: "support", phone: "0345478185", level: "Cấp 1",
    cashOffer: "40.000", castStatus: "Đồng ý", experience: "Có", trainingStatus: "Chưa Training", cvReference: "CV"
  },
  {
    id: "HRSL15", name: "Nguyễn Hường", role: "support", phone: "0843506869", level: "Cấp 2",
    cashOffer: "40.000", castStatus: "Đồng ý", experience: "Có", trainingStatus: "Chưa Training"
  }
];
