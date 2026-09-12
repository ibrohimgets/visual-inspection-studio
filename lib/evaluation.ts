/**
 * Reproducible evaluation primitives for the zero/few-shot inspection study.
 *
 * This module intentionally has no model calls. It evaluates recorded
 * predictions against a versioned ground-truth manifest so VLM, detector, and
 * hybrid runs can be compared using the same protocol.
 */

export const DSPCBSD_PLUS = {
  id: "dspcbsd-plus",
  title: "DsPCBSD+",
  domain: "PCB surface-defect detection",
  source: "https://figshare.com/articles/dataset/DsPCBSD_/24970329",
  doi: "10.6084/m9.figshare.24970329",
  license: "CC BY 4.0",
  annotation: "bounding-box",
  imageCount: 10259,
  boxCount: 20276,
  classes: ["SH", "SP", "SC", "OP", "MB", "HB", "CS", "CFO", "BMFO"],
} as const;

export type DatasetSplit = "train" | "validation" | "test";
export type EvaluationBox = {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type GroundTruthImage = {
  imageId: string;
  file: string;
  width: number;
  height: number;
  group?: string;
  split?: DatasetSplit;
  boxes: EvaluationBox[];
};
export type Prediction = EvaluationBox & {
  confidence: number;
  source?: string;
  uncertainty?: number;
  decision?: "accept" | "review" | "abstain";
};
export type PredictionRecord = {
  imageId: string;
  inferenceMs?: number;
  predictions: Prediction[];
};
export type DatasetManifest = {
  schemaVersion: 1;
  dataset: typeof DSPCBSD_PLUS | { id: string; title: string; license: string; classes: string[]; [key: string]: unknown };
  imageRoot?: string;
  images: GroundTruthImage[];
};

const SPLITS: DatasetSplit[] = ["train", "validation", "test"];
const EPSILON = 1e-12;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSplit(value: unknown): value is DatasetSplit {
  return typeof value === "string" && SPLITS.includes(value as DatasetSplit);
}

function classSet(dataset: DatasetManifest["dataset"]) {
  return new Set(dataset.classes);
}

/** Validate the complete manifest before a run is allowed to produce metrics. */
export function validateManifest(manifest: DatasetManifest): string[] {
  const errors: string[] = [];
  if (!manifest || manifest.schemaVersion !== 1) errors.push("Manifest schemaVersion must be 1.");
  if (!manifest?.dataset?.id) errors.push("Manifest dataset.id is required.");
  if (!Array.isArray(manifest?.dataset?.classes) || !manifest.dataset.classes.length) errors.push("Manifest dataset.classes must be non-empty.");
  if (!Array.isArray(manifest?.images)) return [...errors, "Manifest images must be an array."];
  const classes = classSet(manifest.dataset);
  const imageIds = new Set<string>();
  for (const [index, image] of manifest.images.entries()) {
    const prefix = `images[${index}]`;
    if (!image || typeof image.imageId !== "string" || !image.imageId.trim()) errors.push(`${prefix}.imageId is required.`);
    if (imageIds.has(image.imageId)) errors.push(`${prefix}.imageId duplicates ${image.imageId}.`);
    imageIds.add(image.imageId);
    if (typeof image.file !== "string" || !image.file) errors.push(`${prefix}.file is required.`);
    if (!finite(image.width) || image.width <= 0 || !finite(image.height) || image.height <= 0) errors.push(`${prefix} dimensions must be positive finite numbers.`);
    if (image.split !== undefined && !isSplit(image.split)) errors.push(`${prefix}.split must be train, validation, or test.`);
    if (!Array.isArray(image.boxes)) { errors.push(`${prefix}.boxes must be an array.`); continue; }
    for (const [boxIndex, box] of image.boxes.entries()) {
      const boxPrefix = `${prefix}.boxes[${boxIndex}]`;
      if (!classes.has(box.label)) errors.push(`${boxPrefix}.label is not in dataset.classes.`);
      if (![box.x, box.y, box.width, box.height].every(finite)) errors.push(`${boxPrefix} coordinates must be finite numbers.`);
      if (box.width <= 0 || box.height <= 0) errors.push(`${boxPrefix} width and height must be positive.`);
      if (box.x < 0 || box.y < 0 || box.x + box.width > image.width + EPSILON || box.y + box.height > image.height + EPSILON) errors.push(`${boxPrefix} must stay inside image bounds.`);
    }
  }
  return errors;
}

/** Stable FNV-1a hash; avoids runtime-dependent random split assignments. */
export function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Assign splits by group, not by individual image. This prevents near-duplicate
 * crops from leaking between train, validation, and test.
 */
export function assignSplits(images: GroundTruthImage[], seed = "dspcbsd-plus-v1", ratios = { train: .8, validation: .1, test: .1 }) {
  const total = ratios.train + ratios.validation + ratios.test;
  if (![ratios.train, ratios.validation, ratios.test].every(value => value > 0) || Math.abs(total - 1) > EPSILON) throw new Error("Split ratios must be positive and sum to 1.");
  return images.map(image => {
    const bucket = stableHash(`${seed}:${image.group || image.imageId}`) / 0x100000000;
    const split: DatasetSplit = bucket < ratios.train ? "train" : bucket < ratios.train + ratios.validation ? "validation" : "test";
    return { ...image, split };
  });
}

export function boxIou(a: EvaluationBox, b: EvaluationBox) {
  const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

export function validatePredictionRecords(manifest: DatasetManifest, records: PredictionRecord[]): string[] {
  const errors: string[] = [];
  const images = new Map(manifest.images.map(image => [image.imageId, image]));
  const classes = classSet(manifest.dataset);
  const seen = new Set<string>();
  for (const [index, record] of records.entries()) {
    const prefix = `results[${index}]`;
    if (seen.has(record.imageId)) errors.push(`${prefix}.imageId duplicates ${record.imageId}.`);
    seen.add(record.imageId);
    const image = images.get(record.imageId);
    if (!image) { errors.push(`${prefix}.imageId is not present in the manifest.`); continue; }
    if (!Array.isArray(record.predictions)) { errors.push(`${prefix}.predictions must be an array.`); continue; }
    for (const [predictionIndex, prediction] of record.predictions.entries()) {
      const predictionPrefix = `${prefix}.predictions[${predictionIndex}]`;
      if (!classes.has(prediction.label)) errors.push(`${predictionPrefix}.label is not in dataset.classes.`);
      if (![prediction.x, prediction.y, prediction.width, prediction.height, prediction.confidence].every(finite)) errors.push(`${predictionPrefix} contains non-finite values.`);
      if (prediction.width <= 0 || prediction.height <= 0 || prediction.confidence < 0 || prediction.confidence > 1) errors.push(`${predictionPrefix} has invalid dimensions or confidence.`);
      if (prediction.x < 0 || prediction.y < 0 || prediction.x + prediction.width > image.width + EPSILON || prediction.y + prediction.height > image.height + EPSILON) errors.push(`${predictionPrefix} must stay inside image bounds.`);
    }
  }
  return errors;
}

type MatchCounts = { truePositives: number; falsePositives: number; falseNegatives: number };

function emptyCounts(): MatchCounts { return { truePositives: 0, falsePositives: 0, falseNegatives: 0 }; }

function addCounts(target: MatchCounts, source: MatchCounts) {
  target.truePositives += source.truePositives;
  target.falsePositives += source.falsePositives;
  target.falseNegatives += source.falseNegatives;
}

function matchImage(groundTruth: EvaluationBox[], predictions: Prediction[], iouThreshold: number): MatchCounts {
  const matched = new Set<number>();
  const counts = emptyCounts();
  for (const prediction of [...predictions].sort((a, b) => b.confidence - a.confidence)) {
    let bestIndex = -1;
    let bestIou = 0;
    for (let index = 0; index < groundTruth.length; index++) {
      const target = groundTruth[index];
      if (matched.has(index) || target.label !== prediction.label) continue;
      const overlap = boxIou(target, prediction);
      if (overlap > bestIou) { bestIou = overlap; bestIndex = index; }
    }
    if (bestIndex >= 0 && bestIou >= iouThreshold) { matched.add(bestIndex); counts.truePositives++; }
    else counts.falsePositives++;
  }
  counts.falseNegatives = groundTruth.length - matched.size;
  return counts;
}

function safeRatio(numerator: number, denominator: number) { return denominator ? numerator / denominator : 0; }

function metricsFromCounts(counts: MatchCounts) {
  const precision = safeRatio(counts.truePositives, counts.truePositives + counts.falsePositives);
  const recall = safeRatio(counts.truePositives, counts.truePositives + counts.falseNegatives);
  return { ...counts, precision, recall, f1: safeRatio(2 * precision * recall, precision + recall) };
}

function averagePrecision(groundTruthByImage: Map<string, EvaluationBox[]>, predictions: Array<Prediction & { imageId: string }>, label: string, iouThreshold: number) {
  const targets = new Map<string, EvaluationBox[]>();
  let targetCount = 0;
  for (const [imageId, boxes] of groundTruthByImage) {
    const selected = boxes.filter(box => box.label === label);
    targets.set(imageId, selected);
    targetCount += selected.length;
  }
  if (!targetCount) return null;
  const matched = new Map<string, Set<number>>();
  const ranked = predictions.filter(prediction => prediction.label === label).sort((a, b) => b.confidence - a.confidence);
  let truePositives = 0;
  let falsePositives = 0;
  const curve: Array<{ precision: number; recall: number }> = [];
  for (const prediction of ranked) {
    const imageId = prediction.imageId;
    const imageTargets = targets.get(imageId) || [];
    const used = matched.get(imageId) || new Set<number>();
    let bestIndex = -1;
    let bestIou = 0;
    for (let index = 0; index < imageTargets.length; index++) {
      if (used.has(index)) continue;
      const overlap = boxIou(imageTargets[index], prediction);
      if (overlap > bestIou) { bestIou = overlap; bestIndex = index; }
    }
    if (bestIndex >= 0 && bestIou >= iouThreshold) { used.add(bestIndex); matched.set(imageId, used); truePositives++; }
    else falsePositives++;
    curve.push({ precision: safeRatio(truePositives, truePositives + falsePositives), recall: truePositives / targetCount });
  }
  let area = 0;
  for (let step = 0; step <= 100; step++) {
    const recallPoint = step / 100;
    const bestPrecision = curve.reduce((best, point) => point.recall + EPSILON >= recallPoint ? Math.max(best, point.precision) : best, 0);
    area += bestPrecision;
  }
  return area / 101;
}

export type EvaluationReport = {
  schemaVersion: 1;
  dataset: DatasetManifest["dataset"];
  split: DatasetSplit | "all";
  imageCount: number;
  groundTruthBoxCount: number;
  predictionCount: number;
  iouThreshold: number;
  confidenceThreshold: number;
  metrics: ReturnType<typeof metricsFromCounts> & { meanAveragePrecision: number; perClass: Record<string, ReturnType<typeof metricsFromCounts> & { averagePrecision: number | null }> };
  latency: LatencySummary;
};

export function evaluatePredictions(manifest: DatasetManifest, records: PredictionRecord[], options: { split?: DatasetSplit | "all"; iouThreshold?: number; confidenceThreshold?: number } = {}): EvaluationReport {
  const errors = validateManifest(manifest);
  if (errors.length) throw new Error(`Invalid manifest:\n${errors.join("\n")}`);
  const predictionErrors = validatePredictionRecords(manifest, records);
  if (predictionErrors.length) throw new Error(`Invalid predictions:\n${predictionErrors.join("\n")}`);
  const split = options.split || "all";
  const images = manifest.images.filter(image => split === "all" || image.split === split);
  if (split !== "all" && images.some(image => !image.split)) throw new Error(`Manifest images must have split values before evaluating ${split}.`);
  const selectedIds = new Set(images.map(image => image.imageId));
  const groundTruthByImage = new Map(images.map(image => [image.imageId, image.boxes]));
  const predictions: Array<Prediction & { imageId: string }> = [];
  let predictionCount = 0;
  for (const record of records) {
    if (!selectedIds.has(record.imageId)) continue;
    for (const prediction of record.predictions) {
      predictions.push({ ...prediction, imageId: record.imageId });
      predictionCount++;
    }
  }
  const threshold = options.confidenceThreshold ?? 0;
  const filtered = predictions.filter(prediction => prediction.confidence >= threshold);
  const counts = emptyCounts();
  for (const image of images) addCounts(counts, matchImage(image.boxes, filtered.filter(prediction => prediction.imageId === image.imageId), options.iouThreshold ?? .5));
  const perClass: EvaluationReport["metrics"]["perClass"] = {};
  const mapValues: number[] = [];
  for (const label of manifest.dataset.classes) {
    const classPredictions = filtered.filter(prediction => prediction.label === label);
    const classCounts = emptyCounts();
    for (const image of images) addCounts(classCounts, matchImage(image.boxes.filter(box => box.label === label), classPredictions.filter(prediction => prediction.imageId === image.imageId), options.iouThreshold ?? .5));
    const ap = averagePrecision(groundTruthByImage, predictions, label, options.iouThreshold ?? .5);
    if (ap !== null) mapValues.push(ap);
    perClass[label] = { ...metricsFromCounts(classCounts), averagePrecision: ap };
  }
  const latency = summarizeLatency(records.filter(record => selectedIds.has(record.imageId)).map(record => record.inferenceMs).filter((value): value is number => finite(value)));
  return {
    schemaVersion: 1, dataset: manifest.dataset, split, imageCount: images.length,
    groundTruthBoxCount: images.reduce((sum, image) => sum + image.boxes.length, 0), predictionCount,
    iouThreshold: options.iouThreshold ?? .5, confidenceThreshold: threshold,
    metrics: { ...metricsFromCounts(counts), meanAveragePrecision: mapValues.length ? mapValues.reduce((sum, value) => sum + value, 0) / mapValues.length : 0, perClass },
    latency,
  };
}

export type CalibrationRow = { score: number; correct: boolean };
export type CalibrationSummary = { count: number; brierScore: number; expectedCalibrationError: number; bins: Array<{ lower: number; upper: number; count: number; meanScore: number; accuracy: number }> };

export function calibrationMetrics(rows: CalibrationRow[], binCount = 10): CalibrationSummary {
  if (!Number.isInteger(binCount) || binCount < 1) throw new Error("binCount must be a positive integer.");
  for (const row of rows) if (!finite(row.score) || row.score < 0 || row.score > 1) throw new Error("Calibration scores must be finite values between 0 and 1.");
  const bins = Array.from({ length: binCount }, (_, index) => ({ lower: index / binCount, upper: (index + 1) / binCount, count: 0, meanScore: 0, accuracy: 0 }));
  let brierScore = 0;
  for (const row of rows) {
    const index = Math.min(binCount - 1, Math.floor(row.score * binCount));
    const bin = bins[index];
    bin.count++; bin.meanScore += row.score; bin.accuracy += row.correct ? 1 : 0;
    brierScore += (row.score - (row.correct ? 1 : 0)) ** 2;
  }
  let expectedCalibrationError = 0;
  for (const bin of bins) if (bin.count) {
    bin.meanScore /= bin.count; bin.accuracy /= bin.count;
    expectedCalibrationError += bin.count / (rows.length || 1) * Math.abs(bin.meanScore - bin.accuracy);
  }
  return { count: rows.length, brierScore: safeRatio(brierScore, rows.length), expectedCalibrationError, bins };
}

export type SelectiveRiskPoint = { coverage: number; accepted: number; accuracy: number; risk: number; threshold: number };

export function selectiveRisk(rows: CalibrationRow[], coverageSteps = 10): SelectiveRiskPoint[] {
  if (!Number.isInteger(coverageSteps) || coverageSteps < 1) throw new Error("coverageSteps must be a positive integer.");
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  return Array.from({ length: coverageSteps }, (_, index) => {
    const coverage = (index + 1) / coverageSteps;
    const accepted = Math.max(1, Math.ceil(sorted.length * coverage));
    const correct = sorted.slice(0, accepted).filter(row => row.correct).length;
    const accuracy = safeRatio(correct, accepted);
    return { coverage: accepted / (sorted.length || 1), accepted, accuracy, risk: 1 - accuracy, threshold: sorted[accepted - 1]?.score ?? 1 };
  });
}

export type LatencySummary = { count: number; meanMs: number | null; p50Ms: number | null; p95Ms: number | null; minMs: number | null; maxMs: number | null };

export function summarizeLatency(values: number[]): LatencySummary {
  const sorted = values.filter(value => finite(value) && value >= 0).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, meanMs: null, p50Ms: null, p95Ms: null, minMs: null, maxMs: null };
  const percentile = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
  return { count: sorted.length, meanMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length, p50Ms: percentile(.5), p95Ms: percentile(.95), minMs: sorted[0], maxMs: sorted[sorted.length - 1] };
}

export function parsePredictionRecords(value: unknown): PredictionRecord[] {
  const records = Array.isArray(value) ? value : (value && typeof value === "object" && Array.isArray((value as { results?: unknown }).results) ? (value as { results: unknown[] }).results : null);
  if (!records) throw new Error("Predictions must be an array or an object with a results array.");
  return records.map((record, index) => {
    if (!record || typeof record !== "object" || typeof (record as PredictionRecord).imageId !== "string" || !Array.isArray((record as PredictionRecord).predictions)) throw new Error(`Prediction record ${index} is invalid.`);
    return record as PredictionRecord;
  });
}
