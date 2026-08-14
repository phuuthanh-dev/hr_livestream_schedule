import assert from "node:assert/strict";
import test from "node:test";
import { resolveEmployeeCompensation } from "../lib/employeeCompensation.ts";

test("host compensation is standardized from grade", () => {
  const result = resolveEmployeeCompensation("host", {
    level: "A",
    cashOffer: "200.000 + 18% GMV"
  });

  assert.deepEqual(result, {
    rating: "A",
    level: "A",
    cashOffer: "200.000 + commission theo bậc GMV"
  });
});

test("support compensation is derived from rating", () => {
  const result = resolveEmployeeCompensation("support", {
    rating: "B"
  });

  assert.deepEqual(result, {
    rating: "B",
    level: "Cấp 3",
    cashOffer: "70.000"
  });
});

test("support legacy cash offer is overridden by mapped grade", () => {
  const result = resolveEmployeeCompensation("support", {
    level: "Cấp 2",
    cashOffer: "45.000"
  });

  assert.deepEqual(result, {
    rating: "C",
    level: "Cấp 2",
    cashOffer: "50.000"
  });
});
