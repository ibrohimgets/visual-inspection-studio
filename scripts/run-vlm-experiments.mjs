import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { evaluatePredictions, validateManifest } from "../lib/evaluation.ts";
import { evaluateLocalization, findingToPrediction, summarizeApiCost } from "../lib/experiment.ts";
import { createHttpVlmAdapter } from "../lib/vlm.ts";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const manifestPath = path.resolve(repoRoot, argument("manifest", "evaluation/dspcbsd-plus.manifest.json"));
const outputPath = path.resolve(repoRoot, argument("output", "reports/local/gpt-5.6-terra-validation-comparison.json"));
const endpoint = argument("endpoint", "http://127.0.0.1:8010/inspect");
const model = argument("model", "gpt-5.6-terra");
const limit = Math.max(1, Math.min(25, Number(argument("limit", "6"))));
const requestedModes = argument("modes", "zero-shot,crop-verification,1-shot,3-shot,5-shot").split(",").map(value => value.trim()).filter(Boolean);
const allowedModes = new Set(["zero-shot", "crop-verification", "1-shot", "3-shot", "5-shot"]);
if (requestedModes.some(mode => !allowedModes.has(mode))) throw new Error(`Unsupported --modes value. Use ${[...allowedModes].join(", ")}.`);

const pricing = {
  inputPerMillionUsd: Number(argument("input-price", "2")),
  cachedInputPerMillionUsd: Number(argument("cached-input-price", ".2")),
  outputPerMillionUsd: Number(argument("output-price", "12")),
  source: "https://developers.openai.com/api/docs/models/gpt-5.6-terra",
  checkedAt: "2026-09-12",
};
if (![pricing.inputPerMillionUsd, pricing.cachedInputPerMillionUsd, pricing.outputPerMillionUsd].every(value => Number.isFinite(value) && value >= 0)) throw new Error("Token prices must be non-negative numbers.");

const task = {
  id: "dspcbsd-plus",
  title: "PCB surface-defect inspection",
  instructions: "Inspect this PCB image for visible surface defects. This is an evaluation run, not a trained defect detector. Detect every visually supported defect, keep boxes tight around the defective material, distinguish the fine-grained PCB classes using their definitions, and return uncertain with no finding rather than inventing one.",
  classes: [
    ["SH", "short: an unintended electrical connection between conductors"],
    ["SP", "spur: a thin unwanted conductor branch"],
    ["SC", "spurious copper: an isolated unwanted copper residue or island"],
    ["OP", "open: a break or interruption in a conductor"],
    ["MB", "mouse bite: a rough bitten conductor edge or missing edge material"],
    ["HB", "hole breakout: a plated hole or drill opening breaks into a nearby conductor"],
    ["CS", "conductor scratch: a scratch removes or marks copper across a conductor"],
    ["CFO", "copper foreign object: unwanted copper-colored material on the board"],
    ["BMFO", "base-material foreign object: unwanted non-copper material on the substrate"],
  ].map(([label, description]) => ({ label, description })),
};

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const manifestErrors = validateManifest(manifest);
if (manifestErrors.length) throw new Error(`Invalid manifest:\n${manifestErrors.join("\n")}`);

const validationImages = manifest.images.filter(image => image.split === "validation").sort((a, b) => a.imageId.localeCompare(b.imageId));
if (!validationImages.length) throw new Error("Manifest has no validation images.");
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
if (selected.some(image => image.split !== "validation")) throw new Error("Experiment target selection escaped the validation split.");

function chooseSupportImages(count) {
  const candidates = manifest.images
    .filter(image => image.split === "train" && image.boxes.length > 0 && image.boxes.length <= 8)
    .map(image => ({ ...image, labels: [...new Set(image.boxes.map(box => box.label))] }));
  const covered = new Set();
  const chosen = [];
  while (chosen.length < count) {
    const remaining = candidates.filter(candidate => !chosen.includes(candidate));
    remaining.sort((a, b) => {
      const newA = a.labels.filter(label => !covered.has(label)).length;
      const newB = b.labels.filter(label => !covered.has(label)).length;
      return newB - newA || b.labels.length - a.labels.length || a.boxes.length - b.boxes.length || a.imageId.localeCompare(b.imageId);
    });
    const next = remaining[0];
    if (!next) throw new Error(`Could not select ${count} training support images.`);
    chosen.push(next);
    next.labels.forEach(label => covered.add(label));
  }
  return chosen;
}

const supportBankImages = chooseSupportImages(5);
if (supportBankImages.some(image => image.split !== "train")) throw new Error("Support bank escaped the training split.");
const targetIds = new Set(selected.map(image => image.imageId));
if (supportBankImages.some(image => targetIds.has(image.imageId))) throw new Error("Support/query leakage detected.");

