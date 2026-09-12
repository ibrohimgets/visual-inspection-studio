import test from "node:test";
import assert from "node:assert/strict";
import {
  DSPCBSD_PLUS,
  assignSplits,
  boxIou,
  calibrationMetrics,
  evaluatePredictions,
  selectiveRisk,
  stableHash,
  summarizeLatency,
  validateManifest,
  validatePredictionRecords,
} from "../lib/evaluation.ts";

const box = (overrides = {}) => ({ label: "CS", x: 10, y: 10, width: 20, height: 20, ...overrides });
const manifest = (images = []) => ({ schemaVersion: 1, dataset: DSPCBSD_PLUS, images });

test("the benchmark metadata is explicit and licensed", () => {
  assert.equal(DSPCBSD_PLUS.id, "dspcbsd-plus");
  assert.equal(DSPCBSD_PLUS.license, "CC BY 4.0");
  assert.equal(DSPCBSD_PLUS.classes.length, 9);
  assert.equal(DSPCBSD_PLUS.boxCount, 20276);
});

test("manifest validation catches duplicate, unknown and out-of-bounds labels", () => {
  const errors = validateManifest(manifest([
    { imageId: "a", file: "a.jpg", width: 100, height: 100, boxes: [box()] },
    { imageId: "a", file: "b.jpg", width: 100, height: 100, boxes: [box({ label: "unknown" })] },
    { imageId: "c", file: "c.jpg", width: 100, height: 100, boxes: [box({ x: 95, width: 20 })] },
  ]));
  assert.ok(errors.some(error => error.includes("duplicates")));
  assert.ok(errors.some(error => error.includes("not in dataset.classes")));
  assert.ok(errors.some(error => error.includes("inside image bounds")));
});

test("grouped split assignment is deterministic and prevents group leakage", () => {
  const images = [
    { imageId: "a-1", file: "a-1.jpg", width: 100, height: 100, group: "batch-a", boxes: [] },
    { imageId: "a-2", file: "a-2.jpg", width: 100, height: 100, group: "batch-a", boxes: [] },
    { imageId: "b-1", file: "b-1.jpg", width: 100, height: 100, group: "batch-b", boxes: [] },
  ];
  const first = assignSplits(images, "test-seed");
  const second = assignSplits(images, "test-seed");
  assert.deepEqual(first.map(image => image.split), second.map(image => image.split));
  assert.equal(first[0].split, first[1].split);
  assert.equal(typeof stableHash("test-seed"), "number");
});

test("box IoU is bounded and exact for identical boxes", () => {
  assert.equal(boxIou(box(), box()), 1);
  assert.equal(boxIou(box(), box({ x: 100 })), 0);
  assert.ok(boxIou(box(), box({ x: 20 })) > 0 && boxIou(box(), box({ x: 20 })) < 1);
});

test("prediction validation rejects unknown images, labels and invalid boxes", () => {
  const errors = validatePredictionRecords(manifest([{ imageId: "a", file: "a.jpg", width: 100, height: 100, boxes: [] }]), [
    { imageId: "a", predictions: [box({ label: "not-a-class" }), box({ x: 90, width: 20, confidence: 1.2 })] },
    { imageId: "missing", predictions: [] },
  ]);
  assert.ok(errors.some(error => error.includes("not in dataset.classes")));
  assert.ok(errors.some(error => error.includes("inside image bounds")));
  assert.ok(errors.some(error => error.includes("not present in the manifest")));
});

test("evaluation computes detection metrics and per-class AP", () => {
  const images = [
    { imageId: "a", file: "a.jpg", width: 100, height: 100, split: "test", boxes: [box()] },
    { imageId: "b", file: "b.jpg", width: 100, height: 100, split: "test", boxes: [box({ label: "SP", x: 60 })] },
  ];
  const records = [
    { imageId: "a", inferenceMs: 12, predictions: [box({ confidence: .9 })] },
    { imageId: "b", inferenceMs: 20, predictions: [box({ label: "SP", x: 60, confidence: .8 }), box({ x: 2, y: 70, confidence: .2 })] },
  ];
  const report = evaluatePredictions(manifest(images), records, { split: "test", iouThreshold: .5 });
  assert.equal(report.imageCount, 2);
  assert.equal(report.groundTruthBoxCount, 2);
  assert.equal(report.predictionCount, 3);
  assert.equal(report.metrics.truePositives, 2);
  assert.equal(report.metrics.falsePositives, 1);
  assert.equal(report.metrics.falseNegatives, 0);
  assert.equal(report.metrics.precision, 2 / 3);
  assert.equal(report.metrics.recall, 1);
  assert.equal(report.metrics.perClass.CS.truePositives, 1);
  assert.equal(report.metrics.perClass.SP.averagePrecision, 1);
  assert.equal(report.latency.p50Ms, 12);
  assert.equal(report.latency.p95Ms, 20);
});

test("calibration reports Brier score, ECE and empty bins", () => {
  const summary = calibrationMetrics([{ score: .9, correct: true }, { score: .8, correct: false }, { score: .1, correct: false }], 5);
  assert.equal(summary.count, 3);
  assert.ok(summary.brierScore > 0);
  assert.ok(summary.expectedCalibrationError > 0);
  assert.equal(summary.bins.length, 5);
  assert.ok(summary.bins.some(bin => bin.count === 0));
});

test("selective risk ranks high-confidence results first", () => {
  const points = selectiveRisk([{ score: .95, correct: true }, { score: .8, correct: false }, { score: .2, correct: true }], 3);
  assert.equal(points[0].coverage, 1 / 3);
  assert.equal(points[0].accuracy, 1);
  assert.equal(points[1].accuracy, .5);
});

test("latency summary returns null when no measurements exist", () => {
  assert.deepEqual(summarizeLatency([]), { count: 0, meanMs: null, p50Ms: null, p95Ms: null, minMs: null, maxMs: null });
  assert.equal(summarizeLatency([20, 10, 30]).meanMs, 20);
  assert.equal(summarizeLatency([20, 10, 30]).p95Ms, 30);
});
