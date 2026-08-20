export type SupportTrainingScoreValue = 0 | 1 | 2 | 3 | 4;

export type SupportTrainingChecklistItemDefinition = {
  id: string;
  label: string;
  detail: string;
  allowNa?: boolean;
};

export type SupportTrainingChecklistSectionDefinition = {
  id: string;
  title: string;
  items: SupportTrainingChecklistItemDefinition[];
};

export type SupportTrainingChecklistEntry = {
  score: SupportTrainingScoreValue;
  note: string;
  notApplicable: boolean;
};

export type SupportTrainingChecklistEntries = Record<string, SupportTrainingChecklistEntry>;

export type SupportTrainingMeta = {
  isFinalShift: boolean;
  reviewedShift: string;
  reviewedLocation: string;
  evaluatorName: string;
};

export type SupportTrainingFeedback = {
  strengths: string;
  improvementAreas: string;
  incidentNotes: string;
  trainingProposal: string;
  conclusion: string;
  generalNotes: string;
};

export const SUPPORT_TRAINING_CHECKLIST: SupportTrainingChecklistSectionDefinition[] = [
  {
    id: "before_live",
    title: "A. Trước phiên live",
    items: [
      { id: "punctuality", label: "Đúng giờ", detail: "Có mặt trước giờ live 10 - 15 phút để setup và nhận bàn giao." },
      { id: "lights", label: "Hệ thống đèn", detail: "Bật đúng layout: đèn trần, Ring Light, Godox, đèn LED trụ và LED bảng." },
      { id: "camera", label: "Camera", detail: "Mở camera, kiểm tra chế độ, khung hình và kết nối trước khi live." },
      { id: "main_pc", label: "PC chính", detail: "Mở TikTok Live Studio, kiểm tra camera, AR và các luồng màn hình đúng tỷ lệ." },
      { id: "secondary_pc", label: "PC phụ", detail: "Mở bảng size và giao diện TikTok để Host theo dõi bình luận." },
      { id: "laptop", label: "Laptop phụ", detail: "Mở TikTok Shop Streamer Desktop, chuẩn bị sản phẩm, voucher và thao tác ghim." },
      { id: "ar_connection", label: "Kết nối AR", detail: "Setup điện thoại quét AR và phần mềm đồng bộ màn hình trên máy tính." },
      { id: "handover", label: "Nhận bàn giao", detail: "Kiểm đếm thiết bị, sản phẩm mẫu và ký nhận BBBG đầy đủ." },
      { id: "product_condition", label: "Tình trạng sản phẩm", detail: "Kiểm tra, ủi thẳng và chuẩn bị sản phẩm mẫu sạch, phẳng, lên hình đẹp." },
      { id: "product_info", label: "Nắm thông tin sản phẩm", detail: "Hiểu tên brand, tên sản phẩm, chất liệu, hình in PET, AR và chương trình promote." }
    ]
  },
  {
    id: "during_live",
    title: "B. Trong phiên live",
    items: [
      { id: "cart_management", label: "Quản lý giỏ hàng", detail: "Ghim sản phẩm đúng nhịp, đúng kịch bản và đúng sản phẩm Host đang giới thiệu." },
      { id: "voucher_timing", label: "Voucher", detail: "Tung voucher đúng thời điểm, không chậm nhịp hoặc sai chương trình." },
      { id: "host_support", label: "Hỗ trợ Host", detail: "Đọc comment, tương tác phụ Host và hỗ trợ thao tác theo nhịp live." },
      { id: "ar_support", label: "Hỗ trợ AR", detail: "Lấy mã AR, chuyển điện thoại hoặc màn hình AR đúng lúc khi sản phẩm có tính năng AR." },
      { id: "screen_control", label: "Điều khiển màn hình", detail: "Chuyển mượt giữa camera, AR, bảng size và các màn hình cần thiết." },
      { id: "issue_handling", label: "Xử lý sự cố", detail: "Xử lý nhanh các lỗi cơ bản về phần mềm, thiết bị, kết nối hoặc hiển thị." },
      { id: "focus", label: "Tập trung trong ca", detail: "Theo sát Host và phiên live, không mất tập trung trong lúc vận hành." }
    ]
  },
  {
    id: "after_live",
    title: "C. Kết thúc phiên live",
    items: [
      { id: "cleanup", label: "Dọn dẹp sản phẩm", detail: "Thu gom, treo hoặc gấp và sắp xếp sản phẩm mẫu gọn gàng." },
      { id: "handover_count", label: "Kiểm đếm bàn giao", detail: "Kiểm đủ số lượng, tình trạng sản phẩm hoặc thiết bị và ký bàn giao cho ca sau/Admin." },
      { id: "issue_log", label: "Ghi chú lỗi", detail: "Ghi rõ lỗi mới, đồ bẩn, đồ hư hoặc phát sinh vào BBBG/nhật ký luân chuyển." },
      { id: "separate_faulty_items", label: "Tách đồ lỗi/bẩn", detail: "Tách riêng sản phẩm cần xử lý, không để lẫn với hàng mẫu bình thường." },
      { id: "final_shift_report", label: "Report ca cuối", detail: "Gửi đủ ảnh toàn cảnh phòng live, sản phẩm đã sắp xếp và BBBG đã ký.", allowNa: true },
      { id: "final_shift_shutdown", label: "Đóng ca cuối", detail: "Tắt điện, đèn, máy lạnh, camera, PC và khóa cửa Studio an toàn nếu là ca cuối/không có ca sau liên tục.", allowNa: true }
    ]
  },
  {
    id: "discipline",
    title: "3. Đánh giá thái độ và kỷ luật",
    items: [
      { id: "professionalism", label: "Tác phong", detail: "Trang phục nghiêm túc, nhanh nhẹn, sẵn sàng hỗ trợ." },
      { id: "honesty", label: "Trung thực", detail: "Báo cáo đúng tình trạng hàng hóa, thiết bị và lỗi phát sinh." },
      { id: "asset_responsibility", label: "Trách nhiệm tài sản", detail: "Bảo quản tốt sản phẩm mẫu, thiết bị Studio và phụ kiện bàn giao." },
      { id: "coordination", label: "Phối hợp", detail: "Làm việc nhịp nhàng với Host, Admin và Support ca trước/ca sau." },
      { id: "proactive", label: "Chủ động", detail: "Chủ động kiểm tra, nhắc việc và xử lý tình huống trong phạm vi trách nhiệm." }
    ]
  }
];

