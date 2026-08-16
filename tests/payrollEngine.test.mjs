import assert from "node:assert/strict";
import test from "node:test";
import { calculatePayroll } from "../lib/payrollEngine.ts";
import { parseTikTokReport } from "../lib/payrollImport.ts";

const rates = [
  { id: "host:c", role: "host", grade: "C", hourlyRate: 100_000, commissionMode: "fixed", commissionRate: 0.07, sortOrder: 1, active: true },
  { id: "support:1", role: "support", grade: "Cấp 1", hourlyRate: 30_000, commissionMode: "none", commissionRate: 0, sortOrder: 2, active: true }
];

const settings = {
  taxRate: 0.1,
  joinGapMinutes: 10,
  hostGmvTiers: [{ minimumGmv: 5_000_000, commissionRate: 0.05 }]
};

const people = [
  { id: "H01", name: "Host One", role: "host", level: "C", active: true },
  { id: "H02", name: "Host Two", role: "host", level: "C", active: true },
  { id: "S01", name: "Support One", role: "support", level: "Cấp 1", active: true }
];

function session(overrides = {}) {
  return {
    rowNumber: 1,
    stt: "1",
    sessionId: "SESSION_1",
    dateKey: "2026-08-13",
    dateLabel: "13/08/2026",
    weekday: "Thứ Năm",
    slot: "10:00 - 12:00",
    slotSortKey: "0600",
    hostId: "H01",
    hostName: "Host One",
    format: "Studio",
    supportId: "S01",
    supportName: "Support One",
    channel: "creator_one",
    scriptUrl: "",
    hostConfirm: "Đã xác nhận",
    supportConfirm: "Đã xác nhận",
    backupHostId: "",
    backupHostName: "",
    backupSupportId: "",
    backupSupportName: "",
    supportCandidatePool: "",
    status: "published",
    isHostConfirmed: true,
    isSupportConfirmed: true,
    canConfirmHost: true,
    canConfirmSupport: true,
    supportRequired: true,
    isSupportOnly: false,
    missingSupport: false,
    warningLevel: "ok",
    warnings: [],
    ...overrides
  };
}

function fragment(overrides = {}) {
  return {
    fragmentKey: "fragment-1",
    title: "Test live",
    tiktokLiveId: "LIVE-1",
    accountId: "creator_one",
    startAt: new Date("2026-08-13T03:05:00.000Z"),
    endAt: new Date("2026-08-13T04:55:00.000Z"),
    dateKey: "2026-08-13",
    grossGmv: 10_000_000,
    returnedGmv: 1_000_000,
    grossOrders: 10,
    rowNumber: 3,
    ...overrides
  };
}

function calculate(sessions, fragments) {
  return calculatePayroll({
    weekStartKey: "2026-08-10",
    weekEndKey: "2026-08-16",
    sessions,
    people,
    fragments,
    rates,
    settings,
    generatedAt: new Date("2026-08-17T00:00:00.000Z")
  });
}

test("Studio live pays one confirmed Host and one confirmed Support from scheduled hours", () => {
  const result = calculate([session()], [fragment()]);
  assert.equal(result.entries.length, 2);
  const host = result.entries.find((entry) => entry.role === "host");
  const support = result.entries.find((entry) => entry.role === "support");
  assert.equal(host.scheduledHours, 2);
  assert.equal(host.eligibleGmv, 9_000_000);
  assert.equal(host.basePay, 200_000);
  assert.equal(host.commissionPay, 630_000);
  assert.equal(host.taxAmount, 83_000);
  assert.equal(host.netPay, 747_000);
  assert.equal(support.basePay, 60_000);
  assert.equal(support.commissionPay, 0);
  assert.equal(support.netPay, 54_000);
});

test("fragments on one account join when the gap is at most ten minutes", () => {
  const result = calculate([session()], [
    fragment({ fragmentKey: "a", tiktokLiveId: "A", startAt: new Date("2026-08-13T03:05:00.000Z"), endAt: new Date("2026-08-13T03:50:00.000Z"), grossGmv: 4_000_000, returnedGmv: 0 }),
    fragment({ fragmentKey: "b", tiktokLiveId: "B", startAt: new Date("2026-08-13T03:55:00.000Z"), endAt: new Date("2026-08-13T04:55:00.000Z"), grossGmv: 6_000_000, returnedGmv: 1_000_000 })
  ]);
  const host = result.entries.find((entry) => entry.role === "host");
  assert.deepEqual(host.tiktokLiveIds, ["A", "B"]);
  assert.equal(host.grossGmv, 10_000_000);
  assert.equal(host.eligibleGmv, 9_000_000);
});

