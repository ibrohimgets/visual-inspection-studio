// YOLOX decoding adapted from Megvii's demo_utils.py (Apache-2.0).
// Copyright (c) Megvii, Inc. and its affiliates. See public/models/YOLOX-LICENSE.txt.
// Adaptation: TypeScript, clipped pixel coordinates, deterministic IDs and bounded output.
export const INPUT_SIZE = 416;
export const MIN_SCORE = 0.1;
export const MODEL = {
  name: "YOLOX-Nano", version: "0.1.1rc0", inputSize: INPUT_SIZE,
  sha256: "c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d",
  source: "https://github.com/Megvii-BaseDetection/YOLOX",
  license: "Apache-2.0",
} as const;

export const CLASSES = [
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
  "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog",
  "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella",
  "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
  "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle",
  "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich",
  "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
  "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote",
  "keyboard", "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book",
  "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush",
] as const;

export type Review = "pending" | "accepted" | "dismissed";
export type Detection = {
  id: number; label: string; confidence: number;
  x: number; y: number; width: number; height: number;
  review: Review; note: string;
};
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

export function iou(a: Detection, b: Detection) {
  const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

export function suppressOverlaps(items: Detection[], threshold = 0.45) {
  const sorted = [...items].sort((a, b) => b.confidence - a.confidence);
  const kept: Detection[] = [];
  // Class-agnostic NMS, matching the official YOLOX ONNX demo.
  for (const item of sorted) {
    if (kept.every(other => iou(item, other) <= threshold)) kept.push(item);
    if (kept.length === 300) break;
  }
  return kept.map((item, index) => ({ ...item, id: index + 1 }));
}

export function decodeOutput(data: Float32Array, imageWidth: number, imageHeight: number): Detection[] {
  if (data.length !== 3549 * 85) throw new Error("Unexpected YOLOX output shape; expected 3549 × 85.");
  if (imageWidth <= 0 || imageHeight <= 0) throw new Error("Image dimensions must be positive.");
  const ratio = Math.min(INPUT_SIZE / imageWidth, INPUT_SIZE / imageHeight);
  const candidates: Detection[] = [];
  let row = 0;
  for (const stride of [8, 16, 32]) {
    const grid = INPUT_SIZE / stride;
    for (let gy = 0; gy < grid; gy++) for (let gx = 0; gx < grid; gx++, row++) {
      const offset = row * 85;
      const objectness = data[offset + 4];
      if (objectness < MIN_SCORE) continue;
      let classId = 0;
      for (let c = 1; c < 80; c++) if (data[offset + 5 + c] > data[offset + 5 + classId]) classId = c;
      const confidence = objectness * data[offset + 5 + classId];
      if (!Number.isFinite(confidence) || confidence < MIN_SCORE || confidence > 1) continue;
      const cx = (data[offset] + gx) * stride / ratio;
      const cy = (data[offset + 1] + gy) * stride / ratio;
      const w = Math.exp(data[offset + 2]) * stride / ratio;
      const h = Math.exp(data[offset + 3]) * stride / ratio;
      if (![cx, cy, w, h].every(Number.isFinite)) continue;
      const x = Math.max(0, Math.min(imageWidth, cx - w / 2));
      const y = Math.max(0, Math.min(imageHeight, cy - h / 2));
      const right = Math.max(0, Math.min(imageWidth, cx + w / 2));
      const bottom = Math.max(0, Math.min(imageHeight, cy + h / 2));
      if (right - x < 1 || bottom - y < 1) continue;
      candidates.push({ id: 0, label: CLASSES[classId], confidence, x, y, width: right - x,
        height: bottom - y, review: "pending", note: "" });
    }
  }
  return suppressOverlaps(candidates);
}

// Official input: top-left letterbox padded with 114, BGR, CHW, float32 0..255.
export function rgbaToBgr(data: Uint8ClampedArray) {
  const pixels = data.length / 4;
  const result = new Float32Array(pixels * 3);
  for (let p = 0; p < pixels; p++) {
    result[p] = data[p * 4 + 2]; result[p + pixels] = data[p * 4 + 1]; result[p + 2 * pixels] = data[p * 4];
  }
  return result;
}

export function createReport(image: ImageInfo, run: Run, items: Detection[], filters: object, scope: string) {
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), image,
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
