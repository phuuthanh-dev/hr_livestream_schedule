#!/usr/bin/env python3
"""livestream-host-rank-eval — đánh giá host livestream theo rank Base_Salary_Card.

Đọc transcript các ca live (thư mục raw/<host>/<session>/ gồm transcript.txt
timestamped + summary.md), tính điểm theo rubric ánh xạ từ tiêu chí grade
trong tab Base_Salary_Card (Thử việc / C / B / A / S), đối chiếu roster HR
hiện tại và đề xuất rank + lương cứng + % hoa hồng mới.

Scope: read-only trên thư mục raw; chỉ ghi trong thư mục --out.

Usage:
  python3 host_rank_eval.py analyze \
      --raw-dir  <path/to/raw> \
      --roster   <path/to/roster.json> \
      --out      <path/to/results>
"""
import argparse
import csv
import json
import os
import re
import sys

SEG_RE = re.compile(r"^\[(\d+):(\d+)\s*-\s*(\d+):(\d+)\]\s*(.*)$")

# Nhiền nền từ audio TikTok bị Whisper nhận diện (không phải lời host)
NOISE_PATTERNS = [
    "subscribe cho kênh",
    "la la school",
    "ghiền mì gõ",
    "không bỏ lỡ những video",
    "hãy subscribe",
]

# Bộ từ khóa theo nhóm kỹ năng (kèm biến thể ASR tiếng Việt thường gặp)
KEYSETS = {
    "cta": [  # chốt đơn / kêu gọi mua
        "chốt đơn", "chốt liền", "lên đơn", "đặt hàng", "mua ngay", "bấm mua",
        "thanh toán", "giỏ hàng", "săn đơn", "xăng đơn", "săng đơn", "chân thủ",
        "tranh thủ", "chốt", "mua", "lên đơn",
    ],
    "engagement": [  # đẩy tương tác
        "thả tim", "thả tym", "lượt like", "like", "follow", "chia sẻ", "comment",
        "bình luận", "theo dõi", "tim", "share",
    ],
    "consult": [  # tư vấn size / chất liệu / phản hồi comment
        "chiều cao", "cân nặng", "size", "tư vấn", "hỗ trợ", "chất liệu",
        "form", "ôm dáng", "tôn dáng", "xì lai", "xl",
    ],
    "promo": [  # giải thích deal / voucher / giá
        "voucher", "vô chờ", "giảm giá", "flash sale", "deal", "khuyến mãi",
        "giá chỉ", "giảm 30", "giá gốc", "giá", "chương trình",
    ],
    "product": [  # giới thiệu sản phẩm
        "mẫu", "mã số", "bộ sưu tập", "oversize", "baby t", "công nghệ ar",
        "phản quang", "áo", "thiết kế",
    ],
    "connect": [  # tương tác cá nhân với người xem
        "chào", "cảm ơn", "mọi người ơi", "cả nhà", "bạn ơi", "người đẹp",
    ],
}

# Ngưỡng tuyệt đối tối thiểu (lần/phút nói) — không hạ dưới mức này dù cohort thấp
DENSITY_FLOOR = {"cta": 3.0, "engagement": 1.5, "consult": 3.0,
                 "promo": 2.0, "product": 5.0, "connect": 2.0}

# Trọng số rubric (tổng = 1.0), ánh xạ tiêu chí grade Base_Salary_Card:
# Thử việc = giữ mạch nói; C = đẩy tương tác; B = chốt đơn + giữ chân;
# A = chuyển đổi cao; S = chiến lược.
WEIGHTS = {
    "flow": 0.25,        # giữ mạch nói (coverage + tốc độ nói)
    "cta": 0.20,         # chốt đơn
    "consult": 0.15,     # tư vấn, phản hồi comment
    "engagement": 0.15,  # đẩy tương tác
    "promo": 0.10,       # giải thích deal/giá
    "product": 0.10,     # giới thiệu sản phẩm
    "continuity": 0.05,  # không dead air, không lặp kịch bản
}

