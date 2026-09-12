import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { CLASSES, MODEL, decodeOutput, suppressOverlaps, visibleDetections, rgbaToBgr, validateImageFile, createReport, reportCsv } from "../lib/detection.ts";

const item = (overrides = {}) => ({ id: 1, label: "dog", confidence: .9, x: 0, y: 0,
  width: 100, height: 100, review: "pending", note: "", ...overrides });

test("official model bytes match the pinned checksum", () => {
  const bytes = readFileSync(new URL("../public/models/yolox_nano.onnx", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), MODEL.sha256);
  assert.equal(CLASSES.length, 80);
});
test("preprocessing keeps 0–255 values and changes RGBA to BGR CHW", () => {
  assert.deepEqual([...rgbaToBgr(new Uint8ClampedArray([10,20,30,255,40,50,60,255]))], [30,60,20,50,10,40]);
});
test("YOLOX grids decode to original pixels, clipping at the image boundary", () => {
  const data = new Float32Array(3549 * 85);
  data[0] = 2; data[1] = 2; data[2] = Math.log(4); data[3] = Math.log(4);
  data[4] = .9; data[5 + 16] = .9;
  const output = decodeOutput(data, 832, 416);
  assert.equal(output.length, 1);
  assert.equal(output[0].label, "dog");
  assert.ok(Math.abs(output[0].confidence - .81) < .000001);
  assert.ok(Math.abs(output[0].width - 64) < .001);
  assert.ok(output[0].x >= 0 && output[0].y >= 0);
});
test("empty, corrupt and non-finite predictions never create fake findings", () => {
  assert.deepEqual(decodeOutput(new Float32Array(3549 * 85), 640, 480), []);
  assert.throws(() => decodeOutput(new Float32Array(85), 640, 480), /shape/);
  const bad = new Float32Array(3549 * 85).fill(NaN);
  assert.deepEqual(decodeOutput(bad, 640, 480), []);
});
test("NMS keeps the strongest overlapping prediction and an independent object", () => {
  const result = suppressOverlaps([item({ confidence: .6 }), item({ confidence: .95 }), item({ x: 200 })]);
  assert.equal(result.length, 2);
  assert.equal(result[0].confidence, .95);
  assert.deepEqual(result.map(x => x.id), [1, 2]);
});
test("confidence, class and review filters combine without mutating results", () => {
  const items = [item(), item({ id: 2, label: "car", confidence: .3, review: "accepted" })];
  assert.equal(visibleDetections(items, 30, [], "all").length, 2);
  assert.equal(visibleDetections(items, 31, [], "all").length, 1);
  assert.equal(visibleDetections(items, 10, ["dog"], "accepted")[0].id, 2);
  assert.equal(visibleDetections(items, 10, ["car"], "accepted").length, 0);
  assert.equal(items.length, 2);
});
test("file validation rejects invalid, oversized and empty input", () => {
  assert.equal(validateImageFile({ type: "image/png", size: 400 }), null);
  assert.match(validateImageFile({ type: "image/svg+xml", size: 400 }), /Choose/);
  assert.match(validateImageFile({ type: "image/png", size: 0 }), /empty/);
  assert.match(validateImageFile({ type: "image/png", size: 21 * 1024 * 1024 }), /20 MB/);
});
test("export records model provenance, actual timing, review state and safe CSV", () => {
  const detection = item({ review: "accepted", note: '=SUM(A1), "quoted"\nsecond line' });
  const run = { detections: [detection], inferenceMs: 127, totalMs: 999, completedAt: "2026-09-12T00:00:00.000Z" };
  const report = createReport({ name: "photo.jpg", width: 800, height: 600, source: "upload" }, run, [detection], {}, "all");
  assert.equal(report.coordinateSystem, "original-image-pixels-xywh");
  assert.equal(report.run.inferenceMs, 127);
  assert.equal(report.detections[0].review, "accepted");
  assert.equal(report.model.sha256, MODEL.sha256);
  const csv = reportCsv(report);
  assert.ok(csv.includes('"\'=SUM(A1), ""quoted""\nsecond line"'));
  assert.ok(csv.includes('"800","600","YOLOX-Nano"'));
});
