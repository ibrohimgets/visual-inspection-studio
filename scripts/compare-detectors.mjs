import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const root = path.resolve(import.meta.dirname, "..");
const baselinePath = path.resolve(root, argument("baseline", "detector/experiments/2026-09-12-yolox-nano-validation.json"));
const baselineCheckpointPath = path.resolve(root, argument("baseline-checkpoint", "reports/local/detector/yolox-nano-pcb/latest.pth"));
const candidateTuningPath = path.resolve(root, argument("candidate-tuning", "reports/local/detector/yolov8n-pcb/validation-thresholds.json"));
const candidatePredictionsPath = path.resolve(root, argument("candidate-predictions", "reports/local/detector/yolov8n-pcb/validation-predictions.json"));
const candidateTrainingPath = path.resolve(root, argument("candidate-training", "reports/local/detector/yolov8n-pcb/runs/yolov8n-256-e5-s20260912/training-report.json"));
const outputStem = path.resolve(root, argument("output", "detector/experiments/2026-09-12-yolox-vs-yolov8n-validation"));

const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const candidateTuning = JSON.parse(await readFile(candidateTuningPath, "utf8"));
const candidatePredictions = JSON.parse(await readFile(candidatePredictionsPath, "utf8"));
const candidateTraining = JSON.parse(await readFile(candidateTrainingPath, "utf8"));
const baselineCheckpoint = await stat(baselineCheckpointPath);

if (baseline.testSplitAccessed !== false
  || candidateTuning.testSplitAccessed !== false
  || candidatePredictions.testSplitAccessed !== false
  || candidateTraining.testSplitAccessed !== false) {
  throw new Error("Every comparison input must prove that the frozen test split was not accessed.");
}
if (baseline.validation.split !== "validation"
  || candidateTuning.tuningSplit !== "validation"
  || candidatePredictions.predictionSplit !== "validation") {
  throw new Error("Detector comparison is validation-only.");
}
if (baseline.training.split !== "train" || candidateTraining.trainingSplit !== "train") {
  throw new Error("Both detector checkpoints must use only the train split.");
}
if (baseline.training.imageCount !== candidateTraining.trainImages
  || baseline.validation.imageCount !== candidateTraining.validationImages
  || baseline.training.inputSize !== candidateTraining.imageSize) {
  throw new Error("Detector comparison inputs do not use the same data and input size.");
}
if (candidatePredictions.checkpointSha256 !== candidateTraining.bestCheckpointSha256) {
  throw new Error("Candidate prediction and training checkpoint provenance differ.");
}

const baselineRow = {
  id: "yolox-nano-pcb",
  model: baseline.model,
  license: "Apache-2.0",
  inputSize: baseline.training.inputSize,
  epochs: baseline.training.epochs,
  selectedConfidenceThreshold: baseline.validation.selectedConfidenceThreshold,
  precision: baseline.validation.precision,
  recall: baseline.validation.recall,
  f1: baseline.validation.f1,
  map50: baseline.validation.rankingMap50AtProposalFloor,
  latencyMsPerImage: baseline.validation.wallClockInference.meanMsPerImage,
  imagesPerSecond: baseline.validation.wallClockInference.imagesPerSecond,
  modelBytes: baselineCheckpoint.size,
  parameterCount: Number(argument("baseline-parameters", "898314")),
};

const candidateRow = {
  id: "yolov8n-pcb-256",
  model: candidateTraining.model,
  license: candidateTraining.upstreamLicense,
  deploymentStatus: candidateTraining.deploymentStatus,
  inputSize: candidateTraining.imageSize,
  epochs: candidateTraining.epochs,
  selectedConfidenceThreshold: candidateTuning.selected.confidenceThreshold,
  precision: candidateTuning.selected.precision,
  recall: candidateTuning.selected.recall,
  f1: candidateTuning.selected.f1,
  map50: candidateTuning.rankingMap50AtProposalFloor,
  latencyMsPerImage: candidateTuning.wallClockInference.meanMsPerImage,
  imagesPerSecond: candidateTuning.wallClockInference.imagesPerSecond,
  modelBytes: candidateTraining.bestCheckpointBytes,
  parameterCount: candidateTraining.parameterCount ?? candidatePredictions.parameterCount,
};
if (!Number.isInteger(baselineRow.parameterCount) || !Number.isInteger(candidateRow.parameterCount)) {
  throw new Error("Both detectors require measured parameter counts.");
}

const deltas = Object.fromEntries(["precision", "recall", "f1", "map50", "latencyMsPerImage", "modelBytes", "parameterCount"]
  .map(key => [key, candidateRow[key] - baselineRow[key]]));