# Ngưỡng mật độ được chuẩn hoá động theo cohort (p90), không thấp hơn DENSITY_FLOOR.
DENSITY_FULL = {}

RANK_ORDER = ["Thử việc", "C", "B", "A", "S"]
SALARY_CARD = {  # Base_Salary_Card (master HR_STREAMING)
    "Thử việc": {"salary_vnd_h": 70000, "commission": "5%"},
    "C":        {"salary_vnd_h": 100000, "commission": "7%"},
    "B":        {"salary_vnd_h": 120000, "commission": "12%"},
    "A":        {"salary_vnd_h": 200000, "commission": "18%"},
    "S":        {"salary_vnd_h": 50000, "commission": "20%"},  # placeholder, set below
}
SALARY_CARD["S"]["salary_vnd_h"] = 500000

# Ngưỡng điểm → rank đề xuất
RANK_THRESHOLDS = [("S", 88), ("A", 72), ("B", 58), ("C", 45)]


def is_noise(text: str) -> bool:
    t = text.lower()
    return any(p in t for p in NOISE_PATTERNS)


def parse_summary(path):
    info = {}
    if not os.path.exists(path):
        return info
    for line in open(path, encoding="utf-8", errors="replace"):
        m = re.match(r"-\s*\*\*(.+?):\*\*\s*(.+)", line.strip())
        if m:
            info[m.group(1)] = m.group(2)
    return info


def parse_transcript(path):
    """Trả về list (start_s, end_s, text)."""
    segs = []
    for line in open(path, encoding="utf-8", errors="replace"):
        m = SEG_RE.match(line.strip())
        if not m:
            continue
        s = int(m.group(1)) * 60 + int(m.group(2))
        e = int(m.group(3)) * 60 + int(m.group(4))
        txt = m.group(5).strip()
        if txt:
            segs.append((s, e, txt))
    return segs


def clean(text: str) -> str:
    """Chuẩn hoá nhẹ trước khi đếm keyword."""
    return text.lower()


def analyze_session(session_dir):
    summary = parse_summary(os.path.join(session_dir, "summary.md"))
    tpath = os.path.join(session_dir, "transcript.txt")
    if not os.path.exists(tpath):
        return None
    segs = parse_transcript(tpath)
    if not segs:
        return None

    duration = int(re.sub(r"[^0-9]", "", summary.get("Duration", "").split("(")[0]) or 0)
    if duration <= 0:
        duration = segs[-1][1]
    try:
        viewers = int(summary.get("Viewers", "0") or 0)
    except ValueError:
        viewers = 0

    clean_segs = [(s, e, t) for (s, e, t) in segs if not is_noise(t)]
    noise_segs = len(segs) - len(clean_segs)
    talk_s = sum(max(0, e - s) for s, e, _ in clean_segs)
    talk_min = max(talk_s / 60.0, 0.001)
    words = sum(len(t.split()) for _, _, t in clean_segs)
    wpm = words / talk_min
    coverage = talk_s / duration if duration else 0.0

    counts = {k: 0 for k in KEYSETS}
    quotes = {k: [] for k in KEYSETS}
    for s, e, t in clean_segs:
        tc = clean(t)
        for k, kws in KEYSETS.items():
            hits = sum(tc.count(kw) for kw in kws)
            if hits:
                counts[k] += hits
                if len(quotes[k]) < 6 and len(t) > 15:
                    quotes[k].append(t[:160])

    density = {k: counts[k] / talk_min for k in KEYSETS}

    # lặp kịch bản: đoạn trùng liên tiếp
    repeats = sum(1 for i in range(1, len(clean_segs))
                  if clean_segs[i][2] == clean_segs[i - 1][2])
    repeat_ratio = repeats / max(len(clean_segs) - 1, 1)

    # dead air (khoảng lặng > 10s giữa các đoạn)
    dead_s = 0
    max_gap = 0
    for i in range(1, len(clean_segs)):
        gap = clean_segs[i][0] - clean_segs[i - 1][1]
        if gap > 10:
            dead_s += gap
            max_gap = max(max_gap, gap)
    dead_ratio = dead_s / duration if duration else 0.0

    return {
        "session": os.path.basename(session_dir.rstrip("/")),
        "start": summary.get("Start", ""),
        "duration_s": duration,
        "viewers": viewers,
        "words": words,
        "wpm": round(wpm, 1),
        "coverage": round(coverage, 3),
        "repeat_ratio": round(repeat_ratio, 3),
        "dead_air_s": dead_s,
        "max_gap_s": max_gap,
        "dead_ratio": round(dead_ratio, 4),
        "noise_segments": noise_segs,
        "counts": counts,
        "density_per_min": {k: round(v, 3) for k, v in density.items()},
        "quotes": quotes,
    }


