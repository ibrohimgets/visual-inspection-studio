import { readFile, writeFile } from "node:fs/promises";
import { assignSplits, evaluatePredictions, validateManifest, DSPCBSD_PLUS } from "../lib/evaluation.ts";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: npm run evaluate -- --manifest MANIFEST.json --predictions PREDICTIONS.json [--split test] [--iou 0.5] [--confidence 0] [--resolved-manifest SPLIT-MANIFEST.json] [--output REPORT.json]");
  process.exit(0);
}

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function required(name) {
  const value = argument(name);
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

const manifestPath = required("manifest");
const predictionsPath = required("predictions");
const outputPath = argument("output");
const resolvedManifestPath = argument("resolved-manifest");
const split = argument("split", "test");
const seed = argument("seed", "dspcbsd-plus-v1");
const iouThreshold = Number(argument("iou", "0.5"));
const confidenceThreshold = Number(argument("confidence", "0"));

if (!["all", "train", "validation", "test"].includes(split)) throw new Error("--split must be all, train, validation, or test.");
if (!Number.isFinite(iouThreshold) || iouThreshold <= 0 || iouThreshold > 1) throw new Error("--iou must be between 0 and 1.");
if (!Number.isFinite(confidenceThreshold) || confidenceThreshold < 0 || confidenceThreshold > 1) throw new Error("--confidence must be between 0 and 1.");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const validationErrors = validateManifest(manifest);
if (validationErrors.length) throw new Error(`Invalid manifest:\n${validationErrors.join("\n")}`);
if (manifest.dataset.id === DSPCBSD_PLUS.id && manifest.dataset.license !== DSPCBSD_PLUS.license) throw new Error("DsPCBSD+ manifest license must remain CC BY 4.0.");

const splitCount = manifest.images.filter(image => image.split).length;
if (splitCount > 0 && splitCount < manifest.images.length) throw new Error("Manifest split values must be present for every image or none of them.");
const images = splitCount === manifest.images.length ? manifest.images : assignSplits(manifest.images, seed);
const splitManifest = { ...manifest, images };
if (resolvedManifestPath) await writeFile(resolvedManifestPath, JSON.stringify(splitManifest, null, 2) + "\n", "utf8");
const predictionsFile = JSON.parse(await readFile(predictionsPath, "utf8"));
const records = Array.isArray(predictionsFile) ? predictionsFile : predictionsFile.results;
if (!Array.isArray(records)) throw new Error("Predictions must be an array or an object with a results array.");
const report = evaluatePredictions(splitManifest, records, { split, iouThreshold, confidenceThreshold });

if (outputPath) await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
  dataset: report.dataset.id,
  split: report.split,
  images: report.imageCount,
  groundTruthBoxes: report.groundTruthBoxCount,
  predictions: report.predictionCount,
  precision: Number(report.metrics.precision.toFixed(4)),
  recall: Number(report.metrics.recall.toFixed(4)),
  f1: Number(report.metrics.f1.toFixed(4)),
  mAP: Number(report.metrics.meanAveragePrecision.toFixed(4)),
  latency: report.latency,
  output: outputPath || null,
  resolvedManifest: resolvedManifestPath || null,
  splitSeed: seed,
}, null, 2));
