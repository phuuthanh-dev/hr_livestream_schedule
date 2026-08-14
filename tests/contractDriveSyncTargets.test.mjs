import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSyncTargets,
  buildSyncStamp,
  deriveCvReference,
  isHttpUrl
} from "../local_programs/contract_drive_sync/target-model.mjs";

test("buildSyncTargets merges people, contracts, and applications by employeeId", () => {
  const targets = buildSyncTargets({
    people: [{
      employeeId: "HRLT20",
      role: "host",
      name: "Cao Nguyen Thanh Thao",
      phone: "0907918553",
      cvReference: "CV",
      updatedAt: "2026-08-11T16:44:12.996Z"
    }],
    contracts: [{
      employeeId: "HRLT20",
      role: "host",
      employeeName: "Cao Nguyen Thanh Thao",
      contractCode: "HRLT20_HDLT2026",
      updatedAt: "2026-08-12T02:00:00.000Z"
    }],
    applications: [{
      applicationId: "app-1",
      employeeId: "HRLT20",
      role: "host",
      fullName: "Cao Nguyen Thanh Thao",
      phone: "0907918553",
      cvUrl: "https://example.com/cv.pdf",
      updatedAt: "2026-08-13T09:30:00.000Z",
      submittedAt: "2026-08-13T09:00:00.000Z"
    }]
  });

  assert.equal(targets.length, 1);
  assert.equal(targets[0].employeeId, "HRLT20");
  assert.equal(targets[0].employeeName, "Cao Nguyen Thanh Thao");
  assert.equal(targets[0].role, "host");
  assert.equal(targets[0].updatedAt, "2026-08-13T09:30:00.000Z");
  assert.equal(deriveCvReference(targets[0]), "https://example.com/cv.pdf");
});

test("buildSyncTargets falls back to phone-role join when application has no employeeId", () => {
  const targets = buildSyncTargets({
    people: [{
      employeeId: "HRSL09",
      role: "support",
      name: "Do Chi Kham",
      phone: "0344289465",
      updatedAt: "2026-08-11T16:44:12.996Z"
    }],
    applications: [{
      applicationId: "app-2",
      role: "support",
      fullName: "Do Chi Kham",
      phone: "0344289465",
      cvUrl: "https://example.com/support-cv.pdf",
      updatedAt: "2026-08-13T09:30:00.000Z",
      submittedAt: "2026-08-13T09:00:00.000Z"
    }]
  });

  assert.equal(targets.length, 1);
  assert.equal(targets[0].employeeId, "HRSL09");
  assert.equal(targets[0].application?.applicationId, "app-2");
});

test("buildSyncStamp picks the newest timestamp across all source documents", () => {
  const stamp = buildSyncStamp({
    person: { updatedAt: "2026-08-11T16:44:12.996Z" },
    contract: { updatedAt: "2026-08-12T02:00:00.000Z" },
    application: { submittedAt: "2026-08-14T01:00:00.000Z" }
  });

  assert.equal(stamp, "2026-08-14T01:00:00.000Z");
});

test("isHttpUrl only accepts http and https URLs", () => {
  assert.equal(isHttpUrl("https://example.com/cv.pdf"), true);
  assert.equal(isHttpUrl("http://example.com/cv.pdf"), true);
  assert.equal(isHttpUrl("drive.google.com/file/d/123"), false);
  assert.equal(isHttpUrl("CV"), false);
});