def clamp01(x):
    return max(0.0, min(1.0, x))


def calibrate_density_full(sessions):
    """Ngưỡng đạt điểm tối đa từng trục = p90 của cohort, không dưới floor tuyệt đối."""
    out = {}
    for k in KEYSETS:
        vals = sorted(s["density_per_min"][k] for s in sessions)
        p90 = vals[int(0.9 * (len(vals) - 1))] if vals else 0.0
        out[k] = max(p90 * 1.05, DENSITY_FLOOR[k])
    return out


def score_session(sess, density_full):
    """Chấm điểm 0-100 từng trục cho 1 phiên dựa trên ngưỡng cohort."""
    density = sess["density_per_min"]
    flow_score = clamp01(sess["coverage"] / 0.85) * 0.6 + clamp01(sess["wpm"] / 150.0) * 0.4
    kw_scores = {k: clamp01(density[k] / density_full[k])
                 for k in ("cta", "engagement", "consult", "promo", "product", "connect")}
    consult_score = clamp01(0.7 * kw_scores["consult"] + 0.3 * kw_scores["connect"])
    continuity_score = (clamp01(1.0 - sess["dead_ratio"] * 3.0) * 0.6
                        + clamp01(1.0 - sess["repeat_ratio"] * 2.0) * 0.4)
    total = 100.0 * (
        WEIGHTS["flow"] * flow_score
        + WEIGHTS["cta"] * kw_scores["cta"]
        + WEIGHTS["engagement"] * kw_scores["engagement"]
        + WEIGHTS["consult"] * consult_score
        + WEIGHTS["promo"] * kw_scores["promo"]
        + WEIGHTS["product"] * kw_scores["product"]
        + WEIGHTS["continuity"] * continuity_score
    )
    sess["scores"] = {
        "flow": round(100 * flow_score, 1),
        "cta": round(100 * kw_scores["cta"], 1),
        "engagement": round(100 * kw_scores["engagement"], 1),
        "consult": round(100 * consult_score, 1),
        "promo": round(100 * kw_scores["promo"], 1),
        "product": round(100 * kw_scores["product"], 1),
        "continuity": round(100 * continuity_score, 1),
    }
    sess["total"] = round(total, 1)
    return sess


def score_to_rank(score: float) -> str:
    for r, th in RANK_THRESHOLDS:
        if score >= th:
            return r
    return "Thử việc"


def aggregate_host(host, sessions):
    if not sessions:
        return None
    w = [s["duration_s"] for s in sessions]
    tw = max(sum(w), 1)

    def wavg(key):
        return sum(s[key] * s["duration_s"] for s in sessions) / tw

    scores = {}
    for axis in sessions[0]["scores"]:
        scores[axis] = round(sum(s["scores"][axis] * s["duration_s"] for s in sessions) / tw, 1)
    total = round(sum(s["total"] * s["duration_s"] for s in sessions) / tw, 1)

    density = {}
    for k in KEYSETS:
        density[k] = round(sum(s["density_per_min"][k] * s["duration_s"] for s in sessions) / tw, 2)

    quotes = {k: [] for k in KEYSETS}
    for s in sessions:
        for k, qs in s["quotes"].items():
            quotes[k].extend(qs[:2])

    return {
        "host": host,
        "sessions_analyzed": len(sessions),
        "total_live_s": tw,
        "total_live_h": round(tw / 3600, 1),
        "avg_viewers": round(sum(s["viewers"] for s in sessions) / len(sessions), 1),
        "avg_wpm": round(wavg("wpm"), 1),
        "avg_coverage": round(wavg("coverage"), 3),
        "avg_repeat_ratio": round(wavg("repeat_ratio"), 3),
        "density_per_min": density,
        "scores": scores,
        "total_score": total,
        "suggested_rank": score_to_rank(total),
        "quotes": quotes,
        "sessions": sessions,
    }


