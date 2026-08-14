#!/usr/bin/env python3
"""Dry-run-first writer for live-session-eval proposals."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys

from evaluate_live_session import (
    DEFAULT_SPREADSHEET_ID,
    PORTFOLIO_RANGE,
    evaluate_session,
    gws_values_get,
    normalize_header,
    normalize_text,
)

GRADE_REVIEW_RANGE = "Grade_Review!A1:AZ2000"


def clean_gws_text(text: str) -> str:
    return "\n".join(line for line in text.splitlines() if not line.startswith("Using keyring"))


def find_col(headers: list[str], *candidates: str) -> int:
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


def a1_col(index: int) -> str:
    value = index + 1
    letters: list[str] = []
    while value > 0:
        value, remainder = divmod(value - 1, 26)
        letters.append(chr(65 + remainder))
    return "".join(reversed(letters))


def gws_values_update(spreadsheet_id: str, range_a1: str, values: list[list[str]]) -> dict:
    body = {"majorDimension": "ROWS", "values": values}
    result = subprocess.run(
        [
            "gws",
            "sheets",
            "spreadsheets",
            "values",
            "update",
            "--params",
            json.dumps(
                {
                    "spreadsheetId": spreadsheet_id,
                    "range": range_a1,
                    "valueInputOption": "USER_ENTERED",
                },
                ensure_ascii=False,
            ),
            "--json",
            json.dumps(body, ensure_ascii=False),
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(clean_gws_text(result.stderr or result.stdout))
    return json.loads(clean_gws_text(result.stdout) or "{}")


def row_map(rows: list[list[str]], id_headers: tuple[str, ...]) -> tuple[list[str], dict[str, tuple[int, list[str]]]]:
    headers = rows[0]
    id_index = find_col(headers, *id_headers)
    mapping: dict[str, tuple[int, list[str]]] = {}
    for row_number, row in enumerate(rows[1:], start=2):
        if not row:
            continue
        employee_id = normalize_text(row[id_index] if id_index < len(row) else "").upper()
        if employee_id:
            mapping[employee_id] = (row_number, row)
    return headers, mapping


def merge_note(existing: str, tag: str, new_value: str) -> str:
    existing = normalize_text(existing)
    snippet = f"[{tag}] {new_value}".strip()
    if not existing:
        return snippet
    if snippet in existing:
        return existing
    return f"{existing} | {snippet}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spreadsheet-id", default=DEFAULT_SPREADSHEET_ID)
    parser.add_argument("--session-id")
    parser.add_argument("--live-id")
    parser.add_argument("--row-number", type=int)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    try:
        evaluation = evaluate_session(
            spreadsheet_id=args.spreadsheet_id,
            session_id=args.session_id,
            live_id=args.live_id,
            row_number=args.row_number,
        )

        grade_review_rows = gws_values_get(args.spreadsheet_id, GRADE_REVIEW_RANGE)
        portfolio_rows = gws_values_get(args.spreadsheet_id, PORTFOLIO_RANGE)
        grade_headers, grade_map = row_map(grade_review_rows, ("Mã Nhân Sự (ID)", "Mã nhân viên"))
        portfolio_headers, portfolio_map = row_map(portfolio_rows, ("Streamer_ID", "Mã nhân viên"))

        host_id = evaluation["host_id"].upper()
        if host_id not in grade_map:
            raise ValueError(f"Host {host_id} chưa có dòng sẵn trong Grade_Review; writer không tự append.")
        if host_id not in portfolio_map:
            raise ValueError(f"Host {host_id} không có trong Portfolio_Master.")

        grade_row_number, grade_row = grade_map[host_id]
        portfolio_row_number, portfolio_row = portfolio_map[host_id]

        grade_proposal = evaluation["grade_review_proposal"]
        portfolio_proposal = evaluation["portfolio_proposal"]
        session_tag = f"{evaluation['session_date']} {evaluation['session_id']}"

        grade_targets = {
            "grade": find_col(grade_headers, "Grade Đề Xuất"),
            "performance": find_col(grade_headers, "Hiệu Năng (GMV/Giờ)", "Hiệu Năng"),
            "recommendation": find_col(grade_headers, "Khuyến Nghị HR"),
        }
        portfolio_targets = {
            "strengths": find_col(portfolio_headers, "Ưu điểm"),
            "weaknesses": find_col(portfolio_headers, "Nhược điểm"),
        }

        grade_values = [""] * (max(grade_targets.values()) + 1)
        grade_values[grade_targets["grade"]] = grade_proposal["grade_de_xuat"]
        grade_values[grade_targets["performance"]] = str(grade_proposal["hieu_nang_gmv_gio"])
        grade_values[grade_targets["recommendation"]] = grade_proposal["khuyen_nghi_hr"]

        existing_strengths = portfolio_row[portfolio_targets["strengths"]] if portfolio_targets["strengths"] < len(portfolio_row) else ""
        existing_weaknesses = portfolio_row[portfolio_targets["weaknesses"]] if portfolio_targets["weaknesses"] < len(portfolio_row) else ""
        merged_strengths = merge_note(existing_strengths, session_tag, portfolio_proposal["uu_diem"])
        merged_weaknesses = merge_note(existing_weaknesses, session_tag, portfolio_proposal["nhuoc_diem"])

        portfolio_values = [""] * (max(portfolio_targets.values()) + 1)
        portfolio_values[portfolio_targets["strengths"]] = merged_strengths
        portfolio_values[portfolio_targets["weaknesses"]] = merged_weaknesses

        grade_start = min(grade_targets.values())
        grade_end = max(grade_targets.values())
        portfolio_start = min(portfolio_targets.values())
        portfolio_end = max(portfolio_targets.values())

        plan = {
            "success": True,
            "status": "apply" if args.apply else "dry-run",
            "session_id": evaluation["session_id"],
            "host_id": evaluation["host_id"],
            "grade_review": {
                "row_number": grade_row_number,
                "range": f"Grade_Review!{a1_col(grade_start)}{grade_row_number}:{a1_col(grade_end)}{grade_row_number}",
                "values": grade_values[grade_start:grade_end + 1],
            },
            "portfolio_master": {
                "row_number": portfolio_row_number,
                "range": f"Portfolio_Master!{a1_col(portfolio_start)}{portfolio_row_number}:{a1_col(portfolio_end)}{portfolio_row_number}",
                "values": portfolio_values[portfolio_start:portfolio_end + 1],
                "will_append_strengths": bool(normalize_text(existing_strengths)),
                "will_append_weaknesses": bool(normalize_text(existing_weaknesses)),
            },
        }

        if not args.apply:
            print(json.dumps(plan, ensure_ascii=False, indent=2))
            return

        grade_response = gws_values_update(
            args.spreadsheet_id,
            plan["grade_review"]["range"],
            [plan["grade_review"]["values"]],
        )
        portfolio_response = gws_values_update(
            args.spreadsheet_id,
            plan["portfolio_master"]["range"],
            [plan["portfolio_master"]["values"]],
        )
        print(json.dumps({**plan, "responses": {"grade_review": grade_response, "portfolio_master": portfolio_response}}, ensure_ascii=False, indent=2))
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
