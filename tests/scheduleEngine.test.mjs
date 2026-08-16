import assert from "node:assert/strict";
import test from "node:test";
import { buildManualScheduleAssignment } from "../lib/scheduleAssignment.ts";
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

test("Both defaults to Home while Support availability opens a separate Studio lane", () => {
  const host = person("HRLT01", "host", { workLocation: "both" });
  const support = person("HRSL01", "support");
  const rows = run(
    [host, support],
    [
      available("host", host.id, "2026-08-13", slots[0]),
      available("support", support.id, "2026-08-13", slots[0])
    ]
  );
  assert.equal(rows.length, 2);
  const home = rows.find((row) => row.format === "Home");
  const studio = rows.find((row) => row.format === "Studio");
  assert.equal(home?.hostId, host.id);
  assert.equal(home?.supportId, "");
  assert.equal(home?.status, "published");
  assert.equal(studio?.hostId, "");
  assert.equal(studio?.status, "open");
});

test("one slot can contain one Studio live and one Home live", () => {
  const studioHost = person("HRLT01", "host", { workLocation: "studio" });
  const homeHost = person("HRLT02", "host", { workLocation: "home" });
  const rows = run(
    [studioHost, homeHost],
    [
      available("host", studioHost.id, "2026-08-13", slots[0], "studio"),
      available("host", homeHost.id, "2026-08-13", slots[0], "home")
    ]
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map((row) => row.format)), new Set(["Home", "Studio"]));
  assert.equal(new Set(rows.map((row) => row.sessionId)).size, 2);
});

test("schedule generation no longer depends on cast status", () => {
  const host = person("HRLT01", "host", { workLocation: "home", castStatus: "" });
  const rows = run(
    [host],
    [available("host", host.id, "2026-08-13", slots[0], "home")]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hostId, host.id);
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

test("weekday can reuse one Support for a second host-filled four-hour block when no fresh Support remains", () => {
  const earlyHosts = [
    person("HRLT01", "host", { name: "Host sáng 1" }),
    person("HRLT02", "host", { name: "Host sáng 2" })
  ];
  const lateHosts = [
    person("HRLT03", "host", { name: "Host chiều 1" }),
    person("HRLT04", "host", { name: "Host chiều 2" })
  ];
  const supportA = person("HRSL01", "support", { name: "Support A" });
  const supportB = person("HRSL02", "support", { name: "Support B" });
  const availability = [
    ...slots.flatMap((slot, index) => {
      const hosts = index < 2 ? earlyHosts : lateHosts;
      return hosts.map((host) => available("host", host.id, "2026-08-13", slot, "studio"));
    }),
    ...slots.map((slot) => available("support", supportA.id, "2026-08-13", slot)),
    ...slots.slice(0, 2).map((slot) => available("support", supportB.id, "2026-08-13", slot))
  ];

  const rows = run([...earlyHosts, ...lateHosts, supportA, supportB], availability)
    .filter((row) => row.format === "Studio");

  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.supportId), [supportA.id, supportA.id, supportA.id, supportA.id]);
  assert.ok(rows.every((row) => row.status === "published"));
});

test("training status is a priority, not a hard filter, for host and support", () => {
  const trainedHost = person("HRLT01", "host", { trainingStatus: "Đã training", level: "B" });
  const untrainedHost = person("HRLT02", "host", { trainingStatus: "Chưa", level: "B", name: "Host chưa train" });
  const trainedSupport = person("HRSL01", "support", { trainingStatus: "Đã Training", cashOffer: "40.000" });
  const untrainedSupport = person("HRSL02", "support", { trainingStatus: "Chưa Training", cashOffer: "30.000", name: "Support chưa train" });

  const trainedRows = run(
    [trainedHost, untrainedHost, trainedSupport, untrainedSupport],
    slots.slice(0, 2).flatMap((slot) => [
      available("host", trainedHost.id, "2026-08-13", slot, "studio"),
      available("host", untrainedHost.id, "2026-08-13", slot, "studio"),
      available("support", trainedSupport.id, "2026-08-13", slot),
      available("support", untrainedSupport.id, "2026-08-13", slot)
    ])
  );
  assert.ok(trainedRows.every((row) => row.hostId === trainedHost.id));
  assert.ok(trainedRows.every((row) => row.supportId === trainedSupport.id));

  const fallbackRows = run(
    [untrainedHost, untrainedSupport],
    slots.slice(0, 2).flatMap((slot) => [
      available("host", untrainedHost.id, "2026-08-13", slot, "studio"),
      available("support", untrainedSupport.id, "2026-08-13", slot)
    ])
  );
  assert.ok(fallbackRows.every((row) => row.hostId === untrainedHost.id));
  assert.ok(fallbackRows.every((row) => row.supportId === untrainedSupport.id));
  assert.ok(fallbackRows.every((row) => row.status === "published"));
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

test("weekend falls back to four-hour blocks when no _6H Support can cover three consecutive slots", () => {
  const hosts = [
    person("HRLT01", "host"),
    person("HRLT02", "host", { name: "Host 2" })
  ];
  const support = person("HRSL01", "support");
  const availability = slots.slice(0, 3).flatMap((slot) => [
    ...hosts.map((host) => available("host", host.id, "2026-08-15", slot, "studio")),
    available("support", support.id, "2026-08-15", slot)
  ]);
  const rows = run([...hosts, support], availability);

  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.supportId), [support.id, support.id, support.id]);
  assert.equal(rows.filter((row) => row.status === "published").length, 3);
});

