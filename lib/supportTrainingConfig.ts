export type SupportTrainingChecklistItemDefinition = {
  id: string;
  label: string;
  detail: string;
};

export type SupportTrainingChecklistSectionDefinition = {
  id: string;
  title: string;
  items: SupportTrainingChecklistItemDefinition[];
};

export const SUPPORT_TRAINING_CHECKLIST: SupportTrainingChecklistSectionDefinition[] = [
  {
    id: "before_live",
    title: "Giai đoạn trước phiên live",
    items: [
      { id: "lights", label: "Hệ thống đèn", detail: "Mở hệ thống ánh sáng gồm đèn trần, Ring Light, Godox và đèn LED trụ." },
      { id: "camera", label: "Camera", detail: "Mở và cài đặt chế độ cho camera." },
      { id: "main_pc", label: "Màn hình PC chính", detail: "Mở TikTok Live Studio, kiểm tra kết nối camera và điện thoại quét AR, căn đúng tỷ lệ màn hình." },
      { id: "secondary_pc", label: "Màn hình PC phụ", detail: "Mở bảng size chart và giao diện TikTok để host theo dõi bình luận." },
      { id: "laptop", label: "Màn hình Laptop", detail: "Mở TikTok Shop Streamer Desktop, thêm danh mục sản phẩm và voucher cho phiên live." },
      { id: "ar_phone", label: "Điện thoại quét AR", detail: "Set up điện thoại quét AR và phần mềm Scrcpy trên máy tính." },
      { id: "handover", label: "Nhận bàn giao", detail: "Kiểm đếm thiết bị, sản phẩm mẫu và xác nhận nhận bàn giao." },
      { id: "product_info", label: "Thông tin sản phẩm", detail: "Nắm được brand, tên sản phẩm, chất liệu, promote và công nghệ AR." },
      { id: "product_condition", label: "Tình trạng sản phẩm", detail: "Kiểm tra và ủi thẳng toàn bộ đồ mẫu trước khi lên sóng." }
    ]
  },
  {
    id: "during_live",
    title: "Vận hành trong phiên live",
    items: [
      { id: "cart_voucher", label: "Quản lý giỏ hàng & voucher", detail: "Ghim sản phẩm và tung voucher đúng kịch bản và nhịp độ host." },
      { id: "host_support", label: "Hỗ trợ host & tương tác", detail: "Đọc comment, tương tác phụ host và hỗ trợ thao tác mã AR." },
      { id: "screen_flow", label: "Điều khiển luồng màn hình", detail: "Chuyển đổi đúng giữa các màn hình trong phiên live." },
      { id: "technical_issue", label: "Xử lý sự cố kỹ thuật", detail: "Xử lý nhanh các lỗi cơ bản về phần mềm và thiết bị." }
    ]
  },
  {
    id: "after_live",
    title: "Kết thúc phiên live",
    items: [
      { id: "cleanup", label: "Dọn dẹp", detail: "Thu gom và sắp xếp lại sản phẩm mẫu gọn gàng." },
      { id: "inventory_handover", label: "Kiểm đếm & bàn giao hàng hóa", detail: "Kiểm đủ số lượng, tình trạng và note BBBG khi có lỗi." },
      { id: "end_of_day", label: "Ca cuối ngày", detail: "Chụp report, tắt thiết bị và khóa cửa studio an toàn." }
    ]
  }
];

export type SupportTrainingChecklistAnswers = Record<string, boolean>;

export type SupportTrainingEvaluation = {
  totalItems: number;
  checkedItems: number;
  scorePercent: number;
  rating: "A" | "B" | "C" | "D";
  level: "Cấp 1" | "Cấp 2" | "Cấp 3" | "Cấp 4";
  cashOffer: string;
  passed: boolean;
  trainingStatus: "Đã Training" | "Chưa Training";
};

export function supportTrainingItemIds() {
  return SUPPORT_TRAINING_CHECKLIST.flatMap((section) => section.items.map((item) => item.id));
}

export function evaluateSupportTraining(answers: SupportTrainingChecklistAnswers): SupportTrainingEvaluation {
  const itemIds = supportTrainingItemIds();
  const totalItems = itemIds.length;
  const checkedItems = itemIds.reduce((total, itemId) => total + (answers[itemId] ? 1 : 0), 0);
  const scorePercent = totalItems === 0 ? 0 : Math.round((checkedItems / totalItems) * 100);

  if (scorePercent >= 90) {
    return { totalItems, checkedItems, scorePercent, rating: "A", level: "Cấp 4", cashOffer: "120.000", passed: true, trainingStatus: "Đã Training" };
  }
  if (scorePercent >= 75) {
    return { totalItems, checkedItems, scorePercent, rating: "B", level: "Cấp 3", cashOffer: "70.000", passed: true, trainingStatus: "Đã Training" };
  }
  if (scorePercent >= 60) {
    return { totalItems, checkedItems, scorePercent, rating: "C", level: "Cấp 2", cashOffer: "50.000", passed: true, trainingStatus: "Đã Training" };
  }
  return { totalItems, checkedItems, scorePercent, rating: "D", level: "Cấp 1", cashOffer: "30.000", passed: false, trainingStatus: "Chưa Training" };
}
