import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHttpVlmAdapter } from "../lib/vlm.ts";
import { evaluatePredictions, validateManifest } from "../lib/evaluation.ts";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const manifestPath = path.resolve(repoRoot, argument("manifest", "evaluation/dspcbsd-plus.manifest.json"));
const outputPath = path.resolve(repoRoot, argument("output", "reports/local/vlm-zero-shot-validation-subset.json"));
const endpoint = argument("endpoint", "http://127.0.0.1:8008/inspect");
const limit = Math.max(1, Math.min(25, Number(argument("limit", "6"))));
const model = argument("model", "HuggingFaceTB/SmolVLM-256M-Instruct");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const manifestErrors = validateManifest(manifest);
if (manifestErrors.length) throw new Error(`Invalid manifest:\n${manifestErrors.join("\n")}`);

const task = {
  id: "dspcbsd-plus",
  title: "PCB surface-defect inspection",
  instructions: "Inspect this PCB image for visible surface defects. This is a zero-shot capability probe, not a trained defect detector. If the image is ambiguous, return uncertain with no finding rather than inventing one.",
  classes: [
    ["SH", "short: an unintended electrical connection between conductors"],
    ["SP", "spur: a thin unwanted conductor branch"],
    ["SC", "spurious copper: unwanted copper residue or island"],
    ["OP", "open: a break or interruption in a conductor"],
    ["MB", "mouse bite: a rough bitten edge or missing material"],
    ["HB", "hole breakout: a hole or drill breaks into a nearby conductor"],
    ["CS", "conductor scratch: a visible scratch across a conductor"],
    ["CFO", "copper foreign object: unwanted copper-shaped material"],
    ["BMFO", "base-material foreign object: unwanted non-copper material"],
  ].map(([label, description]) => ({ label, description })),
};

const validationImages = manifest.images
  .filter(image => image.split === "validation")
  .sort((a, b) => a.imageId.localeCompare(b.imageId));
if (!validationImages.length) throw new Error("Manifest has no validation images.");

// Prefer one deterministic example per class, then fill remaining slots in order.
const selected = [];
for (const label of manifest.dataset.classes) {
  const image = validationImages.find(candidate => candidate.boxes.some(box => box.label === label) && !selected.includes(candidate));
  if (image) selected.push(image);
  if (selected.length >= limit) break;
}
for (const image of validationImages) {
  if (selected.length >= limit) break;
  if (!selected.includes(image)) selected.push(image);
}

const adapter = createHttpVlmAdapter({ endpoint, model, timeoutMs: 10 * 60 * 1000 });
const records = [];
const images = [];
const startedAt = new Date().toISOString();
for (const image of selected) {
  const imagePath = path.resolve(repoRoot, manifest.imageRoot || ".", image.file);
  const bytes = await readFile(imagePath);
  const extension = path.extname(image.file).toLowerCase();
  const mimeType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  const request = { image: { mimeType, base64: bytes.toString("base64"), width: image.width, height: image.height }, task, mode: "zero-shot", promptVersion: "pcb-zero-shot-v1" };
  try {
    const result = await adapter.inspect(request);
    records.push({ imageId: image.imageId, inferenceMs: result.latencyMs, predictions: result.findings.map(finding => ({ label: finding.label, x: finding.x, y: finding.y, width: finding.width, height: finding.height, confidence: finding.modelScore, source: finding.source, decision: finding.decision })) });
    images.push({ imageId: image.imageId, file: image.file, groundTruth: image.boxes, result, rawOutput: result.rawOutput || undefined });
    console.log(`${image.imageId}: ${result.status}, ${result.findings.length} findings, ${result.latencyMs} ms`);
  } catch (error) {
    records.push({ imageId: image.imageId, inferenceMs: Number.isFinite(error?.latencyMs) ? error.latencyMs : undefined, predictions: [] });
    images.push({ imageId: image.imageId, file: image.file, groundTruth: image.boxes, error: error instanceof Error ? error.message : String(error), rawOutput: error?.rawOutput || undefined });
    console.log(`${image.imageId}: ERROR ${error instanceof Error ? error.message : String(error)}`);
  }
}

const subsetManifest = { ...manifest, images: selected };
const evaluation = evaluatePredictions(subsetManifest, records, { split: "validation", iouThreshold: 0.5 });
const output = {
  schemaVersion: 1,
  run: { model, endpoint, mode: "zero-shot", promptVersion: "pcb-zero-shot-v1", startedAt, finishedAt: new Date().toISOString(), subsetSelection: "deterministic validation images, one per class where available", imageCount: selected.length },
  images,
  predictionRecords: records,
  evaluation,
  caveat: "This is a small capability probe. Scores are not a claim about full-dataset accuracy or industrial readiness.",
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ output: outputPath, imageCount: selected.length, failures: images.filter(image => image.error).length, evaluation: { imageCount: evaluation.imageCount, predictions: evaluation.predictionCount, latency: evaluation.latency, metrics: evaluation.metrics } }, null, 2));
