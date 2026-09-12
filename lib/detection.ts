import { YOLOX_BACKEND, YOLOX_CLASSES, YOLOX_INPUT_SIZE, YOLOX_MIN_SCORE, YOLOX_MODEL } from "./detectors/yolox.ts";
import type { Detection } from "./detectors/types.ts";

// Compatibility exports keep the public API and deployed YOLOX behavior stable
// while new detectors implement the model-agnostic backend contract.
export type { Detection, Review } from "./detectors/types.ts";
export { iou, suppressOverlaps } from "./detectors/geometry.ts";
export const INPUT_SIZE = YOLOX_INPUT_SIZE;
export const MIN_SCORE = YOLOX_MIN_SCORE;
export const MODEL = {
  name: YOLOX_MODEL.name,
  version: YOLOX_MODEL.version,
  inputSize: YOLOX_MODEL.inputSize,
  sha256: YOLOX_MODEL.sha256,
  source: YOLOX_MODEL.source,
  license: YOLOX_MODEL.license,
} as const;
export const CLASSES = YOLOX_CLASSES;
export type Run = {
  detections: Detection[]; inferenceMs: number; totalMs: number; completedAt: string;
};
export type ImageInfo = { name: string; width: number; height: number; source: "sample" | "upload" };

export function validateImageFile(file: { type: string; size: number }): string | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "Choose a PNG, JPEG or WebP image.";
  if (file.size === 0) return "This file is empty. Choose a different image.";
  if (file.size > 20 * 1024 * 1024) return "This image exceeds the 20 MB limit.";
  return null;
}

export function visibleDetections(items: Detection[], threshold: number, hidden: string[], review: string) {
  return items.filter(item => item.confidence * 100 >= threshold && !hidden.includes(item.label)
    && (review === "all" || item.review === review));
}

export function decodeOutput(data: Float32Array, imageWidth: number, imageHeight: number): Detection[] {
  return YOLOX_BACKEND.decode({ data, dims: [1, 3549, 85] }, imageWidth, imageHeight);
}

// Official input: top-left letterbox padded with 114, BGR, CHW, float32 0..255.
export function rgbaToBgr(data: Uint8ClampedArray) {
  return YOLOX_BACKEND.preprocess(data);
}

export function createReport(image: ImageInfo, run: Run, items: Detection[], filters: object, scope: string, mode = "general-object") {
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), image, mode,
    model: MODEL, run: { completedAt: run.completedAt, inferenceMs: run.inferenceMs,
      totalMs: run.totalMs, executionProvider: "wasm", candidateFloor: MIN_SCORE, nmsIou: 0.45 },
    scope, filters, coordinateSystem: "original-image-pixels-xywh",
    detections: items.map(item => ({ ...item, confidence: Number(item.confidence.toFixed(6)),
      x: Number(item.x.toFixed(2)), y: Number(item.y.toFixed(2)),
      width: Number(item.width.toFixed(2)), height: Number(item.height.toFixed(2)) })) };
}

export function csvCell(value: string | number) {
  const text = String(value);
  // Do not allow filenames/notes to execute as spreadsheet formulas.
  const safe = /^[\s]*[=+@-]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
export function reportCsv(report: ReturnType<typeof createReport>) {
  const header = "file,image_width,image_height,model,completed_at,inference_ms,coordinate_system,id,label,confidence,x,y,width,height,review,note";
  return [header, ...report.detections.map(item => [report.image.name, report.image.width,
    report.image.height, report.model.name, report.run.completedAt, report.run.inferenceMs,
    report.coordinateSystem, item.id, item.label, item.confidence, item.x, item.y, item.width,
    item.height, item.review, item.note].map(csvCell).join(","))].join("\r\n");
}
