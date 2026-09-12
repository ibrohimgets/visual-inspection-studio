import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { boxIou, evaluatePredictions, parsePredictionRecords, summarizeLatency, validateManifest } from "../lib/evaluation.ts";
import { summarizeApiCost } from "../lib/experiment.ts";
import { deriveConfidenceBands, isActionableTerraDecision, validateTerraDecisions } from "../lib/hybrid.ts";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.resolve(root, argument("manifest", "evaluation/dspcbsd-plus.manifest.json"));
const predictionsPath = path.resolve(root, argument("predictions", "reports/local/detector/yolox-nano-pcb/validation-predictions.json"));
const outputPath = path.resolve(root, argument("output", "reports/local/detector/yolox-nano-pcb/hybrid-validation.json"));
const cachePath = path.resolve(root, argument("cache", "reports/local/detector/yolox-nano-pcb/hybrid-terra-cache-v2.json"));
const endpoint = argument("endpoint", "http://127.0.0.1:8010/verify-proposals");
const model = argument("model", "gpt-5.6-terra");
const baselineThreshold = Number(argument("baseline-threshold", ".37"));
const minimumRecallTarget = Number(argument("minimum-recall", ".70"));
const minimumPrecisionTarget = Number(argument("minimum-precision", ".85"));
const batchSize = Number(argument("batch-size", "8"));
const maxBatches = Number(argument("max-batches", "0"));
const terraThresholds = argument("terra-thresholds", ".5,.6,.65,.7,.75,.8,.85,.9,.95,1").split(",").map(Number);
const unmeteredFailureOutputTokenCap = Number(argument("unmetered-failure-output-token-cap", "2400"));
const pricing = {
  inputPerMillionUsd: Number(argument("input-price", "2")),
  cachedInputPerMillionUsd: Number(argument("cached-input-price", ".2")),
  outputPerMillionUsd: Number(argument("output-price", "12")),
  source: "https://developers.openai.com/api/docs/models/gpt-5.6-terra",
  checkedAt: "2026-09-12",
};
if (![baselineThreshold, minimumRecallTarget, minimumPrecisionTarget, ...terraThresholds].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error("Thresholds and targets must be finite values between 0 and 1.");
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 8) throw new Error("--batch-size must be an integer from 1 to 8.");
if (!Number.isInteger(maxBatches) || maxBatches < 0) throw new Error("--max-batches must be a non-negative integer.");
if (![pricing.inputPerMillionUsd, pricing.cachedInputPerMillionUsd, pricing.outputPerMillionUsd, unmeteredFailureOutputTokenCap].every(value => Number.isFinite(value) && value >= 0)) throw new Error("Token prices and the failed-call output cap must be non-negative.");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const predictionFile = JSON.parse(await readFile(predictionsPath, "utf8"));
const manifestErrors = validateManifest(manifest);
if (manifestErrors.length) throw new Error(`Invalid manifest:\n${manifestErrors.join("\n")}`);
if (predictionFile.trainingSplit !== "train" || predictionFile.predictionSplit !== "validation" || predictionFile.testSplitAccessed !== false) throw new Error("Detector provenance must be train-only with validation-only predictions and a sealed test split.");
const records = parsePredictionRecords(predictionFile);
const validationImages = manifest.images.filter(image => image.split === "validation");
const validationIds = new Set(validationImages.map(image => image.imageId));
if (records.length !== validationImages.length || records.some(record => !validationIds.has(record.imageId))) throw new Error("Detector records must cover the complete validation split and nothing else.");
const labels = [...manifest.dataset.classes];
const imageById = new Map(validationImages.map(image => [image.imageId, image]));
const imageRoot = path.resolve(root, manifest.imageRoot || ".");

function filterRecords(threshold) {
  return records.map(record => ({
    ...record,
    predictions: record.predictions.filter(prediction => prediction.confidence >= threshold),
  }));
}

