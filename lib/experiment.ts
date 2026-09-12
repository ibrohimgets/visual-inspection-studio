import { boxIou, validateManifest, validatePredictionRecords } from "./evaluation.ts";
import type { DatasetManifest, DatasetSplit, EvaluationBox, Prediction, PredictionRecord } from "./evaluation.ts";

export type LocalizationMatch = {
  imageId: string;
  predictionLabel: string;
  groundTruthLabel: string;
  iou: number;
  classCorrect: boolean;
};

export type LocalizationDiagnostics = {
  iouThreshold: number;
  localizedMatches: number;
  localizationFalsePositives: number;
  localizationMissedDefects: number;
  localizationPrecision: number;
  localizationRecall: number;
  classificationCorrect: number;
  classificationAccuracyOnLocalized: number;
  matches: LocalizationMatch[];
};

export type TokenPricing = {
  inputPerMillionUsd: number;
  cachedInputPerMillionUsd: number;
  outputPerMillionUsd: number;
  source: string;
  checkedAt: string;
};

export type ApiCostSummary = {
  successfulCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

function ratio(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : 0;
}

export function evaluateLocalization(
  manifest: DatasetManifest,
  records: PredictionRecord[],
  options: { split?: DatasetSplit | "all"; iouThreshold?: number } = {},
): LocalizationDiagnostics {
  const manifestErrors = validateManifest(manifest);
  if (manifestErrors.length) throw new Error(`Invalid manifest:\n${manifestErrors.join("\n")}`);
  const predictionErrors = validatePredictionRecords(manifest, records);
  if (predictionErrors.length) throw new Error(`Invalid predictions:\n${predictionErrors.join("\n")}`);
  const split = options.split || "all";
  const threshold = options.iouThreshold ?? .5;
  const recordMap = new Map(records.map(record => [record.imageId, record]));
  const matches: LocalizationMatch[] = [];
  let predictionCount = 0;
  let groundTruthCount = 0;

  for (const image of manifest.images.filter(item => split === "all" || item.split === split)) {
    const groundTruth = image.boxes;
    const predictions = [...(recordMap.get(image.imageId)?.predictions || [])].sort((a, b) => b.confidence - a.confidence);
    predictionCount += predictions.length;
    groundTruthCount += groundTruth.length;
    const used = new Set<number>();
    for (const prediction of predictions) {
      let bestIndex = -1;
      let bestOverlap = 0;
      for (let index = 0; index < groundTruth.length; index++) {
        if (used.has(index)) continue;
        const overlap = boxIou(prediction, groundTruth[index]);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestIndex = index;
        }
      }
      if (bestIndex >= 0 && bestOverlap >= threshold) {
        used.add(bestIndex);
        const target = groundTruth[bestIndex];
        matches.push({
          imageId: image.imageId,
          predictionLabel: prediction.label,
          groundTruthLabel: target.label,
          iou: bestOverlap,
          classCorrect: prediction.label === target.label,
        });
      }
    }
  }

  const classificationCorrect = matches.filter(match => match.classCorrect).length;
  return {
    iouThreshold: threshold,
    localizedMatches: matches.length,
    localizationFalsePositives: predictionCount - matches.length,
    localizationMissedDefects: groundTruthCount - matches.length,
    localizationPrecision: ratio(matches.length, predictionCount),
    localizationRecall: ratio(matches.length, groundTruthCount),
    classificationCorrect,
    classificationAccuracyOnLocalized: ratio(classificationCorrect, matches.length),
    matches,
  };
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function summarizeApiCost(metadata: Array<Record<string, unknown> | undefined>, pricing: TokenPricing): ApiCostSummary {
  let successfulCalls = 0;
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  for (const item of metadata) {
    const usage = item?.usage;
    if (!usage || typeof usage !== "object" || Array.isArray(usage)) continue;
    const record = usage as Record<string, unknown>;
    const details = record.input_tokens_details;
    successfulCalls++;
    inputTokens += finiteNonNegative(record.input_tokens);
    outputTokens += finiteNonNegative(record.output_tokens);
    totalTokens += finiteNonNegative(record.total_tokens);
    if (details && typeof details === "object" && !Array.isArray(details)) cachedInputTokens += finiteNonNegative((details as Record<string, unknown>).cached_tokens);
  }
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const estimatedCostUsd = uncachedInputTokens / 1_000_000 * pricing.inputPerMillionUsd
    + cachedInputTokens / 1_000_000 * pricing.cachedInputPerMillionUsd
    + outputTokens / 1_000_000 * pricing.outputPerMillionUsd;
  return { successfulCalls, inputTokens, cachedInputTokens, outputTokens, totalTokens, estimatedCostUsd };
}

export function findingToPrediction(finding: EvaluationBox & { modelScore: number; source?: string; decision?: string }): Prediction {
  return {
    label: finding.label,
    x: finding.x,
    y: finding.y,
    width: finding.width,
    height: finding.height,
    confidence: finding.modelScore,
    source: finding.source,
    decision: finding.decision === "review" ? "review" : undefined,
  };
}
