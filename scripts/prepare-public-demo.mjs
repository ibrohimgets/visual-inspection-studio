import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";
import { evaluateInspection, validateInspectionRuleSet } from "../lib/inspection-rules.ts";
import { approveInspectionRuleCandidate, verifyExtractedRuleEvidence } from "../lib/spec-extraction.ts";

const ROOT = resolve(import.meta.dirname, "..");
const PDF_PATH = resolve(ROOT, "public/examples/factory-quality-spec-example.pdf");
const OUTPUT_ROOT = resolve(ROOT, "public/examples/pcb-demo");
const PORTFOLIO_ROOT = resolve(ROOT, "docs/portfolio/assets");
const BUNDLED_MANIFEST_PATH = resolve(ROOT, "lib/generated/public-demo-data.json");
const MANIFEST_PATH = resolve(ROOT, "evaluation/dspcbsd-plus.manifest.json");
const PREDICTIONS_PATH = resolve(ROOT, "reports/local/detector/yolox-nano-pcb/validation-predictions.json");
const THRESHOLDS_PATH = resolve(ROOT, "reports/local/detector/yolox-nano-pcb/class-thresholds.json");

const SELECTED = [
  { slug: "pass-spur", imageId: "train2017:0067993.jpg", expectedOutcome: "PASS",
    title: "Cosmetic spur", clientSummary: "Accepted by the approved demonstration policy." },
  { slug: "review-scratch", imageId: "train2017:0063146.jpg", expectedOutcome: "REVIEW",
    title: "Conductor scratch", clientSummary: "Routed to a quality engineer before disposition." },
  { slug: "fail-open-circuit", imageId: "train2017:0107466.jpg", expectedOutcome: "FAIL",
    title: "Open circuit", clientSummary: "Rejected as a critical circuit defect." },
];

const CLASS_LABELS = {
  SH: "Short circuit", SP: "Spur", SC: "Spurious copper", OP: "Open circuit",
  MB: "Mouse bite", HB: "Hole breakout", CS: "Conductor scratch",
  CFO: "Conductor foreign object", BMFO: "Base-material foreign object",
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function source(documentId, page, evidence) {
  return { kind: "document", documentId, page, evidence };
}

async function extractPdfDocument() {
  const bytes = new Uint8Array(await readFile(PDF_PATH));
  const documentId = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const task = getDocument({ data: bytes, useSystemFonts: true });
  const pdf = await task.promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map(item => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "")
      .join("").replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
    pages.push({ page: pageNumber, text });
  }
  await task.destroy();
  return {
    documentId,
    fileName: "factory-quality-spec-example.pdf",
    pages,
    supportedClasses: Object.keys(CLASS_LABELS),
  };
}

function recordedCandidate(document) {
  const candidate = {
    schemaVersion: 1,
    id: "pcb-camera-acceptance-demo",
    name: "PCB camera acceptance policy",
    version: "candidate-1.0",
    description: "Evidence-linked rule candidate recorded for the zero-cost public portfolio walkthrough.",
    defaultOutcome: "PASS",
    defaultSeverity: "none",
    rules: [
      {
        id: "pcb-confidence-review", type: "confidence-review",
        description: "Ignore weak proposals and route uncertain findings to human review.", severity: "major",
        source: source(document.documentId, 2, "Findings below 30 percent confidence may be ignored. Findings from 30 percent up to but below 70 percent confidence require HUMAN REVIEW."),
        ignoreBelow: 0.3, reviewBelow: 0.7,
      },
      {
        id: "critical-circuit-defects", type: "defect-class",
        description: "Open- and short-circuit findings are critical rejects.", severity: "critical",
        source: source(document.documentId, 1, "Any open-circuit (OP) or short-circuit (SH) finding is critical and must result in FAIL."),
        classes: ["OP", "SH"], outcome: "FAIL",
      },
      {
        id: "conductor-scratch-review", type: "defect-class",
        description: "Conductor scratches require a quality engineer.", severity: "major",
        source: source(document.documentId, 1, "A conductor-scratch (CS) finding requires HUMAN REVIEW before disposition."),
        classes: ["CS"], outcome: "REVIEW",
      },
      {
        id: "cosmetic-spur-allowance", type: "defect-class",
        description: "A cosmetic spur may pass when no higher-priority rule applies.", severity: "minor",
        source: source(document.documentId, 1, "A spur (SP) finding is acceptable for this demonstration and may PASS when no higher-priority rule applies."),
        classes: ["SP"], outcome: "PASS",
      },
      {
        id: "maximum-actionable-findings", type: "maximum-defect-count",
        description: "More than two actionable findings reject the image.", severity: "major",
        source: source(document.documentId, 1, "More than two actionable PCB defect findings in one image must result in FAIL."),
        maximumAllowed: 2, outcome: "FAIL",
      },
    ],
  };
  assert(validateInspectionRuleSet(candidate).valid, "The recorded rule candidate does not satisfy rule-schema.v1.json.");
  assert(verifyExtractedRuleEvidence(candidate, document).length === 0, "Recorded rule evidence no longer matches the PDF.");
  approveInspectionRuleCandidate(candidate, document);
  return candidate;
}

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

