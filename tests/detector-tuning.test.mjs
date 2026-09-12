import assert from "node:assert/strict";
import test from "node:test";
import { applyClassThresholds, selectMicroF1ClassThresholds } from "../lib/detector-tuning.ts";

test("class-threshold coordinate descent improves combined micro F1", () => {
  const point = (confidenceThreshold, truePositives, falsePositives, falseNegatives) => ({ confidenceThreshold, truePositives, falsePositives, falseNegatives, precision: 0, recall: 0, f1: 0 });
  const selected = selectMicroF1ClassThresholds({
    A: [point(.3, 9, 9, 1), point(.6, 8, 1, 2)],
    B: [point(.3, 8, 8, 2), point(.6, 7, 1, 3)],
  }, .3);
  assert.deepEqual(selected.thresholds, { A: .6, B: .6 });
  assert.ok(selected.metrics.f1 > .7);
});

test("class thresholds filter each predicted label independently", () => {
  const records = [{ imageId: "image", predictions: [
    { label: "A", confidence: .4 }, { label: "B", confidence: .4 },
  ] }];
  const [filtered] = applyClassThresholds(records, { A: .3, B: .5 });
  assert.deepEqual(filtered.predictions.map(prediction => prediction.label), ["A"]);
});