test("a six-minute overrun does not add the following two-hour schedule slot", () => {
  const first = session();
  const second = session({ sessionId: "SESSION_2", slot: "12:00 - 14:00", slotSortKey: "0720" });
  const result = calculate([first, second], [fragment({ startAt: new Date("2026-08-13T03:04:00.000Z"), endAt: new Date("2026-08-13T05:06:00.000Z") })]);
  assert.equal(result.entries.find((entry) => entry.role === "host").scheduledHours, 2);
  assert.ok(result.exceptions.some((item) => item.type === "missing_report" && item.sessionId === "SESSION_2"));
});

test("back-to-back fragments with different hosts split instead of raising ambiguous assignment", () => {
  const first = session({
    sessionId: "SESSION_1",
    slot: "18:00 - 20:00",
    slotSortKey: "1080",
    hostId: "H01",
    hostName: "Host One"
  });
  const second = session({
    sessionId: "SESSION_2",
    slot: "20:00 - 22:00",
    slotSortKey: "1200",
    hostId: "H02",
    hostName: "Host Two"
  });
  const result = calculate([first, second], [
    fragment({
      fragmentKey: "a",
      tiktokLiveId: "A",
      startAt: new Date("2026-08-13T11:17:00.000Z"),
      endAt: new Date("2026-08-13T13:00:00.000Z"),
      grossGmv: 1_000_000,
      returnedGmv: 0
    }),
    fragment({
      fragmentKey: "b",
      tiktokLiveId: "B",
      startAt: new Date("2026-08-13T13:05:00.000Z"),
      endAt: new Date("2026-08-13T15:00:00.000Z"),
      grossGmv: 2_000_000,
      returnedGmv: 0
    })
  ]);
  const hostEntries = result.entries.filter((entry) => entry.role === "host").sort((left, right) => left.sessionIds[0].localeCompare(right.sessionIds[0]));
  assert.equal(hostEntries.length, 2);
  assert.deepEqual(hostEntries.map((entry) => entry.employeeId), ["H01", "H02"]);
  assert.deepEqual(hostEntries.map((entry) => entry.scheduledHours), [2, 2]);
  assert.deepEqual(hostEntries.map((entry) => entry.tiktokLiveIds), [["A"], ["B"]]);
  assert.equal(result.exceptions.filter((item) => item.type === "ambiguous_assignment").length, 0);
});

test("confirmed shifts without a report are exceptions and receive no automatic payroll", () => {
  const result = calculate([session()], []);
  assert.equal(result.entries.length, 0);
  assert.equal(result.exceptions.filter((item) => item.type === "missing_report").length, 2);
});

test("unconfirmed roles do not receive payroll", () => {
  const result = calculate([session({ isHostConfirmed: false, isSupportConfirmed: false })], [fragment()]);
  assert.equal(result.entries.length, 0);
  assert.equal(result.exceptions.filter((item) => item.type === "unconfirmed_shift").length, 2);
});

test("CSV TikTok report is normalized with Vietnamese currency", async () => {
  const csv = [
    "Tiêu đề buổi LIVE,ID buổi LIVE,Thời gian bắt đầu LIVE,Thời gian kết thúc LIVE,Tên nhà sáng tạo,GMV nhờ buổi LIVE của nhà sáng tạo,Hoàn tiền,Đơn hàng nhờ buổi LIVE",
    'Ca test,123,13/08/2026 10:00,13/08/2026 12:00,creator_one,"10.000.000₫","1.000.000₫",12'
  ].join("\n");
  const parsed = await parseTikTokReport(Buffer.from(csv, "utf8"), "report.csv");
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].grossGmv, 10_000_000);
  assert.equal(parsed.rows[0].returnedGmv, 1_000_000);
  assert.equal(parsed.rows[0].dateKey, "2026-08-13");
});

test("TikTok XLSX-style filename range resolves ambiguous MM/DD dates correctly", async () => {
  const csv = [
    "Tiêu đề buổi LIVE,ID buổi LIVE,Thời gian bắt đầu LIVE,Thời gian kết thúc LIVE,Tên nhà sáng tạo,GMV nhờ buổi LIVE của nhà sáng tạo,Hoàn tiền,Đơn hàng nhờ buổi LIVE",
    'Ca test,123,08/07/2026 18:07,08/07/2026 18:33,creator_one,"165.000₫","0₫",1'
  ].join("\n");
  const parsed = await parseTikTokReport(Buffer.from(csv, "utf8"), "Transaction_Analysis_Live_List_20260807-20260807.csv");
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].dateKey, "2026-08-07");
});