def bullets_for(host_agg):
    """Sinh bullet điểm tốt / cần khắc phục từ metrics (mỗi bên 5-7)."""
    sc = host_agg["scores"]
    den = host_agg["density_per_min"]
    good, bad = [], []

    if sc["flow"] >= 75:
        good.append(f"Giữ mạch nói tốt: phủ sóng {int(host_agg['avg_coverage']*100)}% thời lượng, tốc độ ~{host_agg['avg_wpm']} từ/phút — không để sóng chết.")
    elif sc["flow"] >= 50:
        good.append(f"Mạch nói khá ổn (phủ {int(host_agg['avg_coverage']*100)}% thời lượng), tốc độ {host_agg['avg_wpm']} từ/phút.")
    else:
        bad.append(f"Mạch nói yếu: chỉ phủ {int(host_agg['avg_coverage']*100)}% thời lượng, tốc độ {host_agg['avg_wpm']} từ/phút — cần luyện nói liên tục, tránh lặng sóng.")

    if sc["cta"] >= 70:
        good.append(f"Kêu gọi chốt đơn dày và đều ({den['cta']:.1f} lần/phút): nhắc giỏ hàng, lên đơn, tranh thủ săn deal liên tục.")
    elif sc["cta"] >= 45:
        good.append(f"Có kêu gọi chốt đơn ({den['cta']:.1f} lần/phút) nhưng nhịp chưa đều.")
    else:
        bad.append(f"Kêu gọi chốt đơn thưa ({den['cta']:.1f} lần/phút) — thiếu câu dẫn 'chốt đơn/lên đơn/giỏ hàng' thường xuyên.")

    if sc["engagement"] >= 70:
        good.append(f"Đẩy tương tác tốt ({den['engagement']:.1f} lần/phút): kêu like, thả tim, comment, follow đều đặn.")
    elif sc["engagement"] >= 45:
        good.append(f"Có kéo tương tác ({den['engagement']:.1f} lần/phút) nhưng chưa tạo được nhịp kêu gọi xuyên suốt.")
    else:
        bad.append(f"Ít kêu gọi tương tác ({den['engagement']:.1f} lần/phút) — cần thêm nhịp 'thả tim / comment / follow' để giữ chân người xem.")

    if sc["consult"] >= 70:
        good.append(f"Tư vấn size/chất liệu và phản hồi comment tốt ({den['consult']:.1f} lần/phút): hỏi chiều cao cân nặng, chốt size trực tiếp cho khách.")
    elif sc["consult"] >= 45:
        good.append(f"Có tư vấn size/chất liệu ({den['consult']:.1f} lần/phút), phản hồi khách ở mức đạt.")
    else:
        bad.append(f"Tư vấn size/chất liệu mỏng ({den['consult']:.1f} lần/phút) — cần chủ động hỏi chiều cao/cân nặng và chốt size cho khách.")

    if sc["promo"] >= 70:
        good.append(f"Giải thích deal/giá rõ ràng, lặp lại chương trình nhiều lần ({den['promo']:.1f} lần/phút): voucher, giá flash, quà tặng kèm.")
    elif sc["promo"] >= 45:
        good.append(f"Có giải thích chương trình khuyến mãi ({den['promo']:.1f} lần/phút).")
    else:
        bad.append(f"Giải thích deal/giá còn mờ ({den['promo']:.1f} lần/phút) — khách khó nắm ưu đãi nếu không nhắc lại voucher/giá flash thường xuyên.")

    if sc["product"] >= 70:
        good.append(f"Giới thiệu sản phẩm chi tiết ({den['product']:.1f} lần/phút): đi qua nhiều mẫu, nói chất liệu/form/công nghệ AR.")
    elif sc["product"] >= 45:
        good.append(f"Trình bày sản phẩm đạt ({den['product']:.1f} lần/phút).")
    else:
        bad.append(f"Mô tả sản phẩm mỏng ({den['product']:.1f} lần/phút) — cần nói kỹ chất liệu, form, điểm khác biệt từng mẫu.")

    if sc["continuity"] >= 70:
        good.append("Ít khoảng lặng dài, chuyển mẫu/chủ đề liền mạch.")
    else:
        dead = sum(s["dead_air_s"] for s in host_agg["sessions"])
        bad.append(f"Có nhiều khoảng lặng >10s (tổng ~{dead//60} phút) — cần chuẩn bị script gối đầu khi chuyển mẫu.")

    if host_agg["avg_repeat_ratio"] > 0.12:
        bad.append(f"Lặp kịch bản nhiều ({int(host_agg['avg_repeat_ratio']*100)}% đoạn trùng liên tiếp) — nói như đọc script, cần diễn đạt tự nhiên hơn.")
    elif host_agg["avg_repeat_ratio"] <= 0.06:
        good.append("Diễn đạt tự nhiên, ít lặp nguyên văn kịch bản.")

    if host_agg["avg_viewers"] >= 100:
        good.append(f"Giữ mắt xem tốt (trung bình {host_agg['avg_viewers']:.0f} viewers/ca).")
    elif host_agg["avg_viewers"] < 40:
        bad.append(f"Mắt xem trung bình thấp ({host_agg['avg_viewers']:.0f} viewers/ca) — cần hook mở màn và nhịp tương tác mạnh hơn để giữ chân.")

    return good[:7], bad[:7]