async function imagePayload(image) {
  const filePath = path.resolve(repoRoot, manifest.imageRoot || ".", image.file);
  const bytes = await readFile(filePath);
  const extension = path.extname(image.file).toLowerCase();
  const mimeType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  return { bytes, image: { mimeType, base64: bytes.toString("base64"), width: image.width, height: image.height } };
}

const supportBank = [];
for (const support of supportBankImages) {
  const payload = await imagePayload(support);
  supportBank.push({
    id: support.imageId,
    label: support.boxes[0].label,
    description: `Training split ground truth with ${support.boxes.length} annotated defects.`,
    image: payload.image,
    annotations: support.boxes,
    split: support.split,
    file: support.file,
  });
}

const adapter = createHttpVlmAdapter({ endpoint, model, timeoutMs: 10 * 60 * 1000 });

function publicSupport(example) {
  return {
    id: example.id,
    file: example.file,
    split: example.split,
    classes: [...new Set(example.annotations.map(box => box.label))],
    annotationCount: example.annotations.length,
  };
}

async function inspectImage(image, mode, supportExamples, promptVersion, taskOverride = task) {
  const payload = await imagePayload(image);
  const request = {
    image: payload.image,
    task: taskOverride,
    mode,
    supportExamples: supportExamples.length ? supportExamples.map(example => ({
      id: example.id,
      label: example.label,
      description: example.description,
      image: example.image,
      annotations: example.annotations,
    })) : undefined,
    promptVersion,
  };
  const result = await adapter.inspect(request);
  return { payload, result };
}

async function verifyCrop(originalImage, originalBytes, candidate) {
  const padding = Math.max(16, Math.round(Math.max(candidate.width, candidate.height) * .6));
  const left = Math.max(0, Math.floor(candidate.x - padding));
  const top = Math.max(0, Math.floor(candidate.y - padding));
  const right = Math.min(originalImage.width, Math.ceil(candidate.x + candidate.width + padding));
  const bottom = Math.min(originalImage.height, Math.ceil(candidate.y + candidate.height + padding));
  const sourceWidth = right - left;
  const sourceHeight = bottom - top;
  const cropped = await sharp(originalBytes)
    .extract({ left, top, width: sourceWidth, height: sourceHeight })
    .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: false, kernel: sharp.kernel.nearest })
    .jpeg({ quality: 95 })
    .toBuffer({ resolveWithObject: true });
  const cropImage = { mimeType: "image/jpeg", base64: cropped.data.toString("base64"), width: cropped.info.width, height: cropped.info.height };
  const verificationTask = {
    ...task,
    instructions: `This is a magnified verification crop from a full-image candidate. The preliminary full-image label was ${candidate.label}, but treat that label only as a hypothesis. Verify whether a real PCB defect is visually supported, choose the best final class, and return at most one tight box in crop pixel coordinates. If the feature is normal geometry, an imaging artifact, or too ambiguous, return no finding and status uncertain.`,
  };
  const result = await adapter.inspect({ image: cropImage, task: verificationTask, mode: "zero-shot", promptVersion: "pcb-crop-verification-v1" });
  const verified = [...result.findings].sort((a, b) => b.modelScore - a.modelScore)[0];
  if (!verified) return { crop: { left, top, sourceWidth, sourceHeight, width: cropped.info.width, height: cropped.info.height }, result, finding: null };
  const scaleX = sourceWidth / cropped.info.width;
  const scaleY = sourceHeight / cropped.info.height;
  const x = Math.max(0, Math.min(originalImage.width, left + verified.x * scaleX));
  const y = Math.max(0, Math.min(originalImage.height, top + verified.y * scaleY));
  const width = Math.max(.01, Math.min(originalImage.width - x, verified.width * scaleX));
  const height = Math.max(.01, Math.min(originalImage.height - y, verified.height * scaleY));
  return {
    crop: { left, top, sourceWidth, sourceHeight, width: cropped.info.width, height: cropped.info.height },
    result,
    finding: { ...verified, x, y, width, height, id: candidate.id },
  };
}

