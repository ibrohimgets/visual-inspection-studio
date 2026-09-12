import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyClassThresholds, selectMicroF1ClassThresholds } from "../lib/detector-tuning.ts";
import { evaluatePredictions, parsePredictionRecords, validateManifest } from "../lib/evaluation.ts";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.resolve(root, argument("manifest", "evaluation/dspcbsd-plus.manifest.json"));
const predictionsPath = path.resolve(root, argument("predictions", "reports/local/detector/yolox-nano-pcb/validation-predictions.json"));
const outputPath = path.resolve(root, argument("output", "reports/local/detector/yolox-nano-pcb/class-thresholds.json"));
const initialThreshold = Number(argument("initial-threshold", ".37"));
const minimumThreshold = Number(argument("minimum-threshold", ".05"));
const maximumThreshold = Number(argument("maximum-threshold", ".9"));
const step = Number(argument("step", ".01"));
if (![initialThreshold, minimumThreshold, maximumThreshold, step].every(Number.isFinite) || minimumThreshold < 0 || maximumThreshold > 1 || minimumThreshold >= maximumThreshold || step <= 0) throw new Error("Invalid threshold search range.");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const predictionFile = JSON.parse(await readFile(predictionsPath, "utf8"));
if (validateManifest(manifest).length) throw new Error("Manifest is invalid.");
if (predictionFile.trainingSplit !== "train" || predictionFile.predictionSplit !== "validation" || predictionFile.testSplitAccessed !== false) throw new Error("Threshold tuning requires train-only model provenance, validation-only predictions, and a sealed test split.");
const records = parsePredictionRecords(predictionFile);
const validationImageCount = manifest.images.filter(image => image.split === "validation").length;
if (records.length !== validationImageCount) throw new Error("Predictions must cover the complete validation split.");

const thresholds = [];
for (let value = minimumThreshold; value <= maximumThreshold + 1e-9; value += step) thresholds.push(Number(value.toFixed(6)));
if (!thresholds.includes(initialThreshold)) thresholds.push(initialThreshold);
thresholds.sort((a, b) => a - b);
const curves = Object.fromEntries(manifest.dataset.classes.map(label => [label, []]));
for (const confidenceThreshold of thresholds) {
  const evaluation = evaluatePredictions(manifest, records, { split: "validation", iouThreshold: .5, confidenceThreshold });
  for (const label of manifest.dataset.classes) {
    const metrics = evaluation.metrics.perClass[label];
    curves[label].push({
      confidenceThreshold,
      truePositives: metrics.truePositives,
      falsePositives: metrics.falsePositives,
      falseNegatives: metrics.falseNegatives,
      precision: metrics.precision,
      recall: metrics.recall,
      f1: metrics.f1,
    });
  }
}

const selected = selectMicroF1ClassThresholds(curves, initialThreshold);
const baselineRecords = records.map(record => ({ ...record, predictions: record.predictions.filter(prediction => prediction.confidence >= initialThreshold) }));
const tunedRecords = applyClassThresholds(records, selected.thresholds);
const baseline = evaluatePredictions(manifest, baselineRecords, { split: "validation", iouThreshold: .5 });
const tuned = evaluatePredictions(manifest, tunedRecords, { split: "validation", iouThreshold: .5 });
const ranked = evaluatePredictions(manifest, records, { split: "validation", iouThreshold: .5, confidenceThreshold: 0 });
const output = {
  schemaVersion: 1,
  model: predictionFile.model,
  checkpointEpoch: predictionFile.checkpointEpoch,
  trainingSplit: "train",
  tuningSplit: "validation",
  testSplitAccessed: false,
  selectionRule: "Coordinate descent over cached per-class count curves to maximize micro F1 at IoU 0.5; ties prefer recall, precision, then lower threshold.",
  search: { minimumThreshold, maximumThreshold, step, initialThreshold, passes: selected.passes },
  thresholds: selected.thresholds,
  rankingMap50AtProposalFloor: ranked.metrics.meanAveragePrecision,
  baseline,
  tuned,
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
  output: outputPath,
  thresholds: output.thresholds,
  rankingMap50AtProposalFloor: output.rankingMap50AtProposalFloor,
  baseline: { ...baseline.metrics, perClass: undefined },
  tuned: { ...tuned.metrics, perClass: undefined },
  testSplitAccessed: false,
}, null, 2));
