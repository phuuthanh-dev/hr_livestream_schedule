#!/usr/bin/env python3
"""Calculate one livestream session payroll from Google Sheets via gws."""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
import unicodedata
from datetime import datetime
from typing import Any

DEFAULT_SPREADSHEET_ID = "1x6nVWbe1v80Px4UVRYciOwFJYNdEF8f6LC4gKGbgclw"
DEFAULT_TIKTOK_RANGE = "TikTok_Sales_Import!A1:AZ5000"
DEFAULT_BASE_RANGE = "Base_Salary_Card!A1:F100"
DEFAULT_PORTFOLIO_RANGE = "Portfolio_Master!A1:AZ2000"
DEFAULT_SUPPORT_RANGE = "Support_Master!A1:AZ2000"
PIT_RATE = 0.10


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


def canonical_text(value: Any) -> str:
    text = normalize_text(value).lower()
    text = text.normalize("NFD") if hasattr(text, "normalize") else text
    return (
        text.replace("đ", "d")
        .replace("_", " ")
        .replace("-", " ")
        .strip()
    )


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


def meaningful_support_id(value: str) -> bool:
    lowered = normalize_header(value)
    return lowered not in {"", "no support", "no_support", "trong", "trống"}


def normalize_support_level(value: Any) -> str:
    text = normalize_text(value)
    if text.startswith("Cấp"):
        return text
    match = re.search(r"(\d+)", text)
    return f"Cấp {match.group(1)}" if match else "Cấp 1"


def normalize_host_grade(value: Any) -> str:
    text = normalize_text(value)
    if not text:
        return "Thử việc"
    lowered = normalize_header(text)
    if "thử" in lowered or "thu viec" in lowered:
        return "Thử việc"
    return text.split()[0].upper()


def extract_rate_card(rows: list[list[str]]) -> dict[str, Any]:
    card: dict[str, Any] = {"HOST": {}, "SUPPORT": {}, "TIERS": []}
    section = "HOST"
    for row in rows:
        col_a = normalize_text(row[0] if row else "")
        marker = normalize_header(col_a)
        if not marker:
            continue
        if "host" in marker and "thang bang luong" in marker:
            section = "HOST"
            continue
        if "support" in marker and "thang bang luong" in marker:
            section = "SUPPORT"
            continue
        if "doanh thu gmv" in marker:
            section = "GMV"
            continue
        if marker.startswith("ma cap do") or marker.startswith("mã cấp độ") or "tieu chi kpi" in marker or "ty le hoa hong" in marker or "ti le hoa hong" in marker or "nhiem vu" in marker:
            continue
        if section == "HOST":
            card["HOST"][normalize_host_grade(col_a)] = {
                "hourly_rate": round(parse_currency(row[2] if len(row) > 2 else 0)),
                "commission_rate": parse_percent(row[3] if len(row) > 3 else 0),
                "note": normalize_text(row[4] if len(row) > 4 else ""),
            }
        elif section == "SUPPORT":
            card["SUPPORT"][normalize_support_level(col_a)] = {
                "hourly_rate": round(parse_currency(row[2] if len(row) > 2 else 0)),
                "commission_rate": 0.0,
                "note": normalize_text(row[3] if len(row) > 3 else ""),
            }
        elif section == "GMV":
            threshold = round(parse_currency(row[0] if len(row) > 0 else 0))
            rate = parse_percent(row[1] if len(row) > 1 else 0)
            if threshold > 0:
                card["TIERS"].append({"minimum_gmv": threshold, "commission_rate": rate})
    card["TIERS"].sort(key=lambda item: item["minimum_gmv"])
    return card


def resolve_tier_rate(eligible_gmv: float, tiers: list[dict[str, Any]]) -> float:
    matched = 0.0
    for tier in tiers:
        if eligible_gmv >= tier["minimum_gmv"]:
            matched = tier["commission_rate"]
    return matched


def resolve_host_rate(card: dict[str, Any], grade: str, eligible_gmv: float) -> dict[str, Any]:
    config = card["HOST"].get(normalize_host_grade(grade))
    if not config:
        raise ValueError(f"Không tìm thấy Host rate cho grade: {grade}")
    note = normalize_header(config.get("note", ""))
    tier_rate = resolve_tier_rate(eligible_gmv, card["TIERS"])
    use_tier = tier_rate > 0 and ("theo doanh thu" in note or "rank doanh thu" in note or config.get("commission_rate", 0) == 0)
    return {
        "hourly_rate": int(config["hourly_rate"]),
        "commission_rate": tier_rate if use_tier else float(config["commission_rate"]),
        "mode": "gmv-tier" if use_tier else "fixed",
        "note": config.get("note", ""),
    }


def resolve_support_rate(card: dict[str, Any], level: str) -> dict[str, Any]:
    config = card["SUPPORT"].get(normalize_support_level(level))
    if not config:
        raise ValueError(f"Không tìm thấy Support rate cho level: {level}")
    return {
        "hourly_rate": int(config["hourly_rate"]),
        "commission_rate": 0.0,
        "mode": "none",
        "note": config.get("note", ""),
    }


def resolve_session(
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
        raise ValueError("Không tìm thấy session/live tương ứng trong TikTok_Sales_Import.")
    if len(matches) > 1:
        raise ValueError("Tìm thấy nhiều dòng trùng khóa; cần chỉ rõ row-number.")
    return matches[0]


def build_people_map(rows: list[list[str]], role: str) -> dict[str, dict[str, str]]:
    if not rows:
        return {}
    headers = rows[0]
    if role == "host":
        id_index = find_index(headers, "Streamer_ID", "Mã nhân viên")
        name_index = find_index(headers, "Full_Name", "Họ và tên")
        grade_index = find_index(headers, "Entry_Grade", "Grade", "Level")
    else:
        id_index = find_index(headers, "Support_ID", "Mã Support")
        name_index = find_index(headers, "Họ Và Tên", "Full_Name")
        grade_index = find_index(headers, "Cấp Độ / Level", "Level", "Cấp Độ")
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
        }
    return result


