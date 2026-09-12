import test from "node:test";
import assert from "node:assert/strict";
import { DSPCBSD_PLUS } from "../lib/evaluation.ts";
import { evaluateLocalization, summarizeApiCost } from "../lib/experiment.ts";

const manifest = {
  schemaVersion: 1,
  dataset: DSPCBSD_PLUS,
  images: [{
    imageId: "a",
    file: "a.jpg",
    width: 100,
    height: 100,
    split: "validation",
    boxes: [{ label: "CS", x: 10, y: 10, width: 20, height: 20 }],
  }],
};

test("localization diagnostics separate box matching from class matching", () => {
  const records = [{ imageId: "a", predictions: [{ label: "SP", x: 10, y: 10, width: 20, height: 20, confidence: .8 }] }];
  const result = evaluateLocalization(manifest, records, { split: "validation", iouThreshold: .5 });
  assert.equal(result.localizedMatches, 1);
  assert.equal(result.localizationRecall, 1);
  assert.equal(result.classificationCorrect, 0);
  assert.equal(result.classificationAccuracyOnLocalized, 0);
});

test("API cost uses cached and uncached Terra token rates", () => {
  const result = summarizeApiCost([{
    usage: {
      input_tokens: 1_000_000,
      input_tokens_details: { cached_tokens: 250_000 },
      output_tokens: 100_000,
      total_tokens: 1_100_000,
    },
  }], {
    inputPerMillionUsd: 2,
    cachedInputPerMillionUsd: .2,
    outputPerMillionUsd: 12,
    source: "official",
    checkedAt: "2026-09-12",
  });
  assert.equal(result.successfulCalls, 1);
  assert.equal(result.estimatedCostUsd, 2.75);
});
