#!/usr/bin/env python3
"""Evaluate one livestream session from TikTok_Sales_Import and Post_Live_Report."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import unicodedata
from datetime import datetime
from typing import Any

DEFAULT_SPREADSHEET_ID = "1x6nVWbe1v80Px4UVRYciOwFJYNdEF8f6LC4gKGbgclw"
TIKTOK_RANGE = "TikTok_Sales_Import!A1:AZ5000"
POST_RANGE = "Post_Live_Report!A1:AZ3000"
PORTFOLIO_RANGE = "Portfolio_Master!A1:AZ2000"

SEVERE_DEAD_AIR_KEYWORDS = (
    "dead air",
    "mất sóng",
    "rớt live",
    "mất tiếng",
    "đứng hình",
    "disconnect",
)
MODERATE_DEAD_AIR_KEYWORDS = (
    "lag",
    "mạng",
    "delay",
    "khựng",
    "im lặng",
)
DISCIPLINE_KEYWORDS = (
    "trễ",
    "không tuân thủ",
    "quên",
    "off cam",
    "lệch script",
)


def clean_gws_text(text: str) -> str:
    return "\n".join(
        line for line in text.splitlines() if not line.startswith("Using keyring")
    )


def gws_values_get(spreadsheet_id: str, range_a1: str) -> list[list[str]]:
    result = subprocess.run(
        [
            "gws",
            "sheets",
            "spreadsheets",
            "values",
            "get",
            "--params",
            json.dumps({"spreadsheetId": spreadsheet_id, "range": range_a1}, ensure_ascii=False),
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(clean_gws_text(result.stderr or result.stdout))
    payload = json.loads(clean_gws_text(result.stdout) or "{}")
    return payload.get("values", [])


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_header(value: Any) -> str:
    text = normalize_text(value).lower().replace("đ", "d")
    text = unicodedata.normalize("NFD", text)
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return re.sub(r"\s+", " ", text)


def parse_currency(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    text = normalize_text(value)
    if not text:
        return 0.0
    cleaned = re.sub(r"[^0-9,.-]", "", text)
    if "." in cleaned and "," not in cleaned:
        parts = [part for part in cleaned.split(".") if part]
        if len(parts) > 1 and all(len(part) == 3 for part in parts[1:]):
            cleaned = "".join(parts)
    if "," in cleaned and "." in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif cleaned.count(".") > 1:
        cleaned = cleaned.replace(".", "")
    elif "," in cleaned and "." not in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    try:
        return float(cleaned)
    except ValueError:
        digits = re.sub(r"[^0-9-]", "", text)
        return float(digits or 0)


def parse_percent(value: Any) -> float:
    if value in ("", None):
        return 0.0
    if isinstance(value, (int, float)):
        numeric = float(value)
        return numeric / 100 if abs(numeric) > 1 else numeric
    text = normalize_text(value)
    numeric = parse_currency(text)
    if "%" in text or abs(numeric) > 1:
        return numeric / 100
    return numeric


def parse_number(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    text = normalize_text(value)
    if not text:
        return 0.0
    text = text.replace(",", ".")
    digits = re.sub(r"[^0-9.-]", "", text)
    try:
        return float(digits)
    except ValueError:
        return 0.0


def parse_datetime(value: Any) -> datetime:
    text = normalize_text(value)
    if not text:
        raise ValueError("Thiếu Start_Time hoặc End_Time.")
    for pattern in ("%d/%m/%Y %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(text, pattern)
        except ValueError:
            continue
    raise ValueError(f"Không parse được thời gian: {text}")


def row_to_dict(headers: list[str], row: list[str]) -> dict[str, str]:
    padded = row + [""] * max(0, len(headers) - len(row))
    return {headers[index]: padded[index] for index in range(len(headers))}


def find_index(headers: list[str], *candidates: str) -> int:
    normalized = [normalize_header(header) for header in headers]
    for candidate in candidates:
        target = normalize_header(candidate)
        for index, header in enumerate(normalized):
            if header == target:
                return index
    for candidate in candidates:
        target = normalize_header(candidate)
        for index, header in enumerate(normalized):
            if target in header:
                return index
    raise KeyError(f"Missing header: {' / '.join(candidates)}")


def split_ids(value: Any) -> list[str]:
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def grade_weight(value: str) -> int:
    normalized = normalize_header(value)
    if normalized.startswith("s"):
        return 5
    if normalized.startswith("a"):
        return 4
    if normalized.startswith("b"):
        return 3
    if normalized.startswith("c"):
        return 2
    return 1


def score_band(value: float, thresholds: list[tuple[float, float]]) -> float:
    for minimum, points in thresholds:
        if value >= minimum:
            return points
    return 0.0


def resolve_tiktok_session(
    rows: list[list[str]],
    *,
    session_id: str | None,
    live_id: str | None,
    row_number: int | None,
) -> tuple[int, dict[str, str]]:
    if not rows:
        raise ValueError("TikTok_Sales_Import đang trống.")
    headers = rows[0]
    body = rows[1:]
    if row_number is not None:
        if row_number < 2 or row_number > len(rows):
            raise ValueError(f"Row {row_number} nằm ngoài range đã đọc.")
        return row_number, row_to_dict(headers, rows[row_number - 1])
    if not session_id and not live_id:
        raise ValueError("Cần --session-id, --live-id hoặc --row-number.")
    session_index = find_index(headers, "Session_ID")
    live_index = find_index(headers, "TikTok_Live_ID")
    matches: list[tuple[int, dict[str, str]]] = []
    for idx, row in enumerate(body, start=2):
        row_session = normalize_text(row[session_index] if session_index < len(row) else "")
        row_live = normalize_text(row[live_index] if live_index < len(row) else "")
        if session_id and row_session == session_id:
            matches.append((idx, row_to_dict(headers, row)))
        elif live_id and row_live == live_id:
            matches.append((idx, row_to_dict(headers, row)))
    if not matches:
        raise ValueError("Không tìm thấy session/live trong TikTok_Sales_Import.")
    if len(matches) > 1:
        raise ValueError("Có nhiều dòng trùng khóa; cần chỉ rõ row-number.")
    return matches[0]


def build_portfolio_map(rows: list[list[str]]) -> dict[str, dict[str, str]]:
    if not rows:
        return {}
    headers = rows[0]
    id_index = find_index(headers, "Streamer_ID", "Mã nhân viên")
    name_index = find_index(headers, "Full_Name", "Họ và tên")
    grade_index = find_index(headers, "Entry_Grade", "Grade")
    strengths_index = find_index(headers, "Ưu điểm")
    weaknesses_index = find_index(headers, "Nhược điểm")
    result: dict[str, dict[str, str]] = {}
    for row in rows[1:]:
        if not row:
            continue
        employee_id = normalize_text(row[id_index] if id_index < len(row) else "")
        if not employee_id:
            continue
        result[employee_id.upper()] = {
            "id": employee_id,
            "name": normalize_text(row[name_index] if name_index < len(row) else employee_id),
            "grade": normalize_text(row[grade_index] if grade_index < len(row) else ""),
            "strengths": normalize_text(row[strengths_index] if strengths_index < len(row) else ""),
            "weaknesses": normalize_text(row[weaknesses_index] if weaknesses_index < len(row) else ""),
        }
    return result


def resolve_post_live_row(rows: list[list[str]], session: dict[str, str]) -> tuple[int, dict[str, str], str]:
    if not rows:
        raise ValueError("Post_Live_Report đang trống.")
    headers = rows[0]
    session_index = find_index(headers, "Session_ID")
    host_index = find_index(headers, "Streamer_ID")
    support_index = find_index(headers, "Support_ID")
    host_ids = split_ids(session.get("Host_ID", ""))
    support_ids = split_ids(session.get("Support_ID", ""))
    host_id = host_ids[0].upper() if host_ids else ""
    support_id = support_ids[0].upper() if support_ids else ""
    exact: list[tuple[int, dict[str, str]]] = []
    fallback: list[tuple[int, dict[str, str]]] = []
    for idx, row in enumerate(rows[1:], start=2):
        row_session = normalize_text(row[session_index] if session_index < len(row) else "")
        row_host = normalize_text(row[host_index] if host_index < len(row) else "").upper()
        row_support = normalize_text(row[support_index] if support_index < len(row) else "").upper()
        if row_session and row_session == session.get("Session_ID", ""):
            exact.append((idx, row_to_dict(headers, row)))
        elif not row_session and row_host == host_id and (not support_id or not row_support or row_support == support_id):
            fallback.append((idx, row_to_dict(headers, row)))
    if exact:
        return exact[0][0], exact[0][1], "exact-session-id"
    if fallback:
        return fallback[0][0], fallback[0][1], "fallback-host-id"
    raise ValueError("Không tìm thấy dòng tương ứng trong Post_Live_Report; trả về hold/no-write.")


def ensure_post_live_is_usable(post: dict[str, str]) -> None:
    evidence_fields = (
        "Connection_Status",
        "Orders_Observed",
        "Revenue_Observed",
        "Script_Execution_15",
        "Teamwork_Handover_5",
        "Sample_Care_5",
        "Tech_Note",
        "Next_Shift_Note",
        "Compliance_Flag_1_0",
    )
    if not any(normalize_text(post.get(field, "")) for field in evidence_fields):
        raise ValueError("Dòng Post_Live_Report quá trống để chấm phiên; trả về hold/no-write.")


def infer_viewer_signal(row: dict[str, str], live_minutes: float) -> tuple[float, str]:
    explicit_headers = (
        "Avg_Viewers",
        "Average_Viewers",
        "Avg Viewer",
        "Viewer_Avg",
    )
    for header in explicit_headers:
        if header in row and normalize_text(row.get(header)):
            return parse_number(row.get(header)), "explicit-viewer-column"
    impressions = parse_number(row.get("Impressions", 0))
    if live_minutes > 0 and impressions > 0:
        return round(impressions / live_minutes, 2), "estimated-from-impressions-per-minute"
    return 0.0, "missing"


def dead_air_score(post: dict[str, str]) -> tuple[float, list[str]]:
    connection = normalize_header(post.get("Connection_Status", ""))
    notes = " | ".join(
        normalize_header(post.get(field, "")) for field in ("Tech_Note", "Next_Shift_Note")
    )
    signals: list[str] = []
    if any(keyword in notes for keyword in SEVERE_DEAD_AIR_KEYWORDS):
        signals.append("Severe dead-air signal from post-live notes.")
        return 0.0, signals
    if any(keyword in notes for keyword in MODERATE_DEAD_AIR_KEYWORDS) or connection not in {"", "ok", "good", "stable", "ổn định"}:
        signals.append("Moderate dead-air or connection issue signal.")
        return 8.0, signals
    signals.append("No dead-air issue found in checked post-live fields.")
    return 15.0, signals


def discipline_penalty(post: dict[str, str]) -> tuple[float, list[str]]:
    penalty = 0.0
    reasons: list[str] = []
    if parse_number(post.get("Compliance_Flag_1_0", 0)) >= 1:
        penalty += 10.0
        reasons.append("Compliance_Flag_1_0 = 1")
    connection = normalize_header(post.get("Connection_Status", ""))
    if connection not in {"", "ok", "good", "stable", "ổn định"}:
        penalty += 3.0
        reasons.append(f"Connection_Status = {post.get('Connection_Status', '') or 'unknown'}")
    notes = " | ".join(
        normalize_header(post.get(field, "")) for field in ("Tech_Note", "Next_Shift_Note")
    )
    if any(keyword in notes for keyword in DISCIPLINE_KEYWORDS):
        penalty += 2.0
        reasons.append("Discipline keyword found in post-live notes")
    return min(penalty, 15.0), reasons


def recommendation(current_grade: str, proposed_tier: str) -> str:
    current = grade_weight(current_grade)
    proposed = grade_weight(proposed_tier)
    if proposed > current:
        return "Đề xuất Tăng hạng ⬆️"
    if proposed < current:
        return "Cảnh báo / Giảm hạng ⬇️"
    return "Giữ hạng ➡️"


def build_strengths(metrics: dict[str, Any], view_source: str) -> str:
    strengths: list[str] = []
    if metrics["gmv_per_hour"] >= 3_000_000:
        strengths.append(f"GMV/giờ đạt {metrics['gmv_per_hour_display']}, đủ ngưỡng vận hành mạnh.")
    if metrics["orders_per_minute"] >= 0.04:
        strengths.append(f"Nhịp chốt đơn {metrics['orders_per_minute']:.2f}/phút ở mức tốt.")
    if metrics["cart_ctr"] >= 0.05:
        strengths.append(f"CTR giỏ hàng {metrics['cart_ctr_display']} cho thấy call-to-action hiệu quả.")
    if metrics["viewer_signal"] >= 100:
        label = "Mắt xem trung bình" if view_source == "explicit-viewer-column" else "Viewer signal ước tính"
        strengths.append(f"{label} {metrics['viewer_signal_display']} giữ traffic ổn.")
    if metrics["execution_score"] >= 8:
        strengths.append("Post-live report cho thấy execution và handover tương đối tốt.")
    return " ".join(strengths[:3]) or "Chưa có điểm mạnh nổi bật từ bộ chỉ số hiện tại."


def build_weaknesses(metrics: dict[str, Any], dead_air_signals: list[str], penalty_reasons: list[str], view_source: str) -> str:
    weaknesses: list[str] = []
    if metrics["gmv_per_hour"] < 1_000_000:
        weaknesses.append(f"GMV/giờ chỉ đạt {metrics['gmv_per_hour_display']}, dưới ngưỡng kỳ vọng.")
    if metrics["orders_per_minute"] < 0.02:
        weaknesses.append(f"Nhịp chốt đơn {metrics['orders_per_minute']:.2f}/phút còn thấp.")
    if metrics["cart_ctr"] < 0.03:
        weaknesses.append(f"CTR giỏ hàng {metrics['cart_ctr_display']} còn yếu.")
    if view_source != "explicit-viewer-column":
        weaknesses.append("Mắt xem đang là chỉ số ước tính vì sheet chưa có cột viewer rõ ràng.")
    if dead_air_signals and dead_air_signals[0] != "No dead-air issue found in checked post-live fields.":
        weaknesses.append(dead_air_signals[0])
    if penalty_reasons:
        weaknesses.append("Vi phạm kỷ luật sóng: " + "; ".join(penalty_reasons))
    return " ".join(weaknesses[:3]) or "Chưa thấy điểm yếu nghiêm trọng từ dữ liệu hiện có."


def evaluate_session(
    *,
    spreadsheet_id: str,
    session_id: str | None,
    live_id: str | None,
    row_number: int | None,
) -> dict[str, Any]:
    tiktok_rows = gws_values_get(spreadsheet_id, TIKTOK_RANGE)
    post_rows = gws_values_get(spreadsheet_id, POST_RANGE)
    portfolio_rows = gws_values_get(spreadsheet_id, PORTFOLIO_RANGE)

    source_row_number, session = resolve_tiktok_session(
        tiktok_rows,
        session_id=session_id,
        live_id=live_id,
        row_number=row_number,
    )
    post_row_number, post, post_match_mode = resolve_post_live_row(post_rows, session)
    ensure_post_live_is_usable(post)

    host_ids = split_ids(session.get("Host_ID", ""))
    if len(host_ids) != 1:
        raise ValueError(f"Session phải có đúng 1 Host_ID, nhận được: {host_ids or 'trống'}")
    host_id = host_ids[0].upper()

    portfolio_map = build_portfolio_map(portfolio_rows)
    host = portfolio_map.get(host_id)
    if not host:
        raise ValueError(f"Host_ID không có trong Portfolio_Master: {host_id}")

    start_at = parse_datetime(session.get("Start_Time", ""))
    end_at = parse_datetime(session.get("End_Time", ""))
    if end_at <= start_at:
        raise ValueError("End_Time phải lớn hơn Start_Time.")
    live_minutes = round((end_at - start_at).total_seconds() / 60, 2)
    live_hours = round(live_minutes / 60, 2)

    gross_gmv = parse_currency(session.get("Gross_GMV", 0))
    returned_gmv = parse_currency(session.get("Returned_GMV", 0))
    eligible_gmv = max(0.0, gross_gmv - returned_gmv)
    gross_orders = parse_number(session.get("Gross_Orders", 0))
    observed_orders = parse_number(post.get("Orders_Observed", 0))
    used_orders = observed_orders if observed_orders > 0 else gross_orders
    orders_per_minute = used_orders / live_minutes if live_minutes > 0 else 0.0
    cart_ctr = parse_percent(session.get("CTR", 0))
    if cart_ctr == 0:
        impressions = parse_number(session.get("Product_Impressions", 0))
        clicks = parse_number(session.get("Product_Clicks", 0))
        cart_ctr = (clicks / impressions) if impressions > 0 else 0.0

    viewer_signal, viewer_source = infer_viewer_signal(session, live_minutes)
    dead_air_points, dead_air_signals = dead_air_score(post)
    penalty_points, penalty_reasons = discipline_penalty(post)

    script_score = min(max(parse_number(post.get("Script_Execution_15", 0)) / 15 * 5, 0), 5)
    teamwork_score = min(max(parse_number(post.get("Teamwork_Handover_5", 0)) / 5 * 2.5, 0), 2.5)
    sample_score = min(max(parse_number(post.get("Sample_Care_5", 0)) / 5 * 2.5, 0), 2.5)
    execution_score = round(script_score + teamwork_score + sample_score, 2)

    gmv_points = score_band(
        eligible_gmv / live_hours if live_hours > 0 else 0.0,
        [
            (20_000_000, 30),
            (10_000_000, 24),
            (3_000_000, 18),
            (1_000_000, 12),
            (1, 6),
        ],
    )
    order_points = score_band(
        orders_per_minute,
        [(0.12, 20), (0.08, 16), (0.04, 12), (0.02, 8), (0.0001, 4)],
    )
    viewer_points = score_band(
        viewer_signal,
        [(300, 15), (200, 12), (100, 9), (50, 6), (0.0001, 3)],
    )
    ctr_points = score_band(
        cart_ctr,
        [(0.08, 10), (0.05, 8), (0.03, 6), (0.015, 4), (0.0001, 2)],
    )

    total_before_penalty = round(gmv_points + order_points + dead_air_points + viewer_points + ctr_points + execution_score, 1)
    total = max(0.0, round(total_before_penalty - penalty_points, 1))

    if total >= 85:
        proposed_tier = "S"
    elif total >= 70:
        proposed_tier = "A"
    elif total >= 55:
        proposed_tier = "B"
    elif total >= 40:
        proposed_tier = "C"
    else:
        proposed_tier = "Thử việc"

    confidence = "high"
    if post_match_mode != "exact-session-id" or viewer_source != "explicit-viewer-column":
        confidence = "medium"
    if viewer_source == "missing" or post_match_mode != "exact-session-id":
        confidence = "low"

    metrics = {
        "live_minutes": live_minutes,
        "live_hours": live_hours,
        "gross_gmv": round(gross_gmv),
        "returned_gmv": round(returned_gmv),
        "eligible_gmv": round(eligible_gmv),
        "gmv_per_hour": round((eligible_gmv / live_hours) if live_hours > 0 else 0),
        "gmv_per_hour_display": f"{round((eligible_gmv / live_hours) if live_hours > 0 else 0):,}".replace(",", ".") + "₫",
        "orders_used": round(used_orders, 2),
        "orders_per_minute": orders_per_minute,
        "viewer_signal": viewer_signal,
        "viewer_signal_display": round(viewer_signal, 2),
        "cart_ctr": cart_ctr,
        "cart_ctr_display": f"{cart_ctr * 100:.2f}%",
        "execution_score": execution_score,
    }

    strengths = build_strengths(metrics, viewer_source)
    weaknesses = build_weaknesses(metrics, dead_air_signals, penalty_reasons, viewer_source)
    hr_recommendation = recommendation(host["grade"], proposed_tier)

    return {
        "success": True,
        "status": "dry-run",
        "spreadsheet_id": spreadsheet_id,
        "source_row_number": source_row_number,
        "post_live_row_number": post_row_number,
        "post_live_match_mode": post_match_mode,
        "session_id": session.get("Session_ID", ""),
        "tiktok_live_id": session.get("TikTok_Live_ID", ""),
        "session_date": start_at.strftime("%Y-%m-%d"),
        "host_id": host["id"],
        "host_name": host["name"],
        "current_grade": host["grade"],
        "metrics": metrics,
        "score_breakdown": {
            "gmv_per_hour": gmv_points,
            "orders_per_minute": order_points,
            "dead_air_signal": dead_air_points,
            "viewer_signal": viewer_points,
            "cart_ctr": ctr_points,
            "post_live_execution": execution_score,
            "discipline_penalty": penalty_points,
        },
        "signals": {
            "dead_air": dead_air_signals,
            "discipline_penalty_reasons": penalty_reasons,
            "viewer_source": viewer_source,
        },
        "total_before_penalty": total_before_penalty,
        "total_score": total,
        "proposed_tier": proposed_tier,
        "grade_review_proposal": {
            "grade_de_xuat": proposed_tier,
            "hieu_nang_gmv_gio": round((eligible_gmv / live_hours) if live_hours > 0 else 0),
            "khuyen_nghi_hr": f"{hr_recommendation} | Review phiên {session.get('Session_ID', '')} | Điểm {total}",
        },
        "portfolio_proposal": {
            "uu_diem": strengths,
            "nhuoc_diem": weaknesses,
        },
        "strengths": strengths,
        "weaknesses": weaknesses,
        "confidence": confidence,
        "notes": [
            "Average-viewer signal may be estimated because the checked TikTok_Sales_Import sample did not expose a clear explicit viewer column.",
            "Dead-air is inferred from Post_Live_Report signals; no direct dead-air minutes were available in the checked sample.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spreadsheet-id", default=DEFAULT_SPREADSHEET_ID)
    parser.add_argument("--session-id")
    parser.add_argument("--live-id")
    parser.add_argument("--row-number", type=int)
    args = parser.parse_args()

    try:
        payload = evaluate_session(
            spreadsheet_id=args.spreadsheet_id,
            session_id=args.session_id,
            live_id=args.live_id,
            row_number=args.row_number,
        )
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
