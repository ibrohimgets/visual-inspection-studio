import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { CLASSES } from "../lib/detection.ts";
import { evaluateInspection } from "../lib/inspection-rules.ts";
import { approveInspectionRuleCandidate } from "../lib/spec-extraction.ts";

const endpoint = process.argv[2] ?? "http://localhost:5173/api/specs/extract";
const pdfPath = resolve("output/pdf/factory-quality-spec-example.pdf");
const outputPath = resolve(process.argv[3] ?? "reports/local/spec-pipeline-example.json");
const bytes = new Uint8Array(await readFile(pdfPath));
const documentId = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const loadingTask = getDocument({
  data: bytes,
  useSystemFonts: true,
});
const pdf = await loadingTask.promise;
const pages = [];
for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  const text = content.items.map(item => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "")
    .join("").replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  pages.push({ page: pageNumber, text });
}
await loadingTask.destroy();

const document = {
  documentId,
  fileName: "factory-quality-spec-example.pdf",
  pages,
  supportedClasses: [...CLASSES],
};
const response = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(document),
});
const extraction = await response.json();
if (!response.ok) throw new Error(`${extraction.error?.code ?? response.status}: ${extraction.error?.message ?? "Extraction failed"}`);

// This explicit harness action exercises the same approval gate as the UI button.
const approvedPolicy = approveInspectionRuleCandidate(extraction.candidate, document);
const exampleDetections = [{ id: 1, label: "person", confidence: .92, x: 44, y: 32,
  width: 180, height: 310, review: "pending", note: "" }];
const decision = evaluateInspection(exampleDetections, approvedPolicy);
const report = {
  generatedAt: new Date().toISOString(),
  document: { fileName: document.fileName, documentId, pages: pages.length,
    extractedCharacters: pages.reduce((total, page) => total + page.text.length, 0) },
  extraction: {
    provider: extraction.provider,
    validation: extraction.validation,
    candidate: extraction.candidate,
  },
  approvalGate: { action: "explicit-harness-approval", policyId: approvedPolicy.id, policyVersion: approvedPolicy.version },
  deterministicEngineExample: { detections: exampleDetections, decision },
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  pdf: report.document,
  extraction: { model: report.extraction.provider.model, latencyMs: report.extraction.provider.latencyMs,
    tokens: report.extraction.provider.usage.totalTokens, rules: approvedPolicy.rules.length },
  ruleTypes: approvedPolicy.rules.reduce((counts, rule) => ({ ...counts, [rule.type]: (counts[rule.type] ?? 0) + 1 }), {}),
  approval: report.approvalGate.action,
  engineDecision: { outcome: decision.outcome, severity: decision.severity, decisiveRuleIds: decision.decisiveRuleIds },
  report: outputPath,
}, null, 2));
