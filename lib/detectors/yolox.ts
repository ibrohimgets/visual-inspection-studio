// YOLOX decoding adapted from Megvii's demo_utils.py (Apache-2.0).
// Copyright (c) Megvii, Inc. and its affiliates. See public/models/YOLOX-LICENSE.txt.
// Adaptation: TypeScript, clipped pixel coordinates, deterministic IDs and bounded output.
import { suppressOverlaps } from "./geometry.ts";
import type { Detection, DetectorBackend, DetectorTensorOutput } from "./types.ts";

export const YOLOX_INPUT_SIZE = 416;
export const YOLOX_MIN_SCORE = 0.1;

export const YOLOX_MODEL = {
  id: "yolox-nano-coco",
  name: "YOLOX-Nano",
  version: "0.1.1rc0",
  inputSize: YOLOX_INPUT_SIZE,
  sha256: "c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d",
  source: "https://github.com/Megvii-BaseDetection/YOLOX",
  license: "Apache-2.0",
  lifecycle: "deployed",
} as const;

export const YOLOX_CLASSES = [
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

export function rgbaToYoloXBgr(data: Uint8ClampedArray) {
  const pixels = data.length / 4;
  const result = new Float32Array(pixels * 3);
  for (let pixel = 0; pixel < pixels; pixel++) {
    result[pixel] = data[pixel * 4 + 2];
    result[pixel + pixels] = data[pixel * 4 + 1];
    result[pixel + 2 * pixels] = data[pixel * 4];
  }
  return result;
}

export function decodeYoloXOutput(output: DetectorTensorOutput, imageWidth: number, imageHeight: number): Detection[] {
  const { data } = output;
  if (data.length !== 3549 * 85) throw new Error("Unexpected YOLOX output shape; expected 3549 × 85.");
  if (imageWidth <= 0 || imageHeight <= 0) throw new Error("Image dimensions must be positive.");
  const ratio = Math.min(YOLOX_INPUT_SIZE / imageWidth, YOLOX_INPUT_SIZE / imageHeight);
  const candidates: Detection[] = [];
  let row = 0;
  for (const stride of [8, 16, 32]) {
    const grid = YOLOX_INPUT_SIZE / stride;
    for (let gy = 0; gy < grid; gy++) for (let gx = 0; gx < grid; gx++, row++) {
      const offset = row * 85;
      const objectness = data[offset + 4];
      if (objectness < YOLOX_MIN_SCORE) continue;
      let classId = 0;
      for (let classIndex = 1; classIndex < 80; classIndex++) {
        if (data[offset + 5 + classIndex] > data[offset + 5 + classId]) classId = classIndex;
      }
      const confidence = objectness * data[offset + 5 + classId];
      if (!Number.isFinite(confidence) || confidence < YOLOX_MIN_SCORE || confidence > 1) continue;
      const cx = (data[offset] + gx) * stride / ratio;
      const cy = (data[offset + 1] + gy) * stride / ratio;
      const width = Math.exp(data[offset + 2]) * stride / ratio;
      const height = Math.exp(data[offset + 3]) * stride / ratio;
      if (![cx, cy, width, height].every(Number.isFinite)) continue;
      const x = Math.max(0, Math.min(imageWidth, cx - width / 2));
      const y = Math.max(0, Math.min(imageHeight, cy - height / 2));
      const right = Math.max(0, Math.min(imageWidth, cx + width / 2));
      const bottom = Math.max(0, Math.min(imageHeight, cy + height / 2));
      if (right - x < 1 || bottom - y < 1) continue;
      candidates.push({
        id: 0, label: YOLOX_CLASSES[classId], confidence, x, y,
        width: right - x, height: bottom - y, review: "pending", note: "",
      });
    }
  }
  // Class-agnostic NMS intentionally matches the existing official YOLOX ONNX demo path.
  return suppressOverlaps(candidates, 0.45, true);
}

export const YOLOX_BACKEND: DetectorBackend = {
  id: YOLOX_MODEL.id,
  model: YOLOX_MODEL,
  modelPath: "/models/yolox_nano.onnx",
  input: {
    size: YOLOX_INPUT_SIZE,
    paddingValue: 114,
    placement: "top-left",
    channelOrder: "bgr",
    scale: 1,
  },
  preprocess: rgbaToYoloXBgr,
  decode: decodeYoloXOutput,
};