def fmt_vnd(n):
    return f"{n:,.0f}₫".replace(",", ".")


def main():
    ap = argparse.ArgumentParser(description="Host livestream rank evaluator")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyze", help="Chấm điểm transcript và đề xuất rank")
    a.add_argument("--raw-dir", required=True)
    a.add_argument("--roster", required=True)
    a.add_argument("--out", required=True)
    args = ap.parse_args()

    if args.cmd != "analyze":
        ap.error("only analyze supported")

    roster = json.load(open(args.roster, encoding="utf-8"))
    # pass 1: thu thập mọi phiên của mọi host để chuẩn hoá cohort
    host_sessions = {}
    for host_dir in sorted(os.listdir(args.raw_dir)):
        hp = os.path.join(args.raw_dir, host_dir)
        if not os.path.isdir(hp) or host_dir.startswith("_"):
            continue
        sessions = []
        for sess in sorted(os.listdir(hp)):
            sp = os.path.join(hp, sess)
            if not os.path.isdir(sp) or "ca_live" not in sess.lower():
                continue
            r = analyze_session(sp)
            if r:
                sessions.append(r)
        if sessions:
            host_sessions[host_dir] = sessions

    all_sessions = [s for ss in host_sessions.values() for s in ss]
    # loại phiên lỗi dữ liệu (Whisper lặp ảo giác >50% số đoạn)
    for s in all_sessions:
        s["invalid_data"] = s["repeat_ratio"] > 0.5
    valid_sessions = [s for s in all_sessions if not s["invalid_data"]]
    density_full = calibrate_density_full(valid_sessions)
    for s in all_sessions:
        if not s["invalid_data"]:
            score_session(s, density_full)

    hosts_out = []
    for host_dir, sessions in host_sessions.items():
        valid = [s for s in sessions if not s["invalid_data"]]
        agg = aggregate_host(host_dir, valid)
        if agg:
            agg["sessions_invalid"] = len(sessions) - len(valid)
            g, b = bullets_for(agg)
            agg["bullets_good"] = g
            agg["bullets_bad"] = b
            hosts_out.append(agg)

    # ghép roster
    for h in hosts_out:
        info = roster.get(h["host"], {})
        h["hr_id"] = info.get("hr_id", "")
        h["display_name"] = info.get("name", h["host"])
        h["current_rank"] = info.get("current_rank", "N/A")
        h["current_salary"] = info.get("current_salary_vnd_h", 0)
        h["current_commission"] = info.get("current_commission", "N/A")
        new = SALARY_CARD[h["suggested_rank"]]
        h["new_salary"] = new["salary_vnd_h"]
        h["new_commission"] = new["commission"]

    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "calibration.json"), "w", encoding="utf-8") as f:
        json.dump({"density_full_per_min": {k: round(v, 2) for k, v in density_full.items()},
                   "sessions_calibrated": len(all_sessions)}, f, ensure_ascii=False, indent=2)
    with open(os.path.join(args.out, "metrics.json"), "w", encoding="utf-8") as f:
        json.dump(hosts_out, f, ensure_ascii=False, indent=2)

    # CSV
    with open(os.path.join(args.out, "rank_result.csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["HR ID", "Host", "Số ca phân tích", "Tổng giờ live",
                    "Rank hiện tại", "Lương cứng hiện tại (VNĐ/h)", "%HH hiện tại",
                    "Điểm (0-100)", "Rank đề xuất", "Lương cứng mới (VNĐ/h)", "%HH mới"])
        for h in sorted(hosts_out, key=lambda x: -x["total_score"]):
            w.writerow([h["hr_id"], h["display_name"], h["sessions_analyzed"],
                        h["total_live_h"], h["current_rank"],
                        h["current_salary"] or "", h["current_commission"],
                        h["total_score"], h["suggested_rank"],
                        h["new_salary"], h["new_commission"]])

    # Markdown report
    lines = []
    lines.append("# BẢNG ĐÁNH GIÁ & XẾP LẠI RANK HOST LIVESTREAM")
    lines.append("")
    lines.append("Rubric: ánh xạ tiêu chí grade `Base_Salary_Card` (master HR_STREAMING) trên transcript các ca live.")
    lines.append("")
    lines.append("| HR ID | Host | Số ca | Giờ live | Rank hiện tại | Lương/HH hiện tại | Điểm | Rank đề xuất | Lương/HH mới |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    for h in sorted(hosts_out, key=lambda x: -x["total_score"]):
        cur = f"{fmt_vnd(h['current_salary'])}/h + {h['current_commission']}" if h["current_salary"] else "N/A"
        new = f"{fmt_vnd(h['new_salary'])}/h + {h['new_commission']}"
        lines.append(f"| {h['hr_id'] or '—'} | {h['display_name']} | {h['sessions_analyzed']} | {h['total_live_h']}h | {h['current_rank']} | {cur} | {h['total_score']} | **{h['suggested_rank']}** | {new} |")
    lines.append("")
    for h in sorted(hosts_out, key=lambda x: -x["total_score"]):
        lines.append(f"## {h['display_name']} ({h['hr_id'] or h['host']}) — đề xuất: {h['suggested_rank']} ({h['total_score']}/100)")
        lines.append("")
        lines.append(f"Trục điểm: flow {h['scores']['flow']} · chốt đơn {h['scores']['cta']} · tương tác {h['scores']['engagement']} · tư vấn {h['scores']['consult']} · deal/giá {h['scores']['promo']} · sản phẩm {h['scores']['product']} · liền mạch {h['scores']['continuity']}")
        lines.append("")
        lines.append("**Điểm tốt:**")
        for b in h["bullets_good"]:
            lines.append(f"- {b}")
        lines.append("")
        lines.append("**Điểm cần khắc phục:**")
        for b in h["bullets_bad"]:
            lines.append(f"- {b}")
        lines.append("")
    with open(os.path.join(args.out, "rank_report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"OK: {len(hosts_out)} hosts -> {args.out}/rank_report.md, rank_result.csv, metrics.json")


if __name__ == "__main__":
    sys.exit(main())