def round_currency(value: float) -> int:
    return int(round(value))


def build_pay_line(
    *,
    role: str,
    person: dict[str, str],
    rate: dict[str, Any],
    live_hours: float,
    eligible_gmv: float,
) -> dict[str, Any]:
    base_pay = round_currency(live_hours * rate["hourly_rate"])
    commission_rate = float(rate["commission_rate"])
    commission_pay = round_currency(eligible_gmv * commission_rate) if role == "host" else 0
    gross_pay = base_pay + commission_pay
    pit = round_currency(gross_pay * PIT_RATE)
    return {
        "employee_id": person["id"],
        "employee_name": person["name"],
        "grade": person["grade"],
        "hourly_rate": rate["hourly_rate"],
        "commission_mode": rate["mode"],
        "commission_rate": commission_rate,
        "base_pay": base_pay,
        "commission_pay": commission_pay,
        "gross_pay": gross_pay,
        "pit": pit,
        "net_pay": gross_pay - pit,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spreadsheet-id", default=DEFAULT_SPREADSHEET_ID)
    parser.add_argument("--session-id")
    parser.add_argument("--live-id")
    parser.add_argument("--row-number", type=int)
    args = parser.parse_args()

    try:
        tiktok_rows = gws_values_get(args.spreadsheet_id, DEFAULT_TIKTOK_RANGE)
        base_rows = gws_values_get(args.spreadsheet_id, DEFAULT_BASE_RANGE)
        portfolio_rows = gws_values_get(args.spreadsheet_id, DEFAULT_PORTFOLIO_RANGE)
        support_rows = gws_values_get(args.spreadsheet_id, DEFAULT_SUPPORT_RANGE)

        row_number, session = resolve_session(
            tiktok_rows,
            session_id=args.session_id,
            live_id=args.live_id,
            row_number=args.row_number,
        )

        host_ids = split_ids(session.get("Host_ID", ""))
        support_ids = [item for item in split_ids(session.get("Support_ID", "")) if meaningful_support_id(item)]

        validations: list[str] = []
        if len(host_ids) != 1:
            raise ValueError(f"Dòng payroll phải có đúng 1 Host_ID, nhận được: {host_ids or 'trống'}")
        if len(support_ids) > 1:
            raise ValueError(f"Dòng payroll phải có tối đa 1 Support_ID, nhận được: {support_ids}")

        start_at = parse_datetime(session.get("Start_Time", ""))
        end_at = parse_datetime(session.get("End_Time", ""))
        if end_at <= start_at:
            raise ValueError("End_Time phải lớn hơn Start_Time.")
        live_hours = round((end_at - start_at).total_seconds() / 3600, 2)
        gross_gmv = round_currency(parse_currency(session.get("Gross_GMV", 0)))
        returned_gmv = round_currency(parse_currency(session.get("Returned_GMV", 0)))
        eligible_gmv = max(0, gross_gmv - returned_gmv)

        rate_card = extract_rate_card(base_rows)
        host_map = build_people_map(portfolio_rows, "host")
        support_map = build_people_map(support_rows, "support")

        host_id = host_ids[0].upper()
        host_person = host_map.get(host_id)
        if not host_person:
            raise ValueError(f"Host_ID không có trong Portfolio_Master: {host_id}")
        host_rate = resolve_host_rate(rate_card, host_person["grade"], eligible_gmv)
        host_line = build_pay_line(
            role="host",
            person=host_person,
            rate=host_rate,
            live_hours=live_hours,
            eligible_gmv=eligible_gmv,
        )
        validations.append("Host_ID đã đối chiếu với Portfolio_Master.")
        validations.append("Giờ live lấy từ Start_Time và End_Time thực tế trên TikTok_Sales_Import.")
        validations.append("GMV dùng để tính lương là Gross_GMV - Returned_GMV.")

        support_line = None
        if support_ids:
            support_id = support_ids[0].upper()
            support_person = support_map.get(support_id)
            if not support_person:
                raise ValueError(f"Support_ID không có trong Support_Master: {support_id}")
            support_rate = resolve_support_rate(rate_card, support_person["grade"])
            support_line = build_pay_line(
                role="support",
                person=support_person,
                rate=support_rate,
                live_hours=live_hours,
                eligible_gmv=eligible_gmv,
            )
            validations.append("Support_ID đã đối chiếu với Support_Master.")
        else:
            validations.append("Ca này không có Support payout.")

        payload = {
            "success": True,
            "status": "dry-run",
            "spreadsheet_id": args.spreadsheet_id,
            "source_row_number": row_number,
            "session_id": session.get("Session_ID", ""),
            "tiktok_live_id": session.get("TikTok_Live_ID", ""),
            "account_id": session.get("Account_ID", ""),
            "start_time": session.get("Start_Time", ""),
            "end_time": session.get("End_Time", ""),
            "live_hours": live_hours,
            "gross_gmv": gross_gmv,
            "returned_gmv": returned_gmv,
            "eligible_gmv": eligible_gmv,
            "host": host_line,
            "support": support_line,
            "validations": validations,
            "notes": [
                "A/S Host grades use GMV tiers when the note on Base_Salary_Card says Theo Doanh thu.",
                "Net pay is gross pay minus 10% PIT.",
            ],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