async function runMode(name) {
  const cropVerification = name === "crop-verification";
  const shotCount = name.endsWith("-shot") && name !== "zero-shot" ? Number(name.split("-")[0]) : 0;
  const supportExamples = shotCount ? supportBank.slice(0, shotCount) : [];
  const records = [];
  const images = [];
  const providerCalls = [];
  const startedAt = new Date().toISOString();

  for (const image of selected) {
    try {
      const first = await inspectImage(
        image,
        shotCount ? "few-shot" : "zero-shot",
        supportExamples,
        shotCount ? `pcb-${shotCount}-support-image-v1` : "pcb-zero-shot-v1",
      );
      if (first.result.providerMetadata) providerCalls.push(first.result.providerMetadata);
      let finalFindings = first.result.findings;
      const verification = [];
      let inferenceMs = first.result.latencyMs;
      if (cropVerification) {
        finalFindings = [];
        for (const candidate of first.result.findings) {
          const checked = await verifyCrop(image, first.payload.bytes, candidate);
          verification.push({ candidate, crop: checked.crop, result: checked.result });
          inferenceMs += checked.result.latencyMs;
          if (checked.result.providerMetadata) providerCalls.push(checked.result.providerMetadata);
          if (checked.finding) finalFindings.push(checked.finding);
        }
      }
      const predictions = finalFindings.map(findingToPrediction);
      records.push({ imageId: image.imageId, inferenceMs, predictions });
      images.push({
        imageId: image.imageId,
        file: image.file,
        groundTruth: image.boxes,
        firstPass: first.result,
        verification: cropVerification ? verification : undefined,
        finalFindings,
      });
      console.log(`${name} ${image.imageId}: ${finalFindings.length} final findings, ${inferenceMs} ms`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      records.push({ imageId: image.imageId, inferenceMs: Number.isFinite(error?.latencyMs) ? error.latencyMs : undefined, predictions: [] });
      images.push({ imageId: image.imageId, file: image.file, groundTruth: image.boxes, error: message, rawOutput: error?.rawOutput || undefined });
      console.log(`${name} ${image.imageId}: ERROR ${message}`);
    }
  }

  const subsetManifest = { ...manifest, images: selected };
  const evaluation = evaluatePredictions(subsetManifest, records, { split: "validation", iouThreshold: .5 });
  const localization = evaluateLocalization(subsetManifest, records, { split: "validation", iouThreshold: .5 });
  const cost = summarizeApiCost(providerCalls, pricing);
  return {
    name,
    model,
    promptVersion: cropVerification ? "pcb-zero-shot-v1 + pcb-crop-verification-v1" : shotCount ? `pcb-${shotCount}-support-image-v1` : "pcb-zero-shot-v1",
    startedAt,
    finishedAt: new Date().toISOString(),
    supportExamples: supportExamples.map(publicSupport),
    supportPolicy: shotCount ? "Nested deterministic support-image bank selected only from the training split by new class coverage; annotations are supplied with each image." : "No support examples.",
    images,
    predictionRecords: records,
    evaluation,
    localization,
    api: {
      pricing,
      ...cost,
      caveat: "Cost is estimated from successful Responses API usage records. Failed calls without usage metadata may be omitted.",
    },
  };
}

const runs = [];
for (const mode of requestedModes) runs.push(await runMode(mode));

const comparison = runs.map(run => ({
  mode: run.name,
  supportImages: run.supportExamples.length,
  successfulApiCalls: run.api.successfulCalls,
  parserFailures: run.images.filter(image => image.error).length,
  predictions: run.evaluation.predictionCount,
  classAwareTruePositives: run.evaluation.metrics.truePositives,
  falsePositives: run.evaluation.metrics.falsePositives,
  missedDefects: run.evaluation.metrics.falseNegatives,
  precision: run.evaluation.metrics.precision,
  recall: run.evaluation.metrics.recall,
  localizedMatches: run.localization.localizedMatches,
  localizationPrecision: run.localization.localizationPrecision,
  localizationRecall: run.localization.localizationRecall,
  classificationCorrect: run.localization.classificationCorrect,
  classificationAccuracyOnLocalized: run.localization.classificationAccuracyOnLocalized,
  latency: run.evaluation.latency,
  inputTokens: run.api.inputTokens,
  outputTokens: run.api.outputTokens,
  estimatedCostUsd: run.api.estimatedCostUsd,
}));

const output = {
  schemaVersion: 1,
  experiment: "Terra zero-shot, crop verification, and controlled few-shot comparison",
  dataset: manifest.dataset,
  targetSplit: "validation",
  testSplitRun: false,
  targetImages: selected.map(image => image.imageId),
  supportBank: supportBank.map(publicSupport),
  iouThreshold: .5,
  comparison,
  runs,
  caveat: "Small validation capability probe only. Do not treat these values as full-dataset accuracy or industrial-readiness claims.",
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ output: outputPath, targetSplit: output.targetSplit, testSplitRun: output.testSplitRun, targetImages: output.targetImages, comparison }, null, 2));
