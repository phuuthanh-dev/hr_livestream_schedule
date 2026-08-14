#!/usr/bin/env python3
"""Read one candidate row from `Thông tin Mẫu Live` via gws and return JSON."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from typing import Any

DEFAULT_SPREADSHEET_ID = "12WU5jM-KC9EngkA_xBS3U82KYnO-8RMwGwk9fwcGe3o"
DEFAULT_TAB = "Thông tin Mẫu Live"
DEFAULT_RANGE = f"{DEFAULT_TAB}!A1:Z1200"
EMPLOYEE_ID_HEADER = "Mã nhân viên"
TARGET_HEADER = "Lương thỏa thuận"


def clean_gws_text(text: str) -> str:
    return "\n".join(line for line in text.splitlines() if not line.startswith("Using keyring backend"))


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


def normalize_header(value: str) -> str:
    return str(value or "").strip().lower()


def find_header_index(headers: list[str], header_name: str) -> int:
    target = normalize_header(header_name)
    for index, header in enumerate(headers):
        if normalize_header(header) == target:
            return index
    raise KeyError(f"Missing required header: {header_name}")


def row_to_dict(headers: list[str], row: list[str]) -> dict[str, str]:
    padded = row + [""] * max(0, len(headers) - len(row))
    return {header: padded[index] for index, header in enumerate(headers)}


def parse_bool(value: str) -> bool | None:
    normalized = str(value or "").strip().upper()
    if normalized in {"TRUE", "YES", "Y", "1"}:
        return True
    if normalized in {"FALSE", "NO", "N", "0"}:
        return False
    return None


def parse_follow_count(value: str) -> int | None:
    digits = re.sub(r"[^\d]", "", str(value or ""))
    return int(digits) if digits else None


def normalize_experience(value: str) -> str:
    normalized = str(value or "").strip().lower()
    if normalized == "có":
        return "experienced"
    if normalized == "không":
        return "no-experience"
    return "unknown"


def infer_lane(candidate: dict[str, str]) -> dict[str, Any]:
    personal_flag = parse_bool(candidate.get("Live tk cá nhân", ""))
    company_flag = parse_bool(candidate.get("Live tk công ty", ""))
    follow_count = parse_follow_count(candidate.get("Lượt follow", ""))
    live_channel_id = str(candidate.get("Live_Channel_Id", "")).strip()

    if personal_flag and (company_flag or live_channel_id):
        account_mode = "mixed"
    elif personal_flag or follow_count is not None:
        account_mode = "personal-account"
    elif company_flag or live_channel_id:
        account_mode = "company-account"
    else:
        account_mode = "unknown"

    follow_bucket = None
    if follow_count is not None:
        if follow_count < 10_000:
            follow_bucket = "nano"
        elif follow_count <= 50_000:
            follow_bucket = "micro"
        elif follow_count < 100_000:
            follow_bucket = "micro-macro-gap"
        elif follow_count <= 500_000:
            follow_bucket = "macro"
        elif follow_count > 1_000_000:
            follow_bucket = "top-creator"
        else:
            follow_bucket = "macro-top-gap"

    return {
        "account_mode": account_mode,
        "employment_model_default": "freelance" if account_mode in {"company-account", "mixed"} else None,
        "employment_model_default_reason": (
            "Defaulted to freelance because `Thông tin Mẫu Live` does not expose a dedicated Full-time/Freelance column."
            if account_mode in {"company-account", "mixed"}
            else None
        ),
        "follow_count": follow_count,
        "follow_bucket": follow_bucket,
        "experience_bucket": normalize_experience(candidate.get("Kinh nghiệm", "")),
        "training_completed": parse_bool(candidate.get("Đã tham gia training", "")),
    }


def resolve_candidate(
    rows: list[list[str]],
    *,
    employee_id: str | None,
    row_number: int | None,
) -> tuple[list[str], int, dict[str, str]]:
    if not rows:
        raise RuntimeError("The requested range is empty.")

    headers = rows[0]
    if row_number is not None:
        if row_number < 2:
            raise ValueError("Row number must point to a data row (>= 2).")
        offset = row_number - 1
        if offset >= len(rows):
            raise ValueError(f"Row {row_number} is outside the fetched range.")
        return headers, row_number, row_to_dict(headers, rows[offset])

    if not employee_id:
        raise ValueError("Provide either --employee-id or --row-number.")

    employee_index = find_header_index(headers, EMPLOYEE_ID_HEADER)
    matches: list[tuple[int, dict[str, str]]] = []
    for current_row_number, row in enumerate(rows[1:], start=2):
        value = row[employee_index] if employee_index < len(row) else ""
        if str(value).strip().upper() == employee_id.strip().upper():
            matches.append((current_row_number, row_to_dict(headers, row)))

    if not matches:
        raise ValueError(f"Employee ID not found: {employee_id}")
    if len(matches) > 1:
        raise ValueError(f"Employee ID appears multiple times: {employee_id}")
    match_row_number, candidate = matches[0]
    return headers, match_row_number, candidate


def build_candidate_context(
    *,
    spreadsheet_id: str,
    tab: str,
    range_a1: str,
    employee_id: str | None = None,
    row_number: int | None = None,
) -> dict[str, Any]:
    rows = gws_values_get(spreadsheet_id, range_a1)
    headers, resolved_row_number, candidate = resolve_candidate(
        rows, employee_id=employee_id, row_number=row_number
    )
    target_index = find_header_index(headers, TARGET_HEADER)
    normalized = infer_lane(candidate)
    return {
        "spreadsheet_id": spreadsheet_id,
        "tab": tab,
        "row_number": resolved_row_number,
        "target_cell": f"{chr(65 + target_index)}{resolved_row_number}" if target_index < 26 else f"H{resolved_row_number}",
        "target_header": TARGET_HEADER,
        "current_value": candidate.get(TARGET_HEADER, ""),
        "candidate": candidate,
        "normalized": normalized,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spreadsheet-id", default=DEFAULT_SPREADSHEET_ID)
    parser.add_argument("--tab", default=DEFAULT_TAB)
    parser.add_argument("--range", dest="range_a1", default=DEFAULT_RANGE)
    parser.add_argument("--employee-id")
    parser.add_argument("--row-number", type=int)
    args = parser.parse_args()

    try:
        context = build_candidate_context(
            spreadsheet_id=args.spreadsheet_id,
            tab=args.tab,
            range_a1=args.range_a1,
            employee_id=args.employee_id,
            row_number=args.row_number,
        )
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False, indent=2))
        sys.exit(1)

    print(json.dumps({"success": True, **context}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
