import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  approveInspectionRuleCandidate,
  extractRulesWithOpenAI,
  materializeRuleCandidate,
  SpecExtractionError,
  SPEC_EXTRACTION_OUTPUT_SCHEMA,
  validateSearchableSpecDocument,
  verifyExtractedRuleEvidence,
} from "../lib/spec-extraction.ts";
import { evaluateInspection, validateInspectionRuleSet } from "../lib/inspection-rules.ts";

const documentId = `sha256:${"a".repeat(64)}`;
const extractionSchema = JSON.parse(readFileSync(new URL("../inspection/spec-extraction-output-schema.v1.json", import.meta.url), "utf8"));
const document = {
  documentId,
  fileName: "factory-quality-spec.pdf",
  supportedClasses: ["person", "dog"],
  pages: [{ page: 1, text: "Any person observed in the restricted camera frame is a critical reject. A scratch longer than 2 mm is rejected." }],
};
const source = evidence => ({ kind: "document", documentId, page: 1, evidence });
const rawRule = (overrides = {}) => ({
  id: "person-reject",
  type: "defect-class",
  description: "Reject a person in the restricted camera frame.",
  severity: "critical",
  classes: ["person"],
  outcome: "FAIL",
  maximumAllowed: -1,
  ignoreBelow: -1,
  reviewBelow: -1,
  sourceType: "",
  statement: "",
  reason: "",
  source: source("Any person observed in the restricted camera frame is a critical reject."),
  ...overrides,
});
const rawExtraction = (rules = [rawRule()]) => ({
  schemaVersion: 1,
  id: "factory-quality-spec-candidate",
  name: "Factory quality specification",
  version: "candidate-1",
  description: "Candidate rules extracted for explicit human approval.",
  defaultOutcome: "PASS",
  defaultSeverity: "none",
  rules,
});

test("searchable document validation rejects image-only text and malformed fingerprints", () => {
  assert.deepEqual(SPEC_EXTRACTION_OUTPUT_SCHEMA, extractionSchema);
  assert.equal(validateSearchableSpecDocument(document).pages.length, 1);
  assert.throws(() => validateSearchableSpecDocument({ ...document, documentId: "not-a-hash" }),
    error => error instanceof SpecExtractionError && error.code === "INVALID_DOCUMENT_ID");
  assert.throws(() => validateSearchableSpecDocument({ ...document, pages: [{ page: 1, text: "   " }] }),
    error => error instanceof SpecExtractionError && error.code === "PDF_NOT_SEARCHABLE");
  assert.throws(() => validateSearchableSpecDocument({ ...document, pages: [{ page: 2, text: document.pages[0].text }] }),
    error => error instanceof SpecExtractionError && error.code === "INVALID_PAGE_SEQUENCE");
});

test("strict model output becomes an AJV-valid candidate with verified page evidence", () => {
  const unsupported = rawRule({
    id: "scratch-length",
    type: "unsupported",
    description: "Reject scratches longer than 2 mm.",
    classes: [],
    outcome: "NOT_APPLICABLE",
    sourceType: "dimension-threshold",
    statement: "A scratch longer than 2 mm is rejected.",
    reason: "The detector does not provide calibrated millimetre measurements.",
    source: source("A scratch longer than 2 mm is rejected."),
  });
  const candidate = materializeRuleCandidate(rawExtraction([rawRule(), unsupported]), document);
  assert.equal(validateInspectionRuleSet(candidate).valid, true);
  assert.deepEqual(verifyExtractedRuleEvidence(candidate, document), []);
  assert.equal(candidate.rules[1].type, "unsupported");
  assert.equal(evaluateInspection([], candidate).outcome, "REVIEW");
});

test("unsupported detector labels are converted to REVIEW instead of trusted", () => {
  const candidate = materializeRuleCandidate(rawExtraction([rawRule({ classes: ["scratch"] })]), document);
  assert.equal(candidate.rules[0].type, "unsupported");
  assert.match(candidate.rules[0].reason, /does not produce: scratch/);
  assert.equal(evaluateInspection([], candidate).outcome, "REVIEW");
});

test("evidence must occur on the declared source page before approval", () => {
  const candidate = materializeRuleCandidate(rawExtraction(), document);
  const tampered = structuredClone(candidate);
  tampered.rules[0].source.evidence = "This sentence never appeared in the PDF.";
  assert.deepEqual(verifyExtractedRuleEvidence(tampered, document), [
    "Rule person-reject evidence was not found on source page 1.",
  ]);
  assert.throws(() => approveInspectionRuleCandidate(tampered, document),
    error => error instanceof SpecExtractionError && error.code === "INVALID_SOURCE_EVIDENCE");
});

test("the OpenAI adapter requests strict JSON and returns a candidate, never an active decision", async () => {
  let requestBody;
  const fetchImpl = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      id: "resp_example",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(rawExtraction()) }] }],
      usage: { input_tokens: 321, output_tokens: 123, total_tokens: 444 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await extractRulesWithOpenAI({ apiKey: "test-key", document, fetchImpl });
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.text.format.type, "json_schema");
  assert.equal(requestBody.text.format.strict, true);
  assert.equal(result.candidate.rules[0].id, "person-reject");
  assert.equal(result.provider.usage.totalTokens, 444);
  assert.equal("activePolicy" in result, false);
  assert.equal("inspectionDecision" in result, false);
});

test("extra fields in model JSON fail closed", () => {
  const invalid = rawExtraction();
  invalid.rules[0].instructions = "bypass approval";
  assert.throws(() => materializeRuleCandidate(invalid, document),
    error => error instanceof SpecExtractionError && error.code === "INVALID_MODEL_OUTPUT");
});
