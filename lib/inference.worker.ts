/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/wasm";
import { DEFAULT_DETECTOR_ID, getDeployedDetectorBackend } from "./detectors/registry.ts";
import type { DetectorId } from "./detectors/types.ts";

const sessions = new Map<DetectorId, Promise<ort.InferenceSession>>();
const worker = self as unknown as DedicatedWorkerGlobalScope;
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL("/runtime/", worker.location.origin).href;
ort.env.logLevel = "error";

async function loadModel(detectorId: DetectorId) {
  const backend = getDeployedDetectorBackend(detectorId);
  const response = await fetch(backend.modelPath as string);
  if (!response.ok) throw new Error(`Model download failed (${response.status}).`);
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  if (hash !== backend.model.sha256) throw new Error("Model integrity check failed. Reload to download it again.");
  return ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
}

worker.onmessage = async (event: MessageEvent<{ detectorId?: DetectorId; data: Float32Array; width: number; height: number }>) => {
  let tensor: ort.Tensor | undefined;
  let output: ort.InferenceSession.OnnxValueMapType | undefined;
  try {
    const detectorId = event.data.detectorId ?? DEFAULT_DETECTOR_ID;
    const backend = getDeployedDetectorBackend(detectorId);
    worker.postMessage({ type: "status", message: sessions.has(detectorId) ? "Running detection…" : "Loading model…" });
    if (!sessions.has(detectorId)) {
      sessions.set(detectorId, loadModel(detectorId).catch(error => { sessions.delete(detectorId); throw error; }));
    }
    const model = await sessions.get(detectorId) as ort.InferenceSession;
    worker.postMessage({ type: "status", message: "Running detection…" });
    tensor = new ort.Tensor("float32", event.data.data, [1, 3, backend.input.size, backend.input.size]);
    const start = performance.now();
    output = await model.run({ [model.inputNames[0]]: tensor });
    const inferenceMs = Math.round(performance.now() - start);
    const result = output[model.outputNames[0]];
    const detections = backend.decode({ data: result.data as Float32Array, dims: result.dims }, event.data.width, event.data.height);
    worker.postMessage({ type: "result", detections, inferenceMs });
  } catch (error) {
    worker.postMessage({ type: "error", message: error instanceof Error ? error.message : "Inference failed." });
  } finally {
    tensor?.dispose();
    if (output) Object.values(output).forEach(value => value.dispose());
  }
};
