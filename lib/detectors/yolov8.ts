import { suppressOverlaps } from "./geometry.ts";
import type { Detection, DetectorBackend, DetectorTensorOutput } from "./types.ts";

export const PCB_DEFECT_CLASSES = ["SH", "SP", "SC", "OP", "MB", "HB", "CS", "CFO", "BMFO"] as const;
export const YOLOV8_INPUT_SIZE = 256;
export const YOLOV8_PROPOSAL_FLOOR = 0.001;

export const YOLOV8N_PCB_MODEL = {
  id: "yolov8n-pcb-256",
  name: "YOLOv8n PCB (experimental)",
  version: "validation-candidate",
  inputSize: YOLOV8_INPUT_SIZE,
  source: "https://github.com/ultralytics/ultralytics",
  license: "AGPL-3.0 / Ultralytics Enterprise",
  lifecycle: "isolated-experiment",
} as const;

export function rgbaToYoloV8Rgb(data: Uint8ClampedArray) {
  const pixels = data.length / 4;
  const result = new Float32Array(pixels * 3);
  for (let pixel = 0; pixel < pixels; pixel++) {
    result[pixel] = data[pixel * 4] / 255;
    result[pixel + pixels] = data[pixel * 4 + 1] / 255;
    result[pixel + 2 * pixels] = data[pixel * 4 + 2] / 255;
  }
  return result;
}

function outputAccessor(output: DetectorTensorOutput) {
  const attributes = 4 + PCB_DEFECT_CLASSES.length;
  const dims = [...output.dims];
  if (dims.length !== 3 || dims[0] !== 1) throw new Error("Unexpected YOLOv8 output rank; expected [1, attributes, candidates].");
  if (dims[1] === attributes) {
    const candidates = dims[2];
    return { candidates, value: (candidate: number, attribute: number) => output.data[attribute * candidates + candidate] };
  }
  if (dims[2] === attributes) {
    const candidates = dims[1];
    return { candidates, value: (candidate: number, attribute: number) => output.data[candidate * attributes + attribute] };
  }
  throw new Error(`Unexpected YOLOv8 output shape; expected ${attributes} attributes for ${PCB_DEFECT_CLASSES.length} classes.`);
}

export function decodeYoloV8Output(output: DetectorTensorOutput, imageWidth: number, imageHeight: number): Detection[] {
  if (imageWidth <= 0 || imageHeight <= 0) throw new Error("Image dimensions must be positive.");
  const { candidates, value } = outputAccessor(output);
  const ratio = Math.min(YOLOV8_INPUT_SIZE / imageWidth, YOLOV8_INPUT_SIZE / imageHeight);
  const paddingX = (YOLOV8_INPUT_SIZE - imageWidth * ratio) / 2;
  const paddingY = (YOLOV8_INPUT_SIZE - imageHeight * ratio) / 2;
  const findings: Detection[] = [];

  for (let candidate = 0; candidate < candidates; candidate++) {
    let classId = 0;
    for (let classIndex = 1; classIndex < PCB_DEFECT_CLASSES.length; classIndex++) {
      if (value(candidate, 4 + classIndex) > value(candidate, 4 + classId)) classId = classIndex;
    }
    const confidence = value(candidate, 4 + classId);
    if (!Number.isFinite(confidence) || confidence < YOLOV8_PROPOSAL_FLOOR || confidence > 1) continue;
    const cx = (value(candidate, 0) - paddingX) / ratio;
    const cy = (value(candidate, 1) - paddingY) / ratio;
    const width = value(candidate, 2) / ratio;
    const height = value(candidate, 3) / ratio;
    if (![cx, cy, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    const x = Math.max(0, Math.min(imageWidth, cx - width / 2));
    const y = Math.max(0, Math.min(imageHeight, cy - height / 2));
    const right = Math.max(0, Math.min(imageWidth, cx + width / 2));
    const bottom = Math.max(0, Math.min(imageHeight, cy + height / 2));
    if (right - x < 1 || bottom - y < 1) continue;
    findings.push({
      id: 0, label: PCB_DEFECT_CLASSES[classId], confidence, x, y,
      width: right - x, height: bottom - y, review: "pending", note: "",
    });
  }

  return suppressOverlaps(findings, 0.65, false);
}

// This backend deliberately has no modelPath or checksum. It is testable as a
// contract and decoder, but the deployed worker refuses to load it until a
// licensed, validated ONNX artifact is explicitly configured.
export const YOLOV8N_PCB_BACKEND: DetectorBackend = {
  id: YOLOV8N_PCB_MODEL.id,
  model: YOLOV8N_PCB_MODEL,
  input: {
    size: YOLOV8_INPUT_SIZE,
    paddingValue: 114,
    placement: "center",
    channelOrder: "rgb",
    scale: 1 / 255,
  },
  preprocess: rgbaToYoloV8Rgb,
  decode: decodeYoloV8Output,
};