const output = {
  schemaVersion: 1,
  experiment: "YOLOX-Nano vs isolated YOLOv8n",
  dataset: "DsPCBSD+",
  trainingSplit: "train",
  tuningSplit: "validation",
  testSplitAccessed: false,
  protocol: {
    trainImages: baseline.training.imageCount,
    trainBoxes: baseline.training.boxCount,
    validationImages: baseline.validation.imageCount,
    validationBoxes: baseline.validation.boxCount,
    imageSize: baseline.training.inputSize,
    epochs: { yolox: baseline.training.epochs, yolov8: candidateTraining.epochs },
    seed: { yolox: baseline.training.seed, yolov8: candidateTraining.seed },
    proposalConfidenceFloor: candidateTuning.proposalConfidence,
    iouThreshold: baseline.validation.iouThreshold,
    selectionRule: candidateTuning.selectionRule,
    metricDefinition: "Micro class-aware P/R/F1 and 101-point class mean AP at IoU 0.5.",
  },
  detectors: [baselineRow, candidateRow],
  candidateMinusBaseline: deltas,
  notes: [
    "Validation-only engineering comparison; no frozen-test or production claim.",
    "Both runs use the same manifest split, 256px input, five epochs, and the same metric implementation.",
    "Framework-native optimizers and augmentations differ, so this compares reproducible detector pipelines rather than architecture alone.",
    "YOLOv8 remains isolated and is not loaded by the deployed application because its licensing decision is unresolved.",
    "Wall-clock latency includes validation input loading; model size is the serialized training checkpoint size.",
  ],
};

const percent = value => `${(value * 100).toFixed(2)}%`;
const signedPoints = value => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)} pp`;
const mib = value => `${(value / 1024 / 1024).toFixed(2)} MiB`;
const markdown = `# YOLOX-Nano vs isolated YOLOv8n — validation comparison

## Protocol

- Dataset: DsPCBSD+ (CC BY 4.0).
- Training: ${output.protocol.trainImages.toLocaleString()} train images and ${output.protocol.trainBoxes.toLocaleString()} boxes only.
- Threshold selection: ${output.protocol.validationImages.toLocaleString()} validation images and ${output.protocol.validationBoxes.toLocaleString()} boxes only.
- Input: ${output.protocol.imageSize} × ${output.protocol.imageSize}; five epochs per detector.
- Metrics: ${output.protocol.metricDefinition}
- Frozen test split: **not accessed**.
- Deployment: YOLOX remains the only deployed browser backend; YOLOv8n remains an isolated licensing experiment.

## Results

| Detector | Precision | Recall | F1 | mAP@0.5 | Wall latency | Throughput | Parameters | Checkpoint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| YOLOX-Nano | ${percent(baselineRow.precision)} | ${percent(baselineRow.recall)} | ${percent(baselineRow.f1)} | ${percent(baselineRow.map50)} | ${baselineRow.latencyMsPerImage.toFixed(2)} ms/image | ${baselineRow.imagesPerSecond.toFixed(2)} img/s | ${baselineRow.parameterCount.toLocaleString()} | ${mib(baselineRow.modelBytes)} |
| YOLOv8n | ${percent(candidateRow.precision)} | ${percent(candidateRow.recall)} | ${percent(candidateRow.f1)} | ${percent(candidateRow.map50)} | ${candidateRow.latencyMsPerImage.toFixed(2)} ms/image | ${candidateRow.imagesPerSecond.toFixed(2)} img/s | ${candidateRow.parameterCount.toLocaleString()} | ${mib(candidateRow.modelBytes)} |

Candidate minus baseline: precision ${signedPoints(deltas.precision)}, recall ${signedPoints(deltas.recall)}, F1 ${signedPoints(deltas.f1)}, and mAP@0.5 ${signedPoints(deltas.map50)}. Latency changes by ${deltas.latencyMsPerImage >= 0 ? "+" : ""}${deltas.latencyMsPerImage.toFixed(2)} ms/image and checkpoint size by ${(deltas.modelBytes / 1024 / 1024).toFixed(2)} MiB.

## Interpretation limits

This is a validation-only engineering comparison, not a frozen-test or production claim. Both pipelines use the exact same split, input resolution, epoch count, and evaluator, but retain framework-native training behavior; the result compares the complete reproducible detector pipelines rather than isolating architecture alone. The YOLOv8 checkpoint remains outside the deployed application.
`;

await mkdir(path.dirname(outputStem), { recursive: true });
await writeFile(`${outputStem}.json`, JSON.stringify(output, null, 2) + "\n", "utf8");
await writeFile(`${outputStem}.md`, markdown, "utf8");
console.log(JSON.stringify({ output: [`${outputStem}.json`, `${outputStem}.md`], detectors: output.detectors, candidateMinusBaseline: deltas, testSplitAccessed: false }, null, 2));
