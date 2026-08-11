import type { SchedulePerson } from "@/lib/types";

export const EMPLOYEE_MIGRATION_SOURCE = "HR_STREAMING_ MASTER FILE.xlsx · 09/08/2026";

export const EMPLOYEE_MIGRATION_SEED: SchedulePerson[] = [
  {
    id: "HRLT01", name: "Thanh Thảo", role: "host", phone: "0333805063", cvReference: "CV",
    workLocation: "both", level: "B", zaloStatus: "Có", castStatus: "Đồng ý",
    cashOffer: "100.000 + 7% GMV", experience: "Có", liveAccountType: "Công ty",
    trainingStatus: "Rồi", liveChannelId: "ledanguyenlinh_", notes: "Giữ tài khoản: Le Dang Uyen Linh"
  },
  {
    id: "HRLT04", name: "Thanh Đạt", role: "host", phone: "0384019042", cvReference: "CV",
    workLocation: "studio", level: "B", zaloStatus: "Có", castStatus: "Đồng ý",
    cashOffer: "120.000 + 12% GMV", experience: "Có", achievements: "2-3tr",
    liveAccountType: "Công ty", trainingStatus: "Chưa", liveChannelId: "vuminhkhangg02"
  },
  {
    id: "HRLT05", name: "Taddie", role: "host", phone: "0919990069", cvReference: "Port",
    workLocation: "studio", level: "A", zaloStatus: "Có", castStatus: "Đồng ý",
    cashOffer: "200.000+ % GMV", experience: "Có", achievements: "từ 5-7tr",
    liveAccountType: "Công ty", trainingStatus: "Chưa", liveChannelId: "vuminhkhangg02"
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
    cashOffer: "70.000 + 5% GMV", experience: "Không", achievements: "0",
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
    id: "HRLT13", name: "Trung Kiên (KIN)", role: "host", phone: "0986593154",
    workLocation: "both", level: "B", zaloStatus: "Chưa", castStatus: "Đồng ý",
    cashOffer: "200.000 + % GMV", experience: "Có", liveAccountType: "Cả hai",
    trainingStatus: "Chưa", liveChannelId: "kienkochoitiktok",
    notes: "Review 22/07/2026: 49/100 (độ tin cậy thấp). Có 2 link TikTok; follow ghi nhận 1K và 6K. Chưa có CV/kinh nghiệm xác minh; bắt buộc live test 15-20 phút trước khi xếp ca."
  },
  {
    id: "HRLT15", name: "Bình Phương", role: "host", phone: "0865053574", cvReference: "CV",
    workLocation: "studio", level: "B", zaloStatus: "Chưa", castStatus: "Không đồng ý",
    cashOffer: "200.000 + 18% GMV", experience: "Có", liveAccountType: "Cả hai",
    trainingStatus: "Chưa", liveChannelId: "bespin_",
    notes: "Review 22/07/2026: 74/100. Có kinh nghiệm host thời trang và mỹ phẩm; đề xuất B, xét nâng A sau live test."
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
    trainingStatus: "Chưa", liveChannelId: "vuminhkhangg02"
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
    liveAccountType: "Công ty", trainingStatus: "Chưa", liveChannelId: "vuminhkhangg02"
  },
  {
    id: "HRSL01_6H", name: "Trần Công Hậu", role: "support", phone: "0332517003", level: "Cấp 1",
    cashOffer: "30.000", castStatus: "Đồng ý", experience: "Có", trainingStatus: "Đã Training",
    cvReference: "CV", notes: "Nền tảng Marketing tốt, cần đào tạo thêm về vận hành giỏ hàng và thiết bị Support."
  },
  {
    id: "HRSL02_6H", name: "Nguyễn Anh Huy", role: "support", phone: "0706614157", level: "Cấp 2",
    cashOffer: "45.000", castStatus: "Đồng ý", experience: "Có", trainingStatus: "Đã Training",
    cvReference: "CV", notes: "Phù hợp live thời trang; hiểu sản phẩm, tư vấn chất liệu/form dáng và phối hợp tốt với Host."
  },
  {
    id: "HRSL05", name: "Hoàng Kỳ Anh", role: "support", phone: "0329496107", level: "Cấp 3",
    cashOffer: "70.000", castStatus: "Đồng ý", experience: "Có", trainingStatus: "Đã Training",
    cvReference: "CV", notes: "Kinh nghiệm brand lớn, thạo OBS cross-sàn, biết makeup và có thể backup Host."
  },
  {
    id: "HRSL06", name: "Trần Thanh Huy", role: "support", phone: "0829049099", level: "Cấp 3",
    cashOffer: "70.000", castStatus: "Đồng ý", experience: "Có", trainingStatus: "Đã Training",
    cvReference: "CV", notes: "Từng chạy cho các brand lớn, thạo OBS, có thể co-host hoặc live backup."
  },
  {
    id: "HRSL07", name: "Ngọc Hân", role: "support", phone: "0778808571", level: "Cấp 2",
    cashOffer: "45.000", castStatus: "Đồng ý", experience: "Có", trainingStatus: "Chưa Training",
    cvReference: "CV", notes: "Có kinh nghiệm tư vấn size, take care mẫu và dùng OBS/TikTok Shop."
  },
  {
    id: "HRSL08", name: "Quỳnh Hảo", role: "support", phone: "0399528760", level: "Cấp 2",
    cashOffer: "50.000", castStatus: "Đồng ý", experience: "Có", trainingStatus: "Chưa Training",
    cvReference: "CV", notes: "Trợ live cross-sàn TikTok/Shopee, lọc comment nhanh, ghim sản phẩm và tung mã đúng nhịp."
  },
  {
    id: "HRSL09", name: "Đỗ Chí Khâm", role: "support", phone: "0344289465", level: "Cấp 1",
    cashOffer: "30.000", castStatus: "Đồng ý", experience: "Không", trainingStatus: "Đã Training",
    cvReference: "CV", notes: "Có nền tảng Content Marketing và tư vấn Zalo; chưa có kinh nghiệm vận hành phòng live trực tiếp."
  },
  {
    id: "HRSL10", name: "Đoàn Phước Thiện", role: "support", phone: "0389400885", level: "Cấp 1",
    cashOffer: "30.000", castStatus: "Đồng ý", experience: "Không", trainingStatus: "Đã Training", cvReference: "CV"
  },
  {
    id: "HRSL11", name: "Trần Phan Trà My", role: "support", phone: "0974277400", level: "Cấp 1",
    cashOffer: "30.000", castStatus: "Đồng ý", experience: "Không", trainingStatus: "Đã Training",
    cvReference: "CV", notes: "Có nền tảng tư vấn bán hàng và biểu diễn; chưa ghi nhận kinh nghiệm live TMĐT hoặc vận hành OBS."
  },
  {
    id: "HRSL12", name: "Trịnh Xuân Quỳnh", role: "support", phone: "0707816379", level: "Cấp 2",
    cashOffer: "45.000", castStatus: "Đồng ý", experience: "Có", trainingStatus: "Đã Training",
    cvReference: "CV", notes: "Có 6 tháng kinh nghiệm live nhiều ngành và 2 tháng kinh nghiệm trợ live, biết dùng OBS."
  }
];
