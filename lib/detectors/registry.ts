import type { DetectorBackend, DetectorId } from "./types.ts";
import { YOLOV8N_PCB_BACKEND } from "./yolov8.ts";
import { YOLOX_BACKEND } from "./yolox.ts";

export const DEFAULT_DETECTOR_ID: DetectorId = "yolox-nano-coco";

const BACKENDS = {
  "yolox-nano-coco": YOLOX_BACKEND,
  "yolov8n-pcb-256": YOLOV8N_PCB_BACKEND,
} satisfies Readonly<Record<DetectorId, DetectorBackend>>;

export function getDetectorBackend(id: DetectorId): DetectorBackend {
  return BACKENDS[id];
}

export function getDeployedDetectorBackend(id: DetectorId = DEFAULT_DETECTOR_ID): DetectorBackend {
  const backend = getDetectorBackend(id);
  if (backend.model.lifecycle !== "deployed" || !backend.modelPath || !backend.model.sha256) {
    throw new Error(`${backend.model.name} is isolated from the deployed application.`);
  }
  return backend;
}

export const DEFAULT_DETECTOR = getDeployedDetectorBackend();
export const DETECTOR_BACKENDS = Object.freeze(Object.values(BACKENDS));
