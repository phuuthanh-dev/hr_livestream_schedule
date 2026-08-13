import test from "node:test";
import assert from "node:assert/strict";
import { SUPPORT_TRAINING_CHECKLIST, evaluateSupportTraining } from "../lib/supportTrainingConfig.ts";

function answersFor(count) {
  const ids = SUPPORT_TRAINING_CHECKLIST.flatMap((section) => section.items.map((item) => item.id));
  return Object.fromEntries(ids.map((id, index) => [id, index < count]));
}

test("support training maps 100 percent to rating A and top cash offer", () => {
  const total = SUPPORT_TRAINING_CHECKLIST.flatMap((section) => section.items).length;
  const result = evaluateSupportTraining(answersFor(total));
  assert.equal(result.rating, "A");
  assert.equal(result.level, "Cấp 4");
  assert.equal(result.cashOffer, "120.000");
  assert.equal(result.trainingStatus, "Đã Training");
});

test("support training maps mid score to rating C", () => {
  const result = evaluateSupportTraining(answersFor(10));
  assert.equal(result.rating, "C");
  assert.equal(result.level, "Cấp 2");
  assert.equal(result.cashOffer, "50.000");
  assert.equal(result.passed, true);
});

test("support training maps low score to rating D", () => {
  const result = evaluateSupportTraining(answersFor(5));
  assert.equal(result.rating, "D");
  assert.equal(result.level, "Cấp 1");
  assert.equal(result.cashOffer, "30.000");
  assert.equal(result.trainingStatus, "Chưa Training");
});
