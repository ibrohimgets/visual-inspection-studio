/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/wasm";
import { decodeOutput, INPUT_SIZE, MODEL } from "./detection";

let session: Promise<ort.InferenceSession> | undefined;
const worker = self as unknown as DedicatedWorkerGlobalScope;
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL("/runtime/", worker.location.origin).href;
ort.env.logLevel = "error";

async function loadModel() {
  const response = await fetch("/models/yolox_nano.onnx");
  if (!response.ok) throw new Error(`Model download failed (${response.status}).`);
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  if (hash !== MODEL.sha256) throw new Error("Model integrity check failed. Reload to download it again.");
  return ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
}

worker.onmessage = async (event: MessageEvent<{ data: Float32Array; width: number; height: number }>) => {
  let tensor: ort.Tensor | undefined;
  let output: ort.InferenceSession.OnnxValueMapType | undefined;
  try {
    worker.postMessage({ type: "status", message: session ? "Running detection…" : "Loading model…" });
    session ??= loadModel().catch(error => { session = undefined; throw error; });
    const model = await session;
    worker.postMessage({ type: "status", message: "Running detection…" });
    tensor = new ort.Tensor("float32", event.data.data, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const start = performance.now();
    output = await model.run({ [model.inputNames[0]]: tensor });
    const inferenceMs = Math.round(performance.now() - start);
    const result = output[model.outputNames[0]];
    const detections = decodeOutput(result.data as Float32Array, event.data.width, event.data.height);
    worker.postMessage({ type: "result", detections, inferenceMs });
  } catch (error) {
    worker.postMessage({ type: "error", message: error instanceof Error ? error.message : "Inference failed." });
  } finally {
    tensor?.dispose();
    if (output) Object.values(output).forEach(value => value.dispose());
  }
};
