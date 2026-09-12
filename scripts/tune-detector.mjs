import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluatePredictions, parsePredictionRecords, validateManifest } from "../lib/evaluation.ts";
import { evaluateLocalization } from "../lib/experiment.ts";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.resolve(root, argument("manifest", "evaluation/dspcbsd-plus.manifest.json"));
const predictionsPath = path.resolve(root, argument("predictions", "reports/local/detector/yolox-nano-pcb/validation-predictions.json"));
const outputPath = path.resolve(root, argument("output", "reports/local/detector/yolox-nano-pcb/validation-thresholds.json"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const predictionFile = JSON.parse(await readFile(predictionsPath, "utf8"));
if (validateManifest(manifest).length) throw new Error("Manifest is invalid.");
if (predictionFile.trainingSplit !== "train" || predictionFile.predictionSplit !== "validation" || predictionFile.testSplitAccessed !== false) throw new Error("Detector provenance must be train-only with validation-only predictions.");
const records = parsePredictionRecords(predictionFile);
const thresholds = argument("thresholds", ".01,.02,.03,.05,.075,.1,.15,.2,.25,.3,.32,.34,.35,.36,.37,.38,.39,.4,.41,.42,.43,.44,.45,.46,.48,.5,.6,.7,.8").split(",").map(Number);
if (!thresholds.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error("Thresholds must be between 0 and 1.");

function compactLocalization(localization) {
  return {
    iouThreshold: localization.iouThreshold,
    localizedMatches: localization.localizedMatches,
    localizationFalsePositives: localization.localizationFalsePositives,
    localizationMissedDefects: localization.localizationMissedDefects,
    localizationPrecision: localization.localizationPrecision,
    localizationRecall: localization.localizationRecall,
    classificationCorrect: localization.classificationCorrect,
    classificationAccuracyOnLocalized: localization.classificationAccuracyOnLocalized,
  };
}

const rankedEvaluation = evaluatePredictions(manifest, records, { split: "validation", iouThreshold: .5, confidenceThreshold: 0 });

const rows = thresholds.map(confidenceThreshold => {
  const filtered = records.map(record => ({ ...record, predictions: record.predictions.filter(prediction => prediction.confidence >= confidenceThreshold) }));
  const evaluation = evaluatePredictions(manifest, filtered, { split: "validation", iouThreshold: .5, confidenceThreshold: 0 });
  const localization = evaluateLocalization(manifest, filtered, { split: "validation", iouThreshold: .5 });
  return {
    confidenceThreshold,
    predictionCount: filtered.reduce((sum, record) => sum + record.predictions.length, 0),
    truePositives: evaluation.metrics.truePositives,
    falsePositives: evaluation.metrics.falsePositives,
    falseNegatives: evaluation.metrics.falseNegatives,
    precision: evaluation.metrics.precision,
    recall: evaluation.metrics.recall,
    f1: evaluation.metrics.f1,
    thresholdedMap50: evaluation.metrics.meanAveragePrecision,
    perClass: evaluation.metrics.perClass,
    localization: compactLocalization(localization),
    latency: evaluation.latency,
  };
});
const selected = [...rows].sort((a, b) => b.f1 - a.f1 || b.recall - a.recall || b.precision - a.precision || a.confidenceThreshold - b.confidenceThreshold)[0];
const output = {
  schemaVersion: 1,
  model: predictionFile.model,
  checkpointEpoch: predictionFile.checkpointEpoch,
  trainingSplit: "train",
  tuningSplit: "validation",
  testSplitAccessed: false,
  selectionRule: "Maximum class-aware F1 at IoU 0.5; ties prefer recall, then precision, then lower confidence threshold.",
  proposalConfidence: predictionFile.proposalConfidence,
  nmsThreshold: predictionFile.nmsThreshold,
  rankingMap50AtProposalFloor: rankedEvaluation.metrics.meanAveragePrecision,
  rankingPerClassAtProposalFloor: Object.fromEntries(Object.entries(rankedEvaluation.metrics.perClass).map(([label, metrics]) => [label, metrics.averagePrecision])),
  wallClockInference: {
    totalMs: predictionFile.totalInferenceMs,
    meanMsPerImage: predictionFile.totalInferenceMs / predictionFile.imageCount,
    imagesPerSecond: predictionFile.imageCount / (predictionFile.totalInferenceMs / 1000),
  },
  selected,
  curve: rows,
  caveat: "Validation-only threshold tuning. rankingMap50AtProposalFloor is 101-point class mean AP at IoU 0.5 using proposals at the recorded floor; thresholdedMap50 is diagnostic only. Neither value is COCO mAP@[.5:.95].",
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
  output: outputPath,
  selected: {
    ...selected,
    perClass: undefined,
  },
  rankingMap50AtProposalFloor: output.rankingMap50AtProposalFloor,
  wallClockInference: output.wallClockInference,
  testSplitAccessed: false,
}, null, 2));
