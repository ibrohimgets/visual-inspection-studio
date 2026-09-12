export type Review = "pending" | "accepted" | "dismissed";

export type Detection = {
  id: number;
  label: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  review: Review;
  note: string;
};

export type DetectorId = "yolox-nano-coco" | "yolov8n-pcb-256";
export type DetectorLifecycle = "deployed" | "isolated-experiment";

export type DetectorModel = {
  id: DetectorId;
  name: string;
  version: string;
  inputSize: number;
  sha256?: string;
  source: string;
  license: string;
  lifecycle: DetectorLifecycle;
};

export type DetectorInput = {
  size: number;
  paddingValue: number;
  placement: "top-left" | "center";
  channelOrder: "bgr" | "rgb";
  scale: number;
};

export type DetectorTensorOutput = {
  data: Float32Array;
  dims: readonly number[];
};

export interface DetectorBackend {
  readonly id: DetectorId;
  readonly model: DetectorModel;
  readonly modelPath?: string;
  readonly input: DetectorInput;
  preprocess(rgba: Uint8ClampedArray): Float32Array;
  decode(output: DetectorTensorOutput, imageWidth: number, imageHeight: number): Detection[];
}