async function createAnnotatedImage(sourcePath, outputPath, image, detections, outcome) {
  const scale = 4;
  const width = image.width * scale;
  const height = image.height * scale;
  const color = outcome === "PASS" ? "#43B381" : outcome === "FAIL" ? "#F06A61" : "#E8B44A";
  const boxes = detections.map(detection => {
    const x = detection.x * scale;
    const y = detection.y * scale;
    const w = detection.width * scale;
    const h = detection.height * scale;
    const label = `${detection.label} ${(detection.confidence * 100).toFixed(1)}%`;
    const labelWidth = Math.max(140, label.length * 24);
    const labelY = Math.max(0, y - 46);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="8"/>
      <rect x="${x}" y="${labelY}" width="${labelWidth}" height="46" fill="${color}"/>
      <text x="${x + 12}" y="${labelY + 31}" fill="#102029" font-family="Arial, sans-serif" font-size="28" font-weight="700">${xml(label)}</text>`;
  }).join("\n");
  const overlay = Buffer.from(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${boxes}</svg>`);
  await mkdir(dirname(outputPath), { recursive: true });
  await sharp(sourcePath).resize(width, height).composite([{ input: overlay }]).png().toFile(outputPath);
}

async function main() {
  const [datasetManifest, predictionReport, thresholdReport, document] = await Promise.all([
    readFile(MANIFEST_PATH, "utf8").then(JSON.parse),
    readFile(PREDICTIONS_PATH, "utf8").then(JSON.parse),
    readFile(THRESHOLDS_PATH, "utf8").then(JSON.parse),
    extractPdfDocument(),
  ]);
  assert(predictionReport.predictionSplit === "validation", "Public samples must come from validation predictions.");
  assert(predictionReport.testSplitAccessed === false, "Prediction report indicates frozen test access.");
  assert(thresholdReport.tuningSplit === "validation", "Public thresholds must be validation-only.");
  assert(thresholdReport.testSplitAccessed === false, "Threshold report indicates frozen test access.");

  const images = new Map(datasetManifest.images.map(image => [image.imageId, image]));
  const predictions = new Map(predictionReport.results.map(result => [result.imageId, result]));
  const candidate = recordedCandidate(document);
  const policy = approveInspectionRuleCandidate(candidate, document);
  const samples = [];

  await mkdir(resolve(OUTPUT_ROOT, "images"), { recursive: true });
  await mkdir(PORTFOLIO_ROOT, { recursive: true });
  for (const selection of SELECTED) {
    const image = images.get(selection.imageId);
    const result = predictions.get(selection.imageId);
    assert(image, `Dataset image not found: ${selection.imageId}`);
    assert(result, `Cached validation prediction not found: ${selection.imageId}`);
    assert(image.split === "validation", `Sample is not on the internal validation split: ${selection.imageId}`);
    assert(image.file.startsWith("train2017/"), `Frozen official validation/test file rejected: ${image.file}`);
    const detections = result.predictions
      .filter(prediction => prediction.confidence >= thresholdReport.thresholds[prediction.label])
      .map((prediction, index) => ({
        id: index + 1, label: prediction.label, confidence: prediction.confidence,
        x: prediction.x, y: prediction.y, width: prediction.width, height: prediction.height,
        review: "pending", note: "",
      }));
    const decision = evaluateInspection(detections, policy);
    assert(decision.outcome === selection.expectedOutcome,
      `${selection.slug} expected ${selection.expectedOutcome} but evaluated to ${decision.outcome}.`);

    const sourcePath = resolve(ROOT, datasetManifest.imageRoot, image.file);
    const publicInput = resolve(OUTPUT_ROOT, "images", `${selection.slug}.jpg`);
    const publicAnnotated = resolve(OUTPUT_ROOT, "images", `${selection.slug}-annotated.png`);
    await copyFile(sourcePath, publicInput);
    await createAnnotatedImage(sourcePath, publicAnnotated, image, detections, decision.outcome);
    await copyFile(sourcePath, resolve(PORTFOLIO_ROOT, `${selection.slug}-input.jpg`));
    await copyFile(publicAnnotated, resolve(PORTFOLIO_ROOT, `${selection.slug}-output.png`));

    samples.push({
      id: selection.slug,
      imageId: selection.imageId,
      title: selection.title,
      clientSummary: selection.clientSummary,
      imagePath: `/examples/pcb-demo/images/${selection.slug}.jpg`,
      annotatedPath: `/examples/pcb-demo/images/${selection.slug}-annotated.png`,
      width: image.width,
      height: image.height,
      expectedOutcome: decision.outcome,
      expectedSeverity: decision.severity,
      classNames: detections.map(detection => CLASS_LABELS[detection.label] ?? detection.label),
      run: {
        detections,
        inferenceMs: result.inferenceMs,
        totalMs: Math.round(result.inferenceMs),
        completedAt: "2026-09-12T00:00:00.000Z",
        executionProvider: "cached validation inference",
        model: {
          name: predictionReport.model,
          version: `checkpoint epoch ${predictionReport.checkpointEpoch}`,
          inputSize: predictionReport.inputSize,
          source: datasetManifest.dataset.source,
          license: "YOLOX Apache-2.0; sample data CC BY 4.0",
        },
      },
      provenance: {
        datasetSplit: image.split,
        datasetFile: image.file,
        model: predictionReport.model,
        checkpointEpoch: predictionReport.checkpointEpoch,
        thresholdProfile: "class-specific validation thresholds",
      },
    });
  }

  const demo = {
    schemaVersion: 1,
    kind: "safe-public-demo",
    // Keep generated artifacts byte-for-byte reproducible across machines.
    generatedAt: "2026-09-13T00:00:00.000Z",
    spec: {
      pdfPath: "/examples/factory-quality-spec-example.pdf",
      document,
      extraction: {
        candidate,
        validation: { schemaValid: true, evidenceValid: true, issues: [] },
        provider: {
          model: "recorded-example",
          responseId: null,
          latencyMs: 0,
          usage: { inputTokens: null, outputTokens: null, totalTokens: null },
        },
      },
    },
    samples,
    safety: {
      paidLlmCalls: 0,
      extractionMode: "recorded",
      publicUploadsEnabled: false,
      frozenTestSplitAccessed: false,
    },
    dataset: {
      name: datasetManifest.dataset.title,
      source: datasetManifest.dataset.source,
      doi: datasetManifest.dataset.doi,
      license: datasetManifest.dataset.license,
      licenseUrl: datasetManifest.dataset.licenseUrl,
      attribution: "DsPCBSD+ by Shengping Lv, used under CC BY 4.0.",
    },
  };
  await writeFile(resolve(OUTPUT_ROOT, "demo.json"), `${JSON.stringify(demo, null, 2)}\n`, "utf8");
  await writeFile(BUNDLED_MANIFEST_PATH, `${JSON.stringify(demo, null, 2)}\n`, "utf8");
  await writeFile(resolve(OUTPUT_ROOT, "ATTRIBUTION.md"),
    `# Public demo image attribution\n\nThe PCB sample images are internal-validation examples from [DsPCBSD+](${demo.dataset.source}) by Shengping Lv, used under [CC BY 4.0](${demo.dataset.licenseUrl}). The official validation partition remains the frozen test split and is not used by this public demo.\n`, "utf8");
  console.log(JSON.stringify({ output: resolve(OUTPUT_ROOT, "demo.json"), bundled: BUNDLED_MANIFEST_PATH, samples: samples.map(sample => ({ id: sample.id, outcome: sample.expectedOutcome })), frozenTestSplitAccessed: false }, null, 2));
}

await main();
