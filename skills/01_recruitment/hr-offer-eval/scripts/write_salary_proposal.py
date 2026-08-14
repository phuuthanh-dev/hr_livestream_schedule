#!/usr/bin/env python3
"""Dry-run-first writer for column H (`Lương thỏa thuận`) in `Thông tin Mẫu Live`."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys

from lookup_offer_candidate import (
    DEFAULT_RANGE,
    DEFAULT_SPREADSHEET_ID,
    DEFAULT_TAB,
    TARGET_HEADER,
    build_candidate_context,
    clean_gws_text,
)


def gws_values_update(spreadsheet_id: str, range_a1: str, value: str) -> dict:
    body = {"majorDimension": "ROWS", "values": [[value]]}
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spreadsheet-id", default=DEFAULT_SPREADSHEET_ID)
    parser.add_argument("--tab", default=DEFAULT_TAB)
    parser.add_argument("--range", dest="range_a1", default=DEFAULT_RANGE)
    parser.add_argument("--employee-id")
    parser.add_argument("--row-number", type=int)
    parser.add_argument("--value", required=True, help="Exact text to write into column H.")
    parser.add_argument("--apply", action="store_true", help="Actually write to the sheet.")
    args = parser.parse_args()

    value = args.value.strip()
    if not value:
        print(json.dumps({"success": False, "error": "--value cannot be empty."}, ensure_ascii=False, indent=2))
        sys.exit(1)

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

    target_cell = context["target_cell"]
    target_range = f"'{args.tab}'!{target_cell}"
    plan = {
        "success": True,
        "status": "apply" if args.apply else "dry-run",
        "target_header": TARGET_HEADER,
        "target_range": target_range,
        "employee_id": context["candidate"].get("Mã nhân viên", ""),
        "employee_name": context["candidate"].get("Họ và tên đầy đủ", "") or context["candidate"].get("Tên gọi khác", ""),
        "row_number": context["row_number"],
        "current_value": context["current_value"],
        "proposed_value": value,
        "will_overwrite": bool(str(context["current_value"]).strip()),
    }

    if not args.apply:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return

    try:
        response = gws_values_update(args.spreadsheet_id, target_range, value)
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"success": False, "error": str(error), **plan}, ensure_ascii=False, indent=2))
        sys.exit(1)

    print(json.dumps({**plan, "response": response}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
