export type ClassThresholdPoint = {
  confidenceThreshold: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
};

function safeRatio(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : 0;
}

function totals(points: ClassThresholdPoint[]) {
  const truePositives = points.reduce((sum, point) => sum + point.truePositives, 0);
  const falsePositives = points.reduce((sum, point) => sum + point.falsePositives, 0);
  const falseNegatives = points.reduce((sum, point) => sum + point.falseNegatives, 0);
  const precision = safeRatio(truePositives, truePositives + falsePositives);
  const recall = safeRatio(truePositives, truePositives + falseNegatives);
  return { truePositives, falsePositives, falseNegatives, precision, recall, f1: safeRatio(2 * precision * recall, precision + recall) };
}

function better(a: ReturnType<typeof totals> & { threshold: number }, b: ReturnType<typeof totals> & { threshold: number }) {
  return a.f1 > b.f1 || (a.f1 === b.f1 && (a.recall > b.recall || (a.recall === b.recall && (a.precision > b.precision || (a.precision === b.precision && a.threshold < b.threshold)))));
}

export function selectMicroF1ClassThresholds(curves: Record<string, ClassThresholdPoint[]>, initialThreshold: number) {
  const labels = Object.keys(curves);
  if (!labels.length || labels.some(label => !curves[label].length)) throw new Error("Every detector class needs a threshold curve.");
  const selected: Record<string, ClassThresholdPoint> = {};
  for (const label of labels) {
    selected[label] = curves[label].reduce((best, point) => Math.abs(point.confidenceThreshold - initialThreshold) < Math.abs(best.confidenceThreshold - initialThreshold) ? point : best);
  }
  let changed = true;
  let passes = 0;
  while (changed && passes < 20) {
    changed = false;
    passes++;
    for (const label of labels) {
      const otherPoints = labels.filter(other => other !== label).map(other => selected[other]);
      let best = selected[label];
      let bestMetrics = { ...totals([...otherPoints, best]), threshold: best.confidenceThreshold };
      for (const candidate of curves[label]) {
        const metrics = { ...totals([...otherPoints, candidate]), threshold: candidate.confidenceThreshold };
        if (better(metrics, bestMetrics)) { best = candidate; bestMetrics = metrics; }
      }
      if (best.confidenceThreshold !== selected[label].confidenceThreshold) {
        selected[label] = best;
        changed = true;
      }
    }
  }
  return { thresholds: Object.fromEntries(labels.map(label => [label, selected[label].confidenceThreshold])), metrics: totals(labels.map(label => selected[label])), passes };
}

export function applyClassThresholds(records: PredictionRecord[], thresholds: Record<string, number>) {
  return records.map(record => ({
    ...record,
    predictions: record.predictions.filter(prediction => prediction.confidence >= (thresholds[prediction.label] ?? 1)),
  }));
}
import type { PredictionRecord } from "./evaluation";
