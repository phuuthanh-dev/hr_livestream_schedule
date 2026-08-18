#!/usr/bin/env python3
"""grade-review-sync — gom kết quả review từ livestream-host-grade-review về sheet Grade_Review.

Đọc `metrics.json` (output của local program `livestream_host_grade_review`),
đối chiếu sheet `Grade_Review` + `Portfolio_Master` trong master spreadsheet,
và đề xuất (dry-run) hoặc ghi (--apply):

  Grade_Review  : thêm/cập nhật 4 cột KHÔNG đụng các cột định lượng cũ:
                  "Điểm Review (Transcript)", "Rank Review (Transcript)",
                  "Ưu Điểm", "Nhược Điểm"
  Portfolio_Master: append ưu/nhược điểm (chỉ khi cột đã tồn tại, cùng policy
                  với writer live-session-eval; không tự tạo cột)

Nguyên tắc an toàn:
- Dry-run là mặc định; --apply chỉ chạy khi được duyệt rõ ràng.
- Không append dòng mới: host chưa có dòng trong Grade_Review -> hold.
- Không ghi đè Grade Đề Xuất / Hiệu Năng / Khuyến Nghị HR (thuộc luồng
  định lượng live-session-eval).

Usage:
  python3 sync_grade_review.py --metrics /path/to/metrics.json [--apply]
      [--spreadsheet-id ID] [--tag "grade-review 2026-08-18"] [--out DIR]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys

DEFAULT_SPREADSHEET_ID = "1x6nVWbe1v80Px4UVRYciOwFJYNdEF8f6LC4gKGbgclw"
GRADE_REVIEW_RANGE = "Grade_Review!A1:AZ2000"
PORTFOLIO_RANGE = "Portfolio_Master!A1:AZ2000"

NEW_GRADE_COLUMNS = [
    "Điểm Review (Transcript)",
    "Rank Review (Transcript)",
    "Ưu Điểm",
    "Nhược Điểm",
]
ID_HEADER_CANDIDATES = ("mã nhân sự (id)", "mã nhân sự", "mã nhân viên", "streamer_id")


def clean_gws_text(text: str) -> str:
    return "\n".join(line for line in text.splitlines() if not line.startswith("Using keyring"))


def gws_values_get(spreadsheet_id: str, range_a1: str) -> list[list[str]]:
    result = subprocess.run(
        ["gws", "sheets", "spreadsheets", "values", "get", "--params",
         json.dumps({"spreadsheetId": spreadsheet_id, "range": range_a1}, ensure_ascii=False)],
        capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(f"gws values get failed: {result.stderr.strip()[:400]}")
    payload = json.loads(clean_gws_text(result.stdout))
    return payload.get("values", [])


def gws_values_update(spreadsheet_id: str, range_a1: str, values: list[list]) -> dict:
    result = subprocess.run(
        ["gws", "sheets", "spreadsheets", "values", "update", "--params",
         json.dumps({"spreadsheetId": spreadsheet_id, "range": range_a1,
                     "valueInputOption": "USER_ENTERED"}, ensure_ascii=False),
         "--json", json.dumps({"values": values}, ensure_ascii=False)],
        capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(f"gws values update failed: {result.stderr.strip()[:400]}")
    try:
        return json.loads(clean_gws_text(result.stdout))
    except json.JSONDecodeError:
        return {"raw": clean_gws_text(result.stdout)[:200]}


def normalize_header(value) -> str:
    return (re.sub(r"\s+", " ", str(value or "")).strip().lower()
            .replace("(", "").replace(")", ""))


def normalize_text(value) -> str:
    return str(value or "").strip()


def a1_col(index: int) -> str:
    value = index + 1
    letters = []
    while value > 0:
        value, rem = divmod(value - 1, 26)
        letters.append(chr(65 + rem))
    return "".join(reversed(letters))


def find_col(headers: list[str], *candidates: str) -> int:
    norm = [normalize_header(h) for h in headers]
    for cand in candidates:
        target = normalize_header(cand)
        for i, h in enumerate(norm):
            if h == target:
                return i
    for cand in candidates:
        target = normalize_header(cand)
        for i, h in enumerate(norm):
            if target in h:
                return i
    raise KeyError(f"Missing header: {' / '.join(candidates)}")


def find_col_optional(headers: list[str], *candidates: str) -> int:
    try:
        return find_col(headers, *candidates)
    except KeyError:
        return -1


def row_map(rows: list[list[str]], id_candidates: tuple[str, ...]):
    if not rows:
        return [], {}
    headers = rows[0]
    mapping = {}
    for number, row in enumerate(rows[1:], start=2):
        for cand in id_candidates:
            idx = find_col_optional(headers, cand)
            if idx == -1 or idx >= len(row):
                continue
            key = normalize_text(row[idx]).upper()
            if key and key not in mapping:
                mapping[key] = (number, row)
            break
    return headers, mapping


def merge_note(existing: str, tag: str, snippet: str) -> str:
    existing = normalize_text(existing)
    snippet = normalize_text(snippet)
    if not snippet:
        return existing
    stamped = f"[{tag}] {snippet}"
    if not existing:
        return stamped
    return f"{existing} | {stamped}"


def load_metrics(path: str) -> list[dict]:
    data = json.load(open(path, encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("hosts", [])
    usable = []
    for entry in data:
        hr_id = normalize_text(entry.get("hr_id")).upper()
        if not hr_id:
            continue
        if entry.get("sessions_analyzed", 0) <= 0:
            continue
        usable.append(entry)
    return usable


def bullets_text(entry: dict, key: str) -> str:
    bullets = [normalize_text(b) for b in entry.get(key, []) if normalize_text(b)]
    return " • ".join(bullets)


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync host grade review results into Grade_Review sheet")
    parser.add_argument("--metrics", required=True, help="metrics.json từ livestream-host-grade-review")
    parser.add_argument("--spreadsheet-id", default=DEFAULT_SPREADSHEET_ID)
    parser.add_argument("--tag", default=f"grade-review {dt.date.today().isoformat()}")
    parser.add_argument("--out", help="thư mục ghi sync_plan.json + report.md (tuỳ chọn)")
    parser.add_argument("--apply", action="store_true", help="ghi thật; mặc định dry-run")
    args = parser.parse_args()

    metrics = load_metrics(args.metrics)
    if not metrics:
        print("Không có host hợp lệ trong metrics.json (cần hr_id + sessions_analyzed > 0).")
        sys.exit(1)

    grade_rows = gws_values_get(args.spreadsheet_id, GRADE_REVIEW_RANGE)
    portfolio_rows = gws_values_get(args.spreadsheet_id, PORTFOLIO_RANGE)
    grade_headers, grade_map = row_map(grade_rows, ID_HEADER_CANDIDATES)
    portfolio_headers, portfolio_map = row_map(portfolio_rows, ID_HEADER_CANDIDATES)
    if not grade_headers:
        raise RuntimeError("Grade_Review trống hoặc không đọc được.")

    # vị trí cột mới: dùng cột sẵn nếu có, không thì nối sau header cuối
    next_free = len(grade_headers)
    new_col_idx: dict[str, int] = {}
    for col in NEW_GRADE_COLUMNS:
        idx = find_col_optional(grade_headers, col)
        if idx == -1:
            idx = next_free
            next_free += 1
        new_col_idx[col] = idx
    headers_to_add = {col: idx for col, idx in new_col_idx.items()
                      if idx >= len(grade_headers)}

    pf_strength_idx = find_col_optional(portfolio_headers, "ưu điểm")
    pf_weakness_idx = find_col_optional(portfolio_headers, "nhược điểm")

    plan_rows, holds = [], []
    for entry in sorted(metrics, key=lambda e: normalize_text(e.get("hr_id"))):
        hr_id = normalize_text(entry.get("hr_id")).upper()
        if hr_id not in grade_map:
            holds.append({"hr_id": hr_id, "reason": "chưa có dòng trong Grade_Review; không tự append"})
            continue
        row_number, _row = grade_map[hr_id]

        score = entry.get("total_score", "")
        rank = entry.get("suggested_rank", "")
        strengths = bullets_text(entry, "bullets_good")
        weaknesses = bullets_text(entry, "bullets_bad")

        cells = {new_col_idx["Điểm Review (Transcript)"]: score,
                 new_col_idx["Rank Review (Transcript)"]: rank,
                 new_col_idx["Ưu Điểm"]: strengths,
                 new_col_idx["Nhược Điểm"]: weaknesses}
        plan_rows.append({
            "hr_id": hr_id,
            "display_name": entry.get("display_name", hr_id),
            "grade_review_row": row_number,
            "cells": {a1_col(idx): value for idx, value in sorted(cells.items())},
            "range": f"Grade_Review!A{row_number}:{a1_col(max(cells))}{row_number}",
            "values_row": [cells.get(i, "") for i in range(max(cells) + 1)],
        })

        if hr_id in portfolio_map and pf_strength_idx != -1 and pf_weakness_idx != -1:
            pf_row_number, pf_row = portfolio_map[hr_id]
            existing_s = pf_row[pf_strength_idx] if pf_strength_idx < len(pf_row) else ""
            existing_w = pf_row[pf_weakness_idx] if pf_weakness_idx < len(pf_row) else ""
            plan_rows[-1]["portfolio_master"] = {
                "row_number": pf_row_number,
                "strengths_range": f"Portfolio_Master!{a1_col(pf_strength_idx)}{pf_row_number}",
                "weaknesses_range": f"Portfolio_Master!{a1_col(pf_weakness_idx)}{pf_row_number}",
                "strengths_value": merge_note(existing_s, args.tag, strengths),
                "weaknesses_value": merge_note(existing_w, args.tag, weaknesses),
            }
        elif hr_id not in portfolio_map:
            plan_rows[-1]["portfolio_hold"] = "không có trong Portfolio_Master"
        else:
            plan_rows[-1]["portfolio_hold"] = "Portfolio_Master thiếu cột Ưu điểm/Nhược điểm"

    plan = {
        "status": "apply" if args.apply else "dry-run",
        "spreadsheet_id": args.spreadsheet_id,
        "tag": args.tag,
        "headers_to_add": {col: f"Grade_Review!{a1_col(idx)}1" for col, idx in headers_to_add.items()},
        "updates": plan_rows,
        "holds": holds,
    }

    if args.apply:
        if headers_to_add:
            ordered = [col for col in sorted(headers_to_add, key=lambda c: headers_to_add[c])]
            start = min(headers_to_add.values())
            rng = f"Grade_Review!{a1_col(start)}1:{a1_col(start + len(ordered) - 1)}1"
            gws_values_update(args.spreadsheet_id, rng, [ordered])
        start_idx = min(new_col_idx.values())
        for upd in plan_rows:
            row_cells = upd["values_row"][start_idx:]
            rng = (f"Grade_Review!{a1_col(start_idx)}{upd['grade_review_row']}:"
                   f"{a1_col(start_idx + len(row_cells) - 1)}{upd['grade_review_row']}")
            gws_values_update(args.spreadsheet_id, rng, [row_cells])
            pf = upd.get("portfolio_master")
            if pf:
                gws_values_update(args.spreadsheet_id, pf["strengths_range"], [[pf["strengths_value"]]])
                gws_values_update(args.spreadsheet_id, pf["weaknesses_range"], [[pf["weaknesses_value"]]])

    if args.out:
        os.makedirs(args.out, exist_ok=True)
        with open(os.path.join(args.out, "sync_plan.json"), "w", encoding="utf-8") as f:
            json.dump(plan, f, ensure_ascii=False, indent=2)
        lines = [f"# grade-review-sync — {plan['status']}", "",
                 f"Spreadsheet: `{args.spreadsheet_id}` · Tag: `{args.tag}`", "",
                 f"Cột mới cần thêm: {len(headers_to_add)} · Updates: {len(plan_rows)} · Holds: {len(holds)}", ""]
        for upd in plan_rows:
            lines.append(f"- {upd['hr_id']} ({upd['display_name']}): row {upd['grade_review_row']}"
                         + (", portfolio OK" if upd.get("portfolio_master") else f", portfolio hold: {upd.get('portfolio_hold', '')}"))
        for h in holds:
            lines.append(f"- HOLD {h['hr_id']}: {h['reason']}")
        with open(os.path.join(args.out, "report.md"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    print(json.dumps({"status": plan["status"], "updates": len(plan_rows),
                      "holds": len(holds), "headers_to_add": len(headers_to_add),
                      "out": args.out or "(stdout only)"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
