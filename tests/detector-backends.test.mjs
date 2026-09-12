import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_DETECTOR, DETECTOR_BACKENDS, getDeployedDetectorBackend, getDetectorBackend } from "../lib/detectors/registry.ts";
import { decodeYoloV8Output, PCB_DEFECT_CLASSES, rgbaToYoloV8Rgb } from "../lib/detectors/yolov8.ts";

test("YOLOX remains the only deployed and default detector", () => {
  assert.equal(DEFAULT_DETECTOR.id, "yolox-nano-coco");
  assert.equal(DEFAULT_DETECTOR.model.name, "YOLOX-Nano");
  assert.equal(DEFAULT_DETECTOR.input.size, 416);
  assert.equal(DEFAULT_DETECTOR.input.placement, "top-left");
  assert.equal(DETECTOR_BACKENDS.length, 2);
});

test("YOLOv8n is registered but cannot be loaded by the deployed worker", () => {
  const backend = getDetectorBackend("yolov8n-pcb-256");
  assert.equal(backend.model.lifecycle, "isolated-experiment");
  assert.equal(backend.modelPath, undefined);
  assert.throws(() => getDeployedDetectorBackend("yolov8n-pcb-256"), /isolated/);
});

test("YOLOv8 class order matches the frozen dataset manifest", () => {
  const manifest = JSON.parse(readFileSync(new URL("../evaluation/dspcbsd-plus.manifest.json", import.meta.url), "utf8"));
  assert.deepEqual([...PCB_DEFECT_CLASSES], manifest.dataset.classes);
});

test("YOLOv8 preprocessing produces normalized RGB CHW", () => {
  const result = rgbaToYoloV8Rgb(new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]));
  assert.deepEqual([...result].map(value => Number(value.toFixed(6))), [
    0.039216, 0.156863, 0.078431, 0.196078, 0.117647, 0.235294,
  ]);
});

test("YOLOv8 decoder maps channel-first boxes to original pixels", () => {
  const candidates = 4;
  const attributes = 4 + PCB_DEFECT_CLASSES.length;
  const data = new Float32Array(attributes * candidates);
  const set = (candidate, attribute, value) => { data[attribute * candidates + candidate] = value; };
  set(0, 0, 128); set(0, 1, 128); set(0, 2, 64); set(0, 3, 32); set(0, 4, .9);
  const decoded = decodeYoloV8Output({ data, dims: [1, attributes, candidates] }, 256, 256);
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].label, "SH");
  assert.ok(Math.abs(decoded[0].confidence - .9) < .000001);
  assert.deepEqual(
    [decoded[0].x, decoded[0].y, decoded[0].width, decoded[0].height],
    [96, 112, 64, 32],
  );
});