test("weekend can reuse the same Support on another block when no fresh Support is available", () => {
  const hosts = [
    person("HRLT01", "host"),
    person("HRLT02", "host", { name: "Host 2" })
  ];
  const support = person("HRSL01", "support");
  const availability = slots.flatMap((slot) => [
    ...hosts.map((host) => available("host", host.id, "2026-08-15", slot, "studio")),
    available("support", support.id, "2026-08-15", slot)
  ]);
  const rows = run([...hosts, support], availability);

  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.supportId), Array(4).fill(support.id));
  assert.equal(rows.filter((row) => row.status === "published").length, 4);
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

test("manual Host selection syncs profile fields and Both defaults to Home", () => {
  const previousHost = person("HRLT01", "host");
  const support = person("HRSL01", "support");
  const current = run(
    [previousHost, support],
    slots.slice(0, 2).flatMap((slot) => [
      available("host", previousHost.id, "2026-08-13", slot, "studio"),
      available("support", support.id, "2026-08-13", slot)
    ])
  )[0];
  const replacement = person("HRLT02", "host", {
    name: "Host mới",
    workLocation: "both",
    liveChannelId: "CHANNEL-02"
  });
  const updated = buildManualScheduleAssignment({
    current,
    host: replacement,
    support,
    hostWasEdited: true,
    supportWasEdited: false
  });

  assert.equal(updated.hostId, replacement.id);
  assert.equal(updated.hostName, replacement.name);
  assert.equal(updated.channel, replacement.liveChannelId);
  assert.equal(updated.format, "Home");
  assert.equal(updated.supportId, "");
  assert.equal(updated.isHostConfirmed, false);
  assert.equal(updated.manualOverride, true);
});

test("selecting Support for a Both Host moves the session to Studio", () => {
  const host = person("HRLT01", "host", { workLocation: "both" });
  const support = person("HRSL01", "support", { name: "Support mới" });
  const current = run(
    [host],
    [available("host", host.id, "2026-08-13", slots[0], "home")]
  )[0];
  const updated = buildManualScheduleAssignment({
    current,
    host,
    support,
    hostWasEdited: false,
    supportWasEdited: true
  });

  assert.equal(updated.format, "Studio");
  assert.equal(updated.supportId, support.id);
  assert.equal(updated.supportName, support.name);
  assert.equal(updated.status, "published");
  assert.equal(updated.missingSupport, false);
});

test("moving a session Home clears Support and its confirmation", () => {
  const host = person("HRLT01", "host", { workLocation: "both" });
  const support = person("HRSL01", "support");
  const current = {
    ...run(
      [host, support],
      slots.slice(0, 2).flatMap((slot) => [
        available("host", host.id, "2026-08-13", slot, "studio"),
        available("support", support.id, "2026-08-13", slot)
      ])
    )[0],
    isSupportConfirmed: true,
    supportConfirm: "Đã xác nhận"
  };
  const updated = buildManualScheduleAssignment({
    current,
    host,
    support,
    hostWasEdited: false,
    supportWasEdited: false,
    locationMode: "home"
  });

  assert.equal(updated.format, "Home");
  assert.equal(updated.supportId, "");
  assert.equal(updated.isSupportConfirmed, false);
  assert.equal(updated.supportConfirm, "Chưa xác nhận");
  assert.equal(updated.supportRequired, false);
});
