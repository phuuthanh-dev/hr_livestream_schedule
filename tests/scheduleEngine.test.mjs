import assert from "node:assert/strict";
import test from "node:test";
import { generateSchedule } from "../lib/scheduleEngine.ts";

const slots = [
  "08:00 - 10:00",
  "10:00 - 12:00",
  "12:00 - 14:00",
  "14:00 - 16:00"
];

function person(id, role, overrides = {}) {
  return {
    id,
    name: id,
    role,
    level: role === "host" ? "A" : "Cấp 1",
    workLocation: role === "host" ? "studio" : undefined,
    cashOffer: role === "host" ? "100.000" : "30.000",
    castStatus: "Đồng ý",
    trainingStatus: role === "host" ? "Rồi" : "Đã Training",
    active: true,
    ...overrides
  };
}

function available(role, employeeId, dateKey, slot, locationPreference) {
  return {
    personKey: `${role}:${employeeId.toLowerCase()}`,
    role,
    employeeId,
    dateKey,
    slot,
    locationPreference
  };
}

function run(people, availability, protectedSessions = []) {
  return generateSchedule({
    weekStartKey: "2026-08-10",
    todayKey: "2026-08-12",
    slots,
    people,
    availability,
    protectedSessions
  });
}

test("support availability creates an open Studio session with Host empty", () => {
  const support = person("HRSL01", "support");
  const rows = run([support], [available("support", support.id, "2026-08-13", slots[0])]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hostId, "");
  assert.equal(rows[0].format, "Studio");
  assert.equal(rows[0].status, "open");
});

test("two consecutive support-only slots share one Support assignment", () => {
  const support = person("HRSL01", "support");
  const rows = run(
    [support],
    slots.slice(0, 2).map((slot) => available("support", support.id, "2026-08-13", slot))
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.hostId === ""));
  assert.deepEqual(rows.map((row) => row.supportId), [support.id, support.id]);
  assert.ok(rows.every((row) => row.status === "open"));
});

test("four support-only slots stay visible while _6H keeps its weekday four-hour limit", () => {
  const support = person("HRSL01_6H", "support");
  const rows = run(
    [support],
    slots.map((slot) => available("support", support.id, "2026-08-13", slot))
  );
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.supportId), [support.id, support.id, "", ""]);
  assert.ok(rows.every((row) => row.hostId === "" && row.status === "open"));
});

test("Both defaults to Home and Home never receives Support", () => {
  const host = person("HRLT01", "host", { workLocation: "both" });
  const support = person("HRSL01", "support");
  const rows = run(
    [host, support],
    [
      available("host", host.id, "2026-08-13", slots[0]),
      available("support", support.id, "2026-08-13", slots[0])
    ]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].format, "Home");
  assert.equal(rows[0].supportId, "");
  assert.equal(rows[0].status, "published");
});

test("host is limited to two sessions in one day", () => {
  const host = person("HRLT01", "host", { workLocation: "home" });
  const rows = run(
    [host],
    slots.slice(0, 3).map((slot) => available("host", host.id, "2026-08-13", slot, "home"))
  );
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((row) => row.hostId === host.id).length, 2);
  assert.equal(rows.filter((row) => row.status === "open").length, 1);
});

test("Studio sessions assign Support only when a complete four-hour block is available", () => {
  const host = person("HRLT01", "host");
  const cheapSupport = person("HRSL01", "support", { level: "Cấp 1", cashOffer: "30.000" });
  const highLevelSupport = person("HRSL02", "support", { level: "Cấp 4", cashOffer: "45.000" });
  const availability = slots.slice(0, 2).flatMap((slot) => [
    available("host", host.id, "2026-08-13", slot, "studio"),
    available("support", cheapSupport.id, "2026-08-13", slot),
    available("support", highLevelSupport.id, "2026-08-13", slot)
  ]);
  const rows = run([host, cheapSupport, highLevelSupport], availability);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.supportId), [cheapSupport.id, cheapSupport.id]);
  assert.ok(rows.every((row) => row.status === "published"));
});

test("weekend six-hour block only uses a _6H Support", () => {
  const hosts = [
    person("HRLT01", "host"),
    person("HRLT02", "host", { name: "Host 2" })
  ];
  const normalSupport = person("HRSL01", "support");
  const sixHourSupport = person("HRSL02_6H", "support", { cashOffer: "45.000" });
  const availability = slots.slice(0, 3).flatMap((slot) => [
    ...hosts.map((host) => available("host", host.id, "2026-08-15", slot, "studio")),
    available("support", normalSupport.id, "2026-08-15", slot),
    available("support", sixHourSupport.id, "2026-08-15", slot)
  ]);
  const rows = run([...hosts, normalSupport, sixHourSupport], availability);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.supportId), Array(3).fill(sixHourSupport.id));
});

test("protected slot is not generated again", () => {
  const host = person("HRLT01", "host", { workLocation: "home" });
  const protectedSession = {
    ...run([host], [available("host", host.id, "2026-08-13", slots[0], "home")])[0],
    isHostConfirmed: true
  };
  const rows = run(
    [host],
    [available("host", host.id, "2026-08-13", slots[0], "home")],
    [protectedSession]
  );
  assert.equal(rows.length, 0);
});