const END_OF_DAY_NA_ITEM_IDS = new Set(["final_shift_report", "final_shift_shutdown"]);
const CHECKLIST_ITEM_LOOKUP = new Map(
  SUPPORT_TRAINING_CHECKLIST.flatMap((section) => section.items.map((item) => [item.id, item] as const))
);

export type SupportTrainingEvaluation = {
  totalItems: number;
  applicableItems: number;
  excludedItems: number;
  maxScore: number;
  achievedScore: number;
  scorePercent: number;
  classification: "Xuất sắc" | "Tốt" | "Đạt" | "Cần đào tạo lại";
  rating: "A" | "B" | "C" | "D";
  level: "Cấp 1" | "Cấp 2" | "Cấp 3" | "Cấp 4";
  cashOffer: string;
  passed: boolean;
  trainingStatus: "Đã Training" | "Chưa Training";
};

export function supportTrainingItemIds() {
  return SUPPORT_TRAINING_CHECKLIST.flatMap((section) => section.items.map((item) => item.id));
}

export function emptySupportTrainingMeta(): SupportTrainingMeta {
  return {
    isFinalShift: true,
    reviewedShift: "",
    reviewedLocation: "",
    evaluatorName: ""
  };
}

export function emptySupportTrainingFeedback(): SupportTrainingFeedback {
  return {
    strengths: "",
    improvementAreas: "",
    incidentNotes: "",
    trainingProposal: "",
    conclusion: "",
    generalNotes: ""
  };
}

export function emptySupportTrainingEntries(meta: Partial<SupportTrainingMeta> = {}): SupportTrainingChecklistEntries {
  const isFinalShift = meta.isFinalShift !== false;
  return Object.fromEntries(
    supportTrainingItemIds().map((itemId) => {
      const shouldBeNa = !isFinalShift && END_OF_DAY_NA_ITEM_IDS.has(itemId);
      return [itemId, {
        score: 0,
        note: shouldBeNa ? "Không thuộc ca cuối ngày." : "",
        notApplicable: shouldBeNa
      } satisfies SupportTrainingChecklistEntry];
    })
  );
}

export function normalizeSupportTrainingMeta(input: unknown): SupportTrainingMeta {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return {
    isFinalShift: source.isFinalShift !== false,
    reviewedShift: typeof source.reviewedShift === "string" ? source.reviewedShift.trim() : "",
    reviewedLocation: typeof source.reviewedLocation === "string" ? source.reviewedLocation.trim() : "",
    evaluatorName: typeof source.evaluatorName === "string" ? source.evaluatorName.trim() : ""
  };
}