const bandCurve = [];
for (let step = 1; step <= 90; step++) {
  const confidenceThreshold = step / 100;
  const evaluation = evaluatePredictions(manifest, filterRecords(confidenceThreshold), { split: "validation", iouThreshold: .5 });
  bandCurve.push({ confidenceThreshold, precision: evaluation.metrics.precision, recall: evaluation.metrics.recall });
}
const bands = deriveConfidenceBands(bandCurve, { minimumRecallTarget, minimumPrecisionTarget });
if (!(bands.rejectBelow < baselineThreshold && baselineThreshold < bands.trustAtOrAbove)) throw new Error("The detector baseline threshold must fall inside the derived ambiguity band.");

const candidates = [];
for (const record of records) {
  record.predictions.forEach((prediction, index) => {
    if (prediction.confidence >= bands.rejectBelow && prediction.confidence < bands.trustAtOrAbove) {
      candidates.push({
        candidateId: `P${String(candidates.length + 1).padStart(4, "0")}`,
        imageId: record.imageId,
        predictionIndex: index,
        detectorLabel: prediction.label,
        detectorScore: prediction.confidence,
        prediction,
      });
    }
  });
}
function chunks(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

function escapeXml(text) {
  return text.replace(/[<>&"']/g, character => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]);
}

async function renderTile(candidate, tileSize = 256) {
  const image = imageById.get(candidate.imageId);
  if (!image) throw new Error(`Unknown validation image ${candidate.imageId}.`);
  const box = candidate.prediction;
  const padding = Math.max(16, Math.round(Math.max(box.width, box.height) * .9));
  const left = Math.min(image.width - 1, Math.max(0, Math.floor(box.x - padding)));
  const top = Math.min(image.height - 1, Math.max(0, Math.floor(box.y - padding)));
  const right = Math.max(left + 1, Math.min(image.width, Math.ceil(box.x + box.width + padding)));
  const bottom = Math.max(top + 1, Math.min(image.height, Math.ceil(box.y + box.height + padding)));
  const sourceWidth = right - left;
  const sourceHeight = bottom - top;
  const markX = (box.x - left) / sourceWidth * tileSize;
  const markY = (box.y - top) / sourceHeight * tileSize;
  const markWidth = box.width / sourceWidth * tileSize;
  const markHeight = box.height / sourceHeight * tileSize;
  const svg = `<svg width="${tileSize}" height="${tileSize}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${markX}" y="${markY}" width="${markWidth}" height="${markHeight}" fill="none" stroke="#00e5ff" stroke-width="3"/>
    <rect x="0" y="0" width="${tileSize}" height="26" fill="#111827" fill-opacity="0.88"/>
    <text x="8" y="18" fill="#ffffff" font-family="Arial, sans-serif" font-size="15" font-weight="700">${escapeXml(candidate.candidateId)} · ${escapeXml(candidate.detectorLabel)}</text>
  </svg>`;
  return sharp(path.resolve(imageRoot, image.file))
    .extract({ left, top, width: sourceWidth, height: sourceHeight })
    .resize(tileSize, tileSize, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .composite([{ input: Buffer.from(svg) }])
    .jpeg({ quality: 94 })
    .toBuffer();
}

async function contactSheet(batch) {
  const tileSize = 256;
  const gap = 8;
  const columns = Math.min(4, batch.length);
  const rowsCount = Math.ceil(batch.length / columns);
  const width = columns * tileSize + (columns - 1) * gap;
  const height = rowsCount * tileSize + (rowsCount - 1) * gap;
  const tiles = await Promise.all(batch.map(candidate => renderTile(candidate)));
  const data = await sharp({ create: { width, height, channels: 3, background: "#e5e7eb" } })
    .composite(tiles.map((input, index) => ({ input, left: (index % columns) * (tileSize + gap), top: Math.floor(index / columns) * (tileSize + gap) })))
    .jpeg({ quality: 94 })
    .toBuffer();
  return { mimeType: "image/jpeg", base64: data.toString("base64"), width, height };
}

async function readCache() {
  try {
    const cache = JSON.parse(await readFile(cachePath, "utf8"));
    if (cache.model !== model || cache.rejectBelow !== bands.rejectBelow || cache.trustAtOrAbove !== bands.trustAtOrAbove) throw new Error("Existing hybrid cache does not match this protocol.");
    return cache;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { schemaVersion: 1, model, rejectBelow: bands.rejectBelow, trustAtOrAbove: bands.trustAtOrAbove, testSplitAccessed: false, batches: [] };
  }
}

async function saveCache(cache) {
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(cache, null, 2) + "\n", "utf8");
}

async function verifyBatch(batch) {
  const started = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      labels,
      image: await contactSheet(batch),
      candidates: batch.map(candidate => ({ candidateId: candidate.candidateId, detectorLabel: candidate.detectorLabel, detectorScore: candidate.detectorScore })),
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Terra gateway returned HTTP ${response.status}: ${typeof payload?.error === "string" ? payload.error : "request failed"}`);
  let decisions;
  try {
    const output = typeof payload.output === "string" ? JSON.parse(payload.output) : payload.output;
    decisions = validateTerraDecisions(output, batch.map(candidate => candidate.candidateId), labels);
  } catch (error) {
    error.latencyMs = Date.now() - started;
    error.providerMetadata = payload.metadata;
    throw error;
  }
  return { candidateIds: batch.map(candidate => candidate.candidateId), latencyMs: Date.now() - started, decisions, metadata: payload.metadata };
}

const cache = await readCache();
const successfulBatches = cache.batches.filter(batch => !batch.error && batch.decisions?.length === batch.candidateIds?.length);
const completed = new Set(successfulBatches.flatMap(batch => batch.candidateIds));
const pending = candidates.filter(candidate => !completed.has(candidate.candidateId));
const pendingBatches = chunks(pending, batchSize).slice(0, maxBatches || undefined);
console.log(JSON.stringify({ event: "hybrid_start", targetSplit: "validation", testSplitAccessed: false, bands, ambiguousProposals: candidates.length, cachedProposals: completed.size, pendingBatches: pendingBatches.length }));
for (const [index, batch] of pendingBatches.entries()) {
  try {
    const result = await verifyBatch(batch);
    cache.batches.push(result);
    console.log(JSON.stringify({ event: "terra_batch_complete", batch: index + 1, batches: pendingBatches.length, candidates: batch.length, latencyMs: result.latencyMs }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cache.batches.push({ candidateIds: batch.map(candidate => candidate.candidateId), latencyMs: error?.latencyMs ?? null, decisions: [], error: message, metadata: error?.providerMetadata });
    console.log(JSON.stringify({ event: "terra_batch_error", batch: index + 1, batches: pendingBatches.length, candidates: batch.length, error: message }));
  }
  await saveCache(cache);
}

const processed = new Set(cache.batches.filter(batch => !batch.error && batch.decisions?.length === batch.candidateIds?.length).flatMap(batch => batch.candidateIds));
const complete = candidates.every(candidate => processed.has(candidate.candidateId));
if (!complete) {
  console.log(JSON.stringify({ event: "hybrid_incomplete", processed: processed.size, total: candidates.length, cache: cachePath }));
  process.exit(2);
}

const decisionById = new Map(cache.batches.flatMap(batch => batch.decisions || []).map(decision => [decision.candidateId, decision]));

function candidateKey(imageId, index) {
  return `${imageId}\u0000${index}`;
}
const candidateIdByPrediction = new Map(candidates.map(candidate => [candidateKey(candidate.imageId, candidate.predictionIndex), candidate.candidateId]));

function routedRecords(terraScoreThreshold, withHumanQueue = false) {
  const reviewQueue = [];
  const routed = records.map(record => {
    const predictions = [];
    record.predictions.forEach((prediction, index) => {
      if (prediction.confidence < bands.rejectBelow) return;
      if (prediction.confidence >= bands.trustAtOrAbove) {
        predictions.push({ ...prediction, source: "yolox-nano-pcb:trusted" });
        return;
      }
      const candidateId = candidateIdByPrediction.get(candidateKey(record.imageId, index));
      const decision = decisionById.get(candidateId);
      if (decision && isActionableTerraDecision(decision, terraScoreThreshold)) {
        if (decision.verdict === "confirm") predictions.push({ ...prediction, source: "yolox-nano-pcb:terra-confirmed" });
        if (decision.verdict === "relabel") predictions.push({ ...prediction, label: decision.label, source: "yolox-nano-pcb:terra-relabeled" });
        return;
      }
      if (withHumanQueue) {
        reviewQueue.push({ candidateId, imageId: record.imageId, prediction, terraDecision: decision || null });
      } else if (prediction.confidence >= baselineThreshold) {
        predictions.push({ ...prediction, source: "yolox-nano-pcb:terra-fallback" });
      }
    });
    return { imageId: record.imageId, inferenceMs: record.inferenceMs, predictions };
  });
  return { records: routed, reviewQueue };
}

function evaluate(recordSet) {
  return evaluatePredictions(manifest, recordSet, { split: "validation", iouThreshold: .5 });
}

const hybridCurve = terraThresholds.map(terraScoreThreshold => {
  const routed = routedRecords(terraScoreThreshold);
  const result = evaluate(routed.records);
  return { terraScoreThreshold, records: routed.records, result };
});
const selectedHybrid = [...hybridCurve].sort((a, b) => b.result.metrics.f1 - a.result.metrics.f1 || b.result.metrics.recall - a.result.metrics.recall || b.result.metrics.precision - a.result.metrics.precision || a.terraScoreThreshold - b.terraScoreThreshold)[0];
const humanRouted = routedRecords(selectedHybrid.terraScoreThreshold, true);

function oracleResolve(recordsBeforeReview, reviewQueue) {
  const output = recordsBeforeReview.map(record => ({ ...record, predictions: [...record.predictions] }));
  const outputById = new Map(output.map(record => [record.imageId, record]));
  for (const image of validationImages) {
    const used = new Set();
    for (const prediction of outputById.get(image.imageId).predictions) {
      let bestIndex = -1;
      let bestOverlap = 0;
      image.boxes.forEach((target, index) => {
        if (used.has(index)) return;
        const overlap = boxIou(prediction, target);
        if (overlap > bestOverlap) { bestOverlap = overlap; bestIndex = index; }
      });
      if (bestIndex >= 0 && bestOverlap >= .5) used.add(bestIndex);
    }
    const queued = reviewQueue.filter(candidate => candidate.imageId === image.imageId).sort((a, b) => b.prediction.confidence - a.prediction.confidence);
    for (const candidate of queued) {
      let bestIndex = -1;
      let bestOverlap = 0;
      image.boxes.forEach((target, index) => {
        if (used.has(index)) return;
        const overlap = boxIou(candidate.prediction, target);
        if (overlap > bestOverlap) { bestOverlap = overlap; bestIndex = index; }
      });
      if (bestIndex >= 0 && bestOverlap >= .5) {
        used.add(bestIndex);
        outputById.get(image.imageId).predictions.push({ ...candidate.prediction, label: image.boxes[bestIndex].label, source: "validation-oracle-human-review" });
      }
    }
  }
  return output;
}

const detectorOnlyRecords = filterRecords(baselineThreshold);
const detectorOnly = evaluate(detectorOnlyRecords);
const hybrid = selectedHybrid.result;
const automaticBeforeHuman = evaluate(humanRouted.records);
const oracleHuman = evaluate(oracleResolve(humanRouted.records, humanRouted.reviewQueue));
const humanRoutingCurve = terraThresholds.map(terraScoreThreshold => {
  const routed = routedRecords(terraScoreThreshold, true);
  const automatic = evaluate(routed.records);
  const oracle = evaluate(oracleResolve(routed.records, routed.reviewQueue));
  return {
    terraScoreThreshold,
    automatic,
    oracle,
    reviewProposals: routed.reviewQueue.length,
    reviewImages: new Set(routed.reviewQueue.map(candidate => candidate.imageId)).size,
  };
});
const providerMetadata = cache.batches.map(batch => batch.metadata).filter(Boolean);
const measuredApi = summarizeApiCost(providerMetadata, pricing);
const failedCalls = cache.batches.filter(batch => batch.error).length;
const unmeteredFailedCalls = cache.batches.filter(batch => batch.error && !batch.metadata?.usage).length;
const maxObservedInputTokens = Math.max(0, ...providerMetadata.map(metadata => Number(metadata?.usage?.input_tokens) || 0));
const unmeteredFailedCostUpperBoundUsd = unmeteredFailedCalls * (
  maxObservedInputTokens / 1_000_000 * pricing.inputPerMillionUsd
  + unmeteredFailureOutputTokenCap / 1_000_000 * pricing.outputPerMillionUsd
);
const api = {
  pricing,
  ...measuredApi,
  failedCalls,
  unmeteredFailedCalls,
  measuredCostIsLowerBound: unmeteredFailedCalls > 0,
  unmeteredFailureOutputTokenCap,
  unmeteredFailedCostUpperBoundUsd,
  estimatedTotalCostRangeUsd: {
    minimumMeasured: measuredApi.estimatedCostUsd,
    maximumIncludingUnmeteredFailure: measuredApi.estimatedCostUsd + unmeteredFailedCostUpperBoundUsd,
  },
};
const terraTotalLatencyMs = cache.batches.reduce((sum, batch) => sum + (Number.isFinite(batch.latencyMs) ? batch.latencyMs : 0), 0);
const terraBatchLatency = summarizeLatency(cache.batches.filter(batch => !batch.error).map(batch => batch.latencyMs).filter(Number.isFinite));
const detectorWallMs = predictionFile.totalInferenceMs;
const reviewImageCount = new Set(humanRouted.reviewQueue.map(candidate => candidate.imageId)).size;

function summary(name, result, extras = {}) {
  return {
    name,
    predictions: result.predictionCount,
    truePositives: result.metrics.truePositives,
    falsePositives: result.metrics.falsePositives,
    missedDefects: result.metrics.falseNegatives,
    precision: result.metrics.precision,
    recall: result.metrics.recall,
    f1: result.metrics.f1,
    routedMap50: result.metrics.meanAveragePrecision,
    perClass: result.metrics.perClass,
    ...extras,
  };
}

const report = {
  schemaVersion: 1,
  experiment: "Detector-first uncertainty-aware hybrid routing",
  model: { detector: predictionFile.model, detectorEpoch: predictionFile.checkpointEpoch, verifier: model },
  targetSplit: "validation",
  trainingSplit: "train",
  testSplitAccessed: false,
  protocol: {
    baselineThreshold,
    bands,
    bandRule: "Highest detector threshold preserving the recall target defines rejectBelow; lowest higher threshold reaching the precision target defines trustAtOrAbove.",
    ambiguousProposalCount: candidates.length,
    terraBatchSize: batchSize,
    terraAttempts: cache.batches.length,
    successfulTerraCalls: api.successfulCalls,
    terraActionSelectionRule: "Maximum hybrid class-aware F1 on validation; ties prefer recall, then precision, then the lower Terra score threshold. Only low-uncertainty non-uncertain verdicts are actionable.",
    selectedTerraScoreThreshold: selectedHybrid.terraScoreThreshold,
    iouThreshold: .5,
  },
  comparison: [
    summary("detector-only", detectorOnly, { apiCalls: 0, estimatedApiCostUsd: 0, humanReviewProposals: 0 }),
    summary("detector+Terra", hybrid, { apiCalls: api.successfulCalls, estimatedApiCostUsd: api.estimatedCostUsd, humanReviewProposals: 0 }),
    summary("detector+Terra+human-routing (automatic output before review)", automaticBeforeHuman, {
      apiCalls: api.successfulCalls,
      estimatedApiCostUsd: api.estimatedCostUsd,
      humanReviewProposals: humanRouted.reviewQueue.length,
      humanReviewProposalRate: humanRouted.reviewQueue.length / candidates.length,
      humanReviewImages: reviewImageCount,
      humanReviewImageRate: reviewImageCount / validationImages.length,
    }),
    summary("detector+Terra+validation-oracle-review ceiling", oracleHuman, {
      apiCalls: api.successfulCalls,
      estimatedApiCostUsd: api.estimatedCostUsd,
      humanReviewProposals: humanRouted.reviewQueue.length,
      simulated: true,
      caveat: "Uses validation ground truth to simulate a perfect reviewer and is an upper bound, not a measured human result.",
    }),
  ],
  terraThresholdCurve: hybridCurve.map(row => summary(`terra-score-${row.terraScoreThreshold}`, row.result, { terraScoreThreshold: row.terraScoreThreshold })),
  humanRoutingCurve: humanRoutingCurve.map(row => ({
    terraScoreThreshold: row.terraScoreThreshold,
    automaticPrecision: row.automatic.metrics.precision,
    automaticRecall: row.automatic.metrics.recall,
    automaticF1: row.automatic.metrics.f1,
    reviewProposals: row.reviewProposals,
    reviewProposalRate: row.reviewProposals / candidates.length,
    reviewImages: row.reviewImages,
    reviewImageRate: row.reviewImages / validationImages.length,
    oraclePrecision: row.oracle.metrics.precision,
    oracleRecall: row.oracle.metrics.recall,
    oracleF1: row.oracle.metrics.f1,
  })),
  routing: {
    trustedDetectorProposals: records.flatMap(record => record.predictions).filter(prediction => prediction.confidence >= bands.trustAtOrAbove).length,
    ambiguousProposals: candidates.length,
    rejectedLowConfidenceProposals: records.flatMap(record => record.predictions).filter(prediction => prediction.confidence < bands.rejectBelow).length,
    decisionCounts: Object.fromEntries(["confirm", "relabel", "reject", "uncertain", "missing"].map(verdict => [verdict, verdict === "missing" ? candidates.filter(candidate => !decisionById.has(candidate.candidateId)).length : [...decisionById.values()].filter(decision => decision.verdict === verdict).length])),
  },
  latency: {
    detectorWallMs,
    terraSequentialWallMs: terraTotalLatencyMs,
    terraBatchLatency,
    measuredSequentialTotalMs: detectorWallMs + terraTotalLatencyMs,
    meanSequentialMsPerValidationImage: (detectorWallMs + terraTotalLatencyMs) / validationImages.length,
    caveat: "Terra batches were called sequentially for controlled measurement; human-review time and one unmetered failed-call duration are not included.",
  },
  api,
  reviewQueue: humanRouted.reviewQueue.map(item => ({ candidateId: item.candidateId, imageId: item.imageId, detectorLabel: item.prediction.label, detectorScore: item.prediction.confidence, terraDecision: item.terraDecision })),
  batches: cache.batches,
  caveats: [
    "Validation-only threshold and routing selection; no frozen-test or production claim.",
    "Terra modelScore is self-reported and uncalibrated.",
    "The oracle-review row is explicitly simulated because no human reviewer labeled the queue during this run.",
    "routedMap50 is 101-point class mean AP at IoU 0.5 on the routed output, not COCO mAP@[.5:.95].",
  ],
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ output: outputPath, targetSplit: report.targetSplit, testSplitAccessed: false, protocol: report.protocol, comparison: report.comparison, routing: report.routing, latency: report.latency, api: report.api }, null, 2));
