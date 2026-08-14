import test from "node:test";
import assert from "node:assert/strict";
import {
  HOST_OFFER_BY_GRADE,
  buildOfferProposal,
  buildSummary,
  inferLane,
  normalizeHostGrade
} from "../local_programs/host_offer_sync/proposal-engine.mjs";
import {
  buildLocalProgramEnv
} from "../local_programs/host_offer_sync/runtime.mjs";

const headers = [
  "Mã nhân viên",
  "Họ và tên đầy đủ",
  "Lương thỏa thuận",
  "Kinh nghiệm",
  "Đánh giá level",
  "Rating",
  "Live tk cá nhân",
  "Live tk công ty",
  "Lượt follow",
  "Live_Channel_Id"
];

test("normalizeHostGrade handles legacy host values", () => {
  assert.equal(normalizeHostGrade("thử việc"), "Thử việc");
  assert.equal(normalizeHostGrade("B"), "B");
  assert.equal(normalizeHostGrade("A"), "A");
});

test("inferLane resolves company-account from company flag", () => {
  assert.deepEqual(inferLane({
    "Live tk cá nhân": "FALSE",
    "Live tk công ty": "TRUE",
    "Lượt follow": "",
    Live_Channel_Id: ""
  }), {
    accountMode: "company-account",
    followCount: null
  });
});

test("buildOfferProposal returns ready for company-account rows with grade", () => {
  const proposal = buildOfferProposal({
    headers,
    rowNumber: 2,
    tabName: "Thông tin Mẫu Live",
    row: [
      "HRLT25",
      "Mỹ Linh",
      "",
      "Có",
      "B",
      "",
      "FALSE",
      "TRUE",
      "",
      "vuminhkhangg02"
    ]
  });

  assert.equal(proposal.status, "ready");
  assert.equal(proposal.grade, "B");
  assert.equal(proposal.proposedValue, HOST_OFFER_BY_GRADE.B);
  assert.equal(proposal.targetCell, "C2");
});

test("buildOfferProposal holds personal-account rows for skill review", () => {
  const proposal = buildOfferProposal({
    headers,
    rowNumber: 5,
    tabName: "Thông tin Mẫu Live",
    row: [
      "HRLT99",
      "Host cá nhân",
      "",
      "Có",
      "A",
      "",
      "TRUE",
      "FALSE",
      "220000",
      ""
    ]
  });

  assert.equal(proposal.status, "hold");
  assert.match(proposal.notes.join(" "), /hr-offer-eval/);
});

test("buildOfferProposal detects overwrite risk for filled H", () => {
  const proposal = buildOfferProposal({
    headers,
    rowNumber: 6,
    tabName: "Thông tin Mẫu Live",
    row: [
      "HRLT08",
      "Tuấn Duy",
      "100.000 + 7% GMV",
      "Không",
      "Thử việc",
      "",
      "FALSE",
      "TRUE",
      "",
      "vuminhkhangg02"
    ]
  });

  assert.equal(proposal.status, "ready");
  assert.match(proposal.notes.join(" "), /overwrite/i);
});

test("buildSummary counts statuses", () => {
  assert.deepEqual(buildSummary([
    { status: "ready" },
    { status: "hold" },
    { status: "skipped" },
    { status: "applied" }
  ]), {
    total: 4,
    ready: 1,
    hold: 1,
    skipped: 1,
    applied: 1
  });
});

test("buildLocalProgramEnv resolves defaults and state path", () => {
  const config = buildLocalProgramEnv({
    programRoot: "/tmp/host_offer_sync",
    envSource: {
      LOCAL_HOST_OFFER_BATCH_LIMIT: "12"
    },
    resolveExecutable: () => "/opt/homebrew/bin/gws"
  });

  assert.equal(config.batchLimit, 12);
  assert.equal(config.statePath, "/tmp/host_offer_sync/.state/last-run.json");
  assert.equal(config.gwsPath, "/opt/homebrew/bin/gws");
});