export function normalizeSupportTrainingFeedback(input: unknown): SupportTrainingFeedback {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const legacyNotes = typeof input === "string" ? input : "";
  return {
    strengths: typeof source.strengths === "string" ? source.strengths.trim() : "",
    improvementAreas: typeof source.improvementAreas === "string" ? source.improvementAreas.trim() : "",
    incidentNotes: typeof source.incidentNotes === "string" ? source.incidentNotes.trim() : "",
    trainingProposal: typeof source.trainingProposal === "string" ? source.trainingProposal.trim() : "",
    conclusion: typeof source.conclusion === "string" ? source.conclusion.trim() : "",
    generalNotes: typeof source.generalNotes === "string" ? source.generalNotes.trim() : legacyNotes.trim()
  };
}

export function normalizeSupportTrainingEntries(
  input: unknown,
  meta: SupportTrainingMeta
): SupportTrainingChecklistEntries {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const entries = emptySupportTrainingEntries(meta);
  supportTrainingItemIds().forEach((itemId) => {
    const definition = CHECKLIST_ITEM_LOOKUP.get(itemId);
    const raw = source[itemId];
    let nextEntry = entries[itemId];

    if (typeof raw === "boolean") {
      nextEntry = {
        score: raw ? 4 : 0,
        note: nextEntry.note,
        notApplicable: nextEntry.notApplicable
      };
    } else if (raw && typeof raw === "object") {
      const objectValue = raw as Record<string, unknown>;
      const numericScore = Number(objectValue.score);
      const hasValidScore = Number.isFinite(numericScore) && numericScore >= 0 && numericScore <= 4;
      const requestedNa = objectValue.notApplicable === true;
      const forcedNa = meta.isFinalShift === false && END_OF_DAY_NA_ITEM_IDS.has(itemId);
      const canUseNa = Boolean(definition?.allowNa);
      const notApplicable = canUseNa && (requestedNa || forcedNa);
      nextEntry = {
        score: hasValidScore ? Math.round(numericScore) as SupportTrainingScoreValue : 0,
        note: typeof objectValue.note === "string" ? objectValue.note.trim() : nextEntry.note,
        notApplicable
      };
      if (notApplicable && !nextEntry.note) {
        nextEntry.note = "Không thuộc ca cuối ngày.";
      }
    }

    if (!definition?.allowNa) {
      nextEntry.notApplicable = false;
    }
    if (meta.isFinalShift === false && END_OF_DAY_NA_ITEM_IDS.has(itemId)) {
      nextEntry.notApplicable = true;
      if (!nextEntry.note) nextEntry.note = "Không thuộc ca cuối ngày.";
    }
    entries[itemId] = nextEntry;
  });
  return entries;
}

export function evaluateSupportTraining(entries: SupportTrainingChecklistEntries): SupportTrainingEvaluation {
  const itemIds = supportTrainingItemIds();
  const totalItems = itemIds.length;
  let applicableItems = 0;
  let achievedScore = 0;

  itemIds.forEach((itemId) => {
    const entry = entries[itemId];
    if (!entry || entry.notApplicable) return;
    applicableItems += 1;
    achievedScore += entry.score;
  });

  const excludedItems = totalItems - applicableItems;
  const maxScore = applicableItems * 4;
  const scorePercent = maxScore === 0 ? 0 : Math.round((achievedScore / maxScore) * 100);

  if (scorePercent >= 90) {
    return {
      totalItems,
      applicableItems,
      excludedItems,
      maxScore,
      achievedScore,
      scorePercent,
      classification: "Xuất sắc",
      rating: "A",
      level: "Cấp 4",
      cashOffer: "120.000",
      passed: true,
      trainingStatus: "Đã Training"
    };
  }
  if (scorePercent >= 75) {
    return {
      totalItems,
      applicableItems,
      excludedItems,
      maxScore,
      achievedScore,
      scorePercent,
      classification: "Tốt",
      rating: "B",
      level: "Cấp 3",
      cashOffer: "70.000",
      passed: true,
      trainingStatus: "Đã Training"
    };
  }
  if (scorePercent >= 60) {
    return {
      totalItems,
      applicableItems,
      excludedItems,
      maxScore,
      achievedScore,
      scorePercent,
      classification: "Đạt",
      rating: "C",
      level: "Cấp 2",
      cashOffer: "50.000",
      passed: true,
      trainingStatus: "Đã Training"
    };
  }
  return {
    totalItems,
    applicableItems,
    excludedItems,
    maxScore,
    achievedScore,
    scorePercent,
    classification: "Cần đào tạo lại",
    rating: "D",
    level: "Cấp 1",
    cashOffer: "30.000",
    passed: false,
    trainingStatus: "Chưa Training"
  };
}
