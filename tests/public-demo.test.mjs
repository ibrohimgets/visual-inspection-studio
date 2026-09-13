import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { evaluateInspection, validateInspectionRuleSet } from "../lib/inspection-rules.ts";
import { PUBLIC_DEMO, validatePublicDemo } from "../lib/public-demo.ts";
import { approveInspectionRuleCandidate, verifyExtractedRuleEvidence } from "../lib/spec-extraction.ts";

test("the public walkthrough is zero-cost and never uses the frozen test partition", () => {
  assert.deepEqual(validatePublicDemo(PUBLIC_DEMO), []);
  assert.equal(PUBLIC_DEMO.safety.paidLlmCalls, 0);
  assert.equal(PUBLIC_DEMO.safety.extractionMode, "recorded");
  assert.equal(PUBLIC_DEMO.safety.publicUploadsEnabled, false);
  assert.equal(PUBLIC_DEMO.safety.frozenTestSplitAccessed, false);
  for (const sample of PUBLIC_DEMO.samples) {
    assert.equal(sample.provenance.datasetSplit, "validation");
    assert.match(sample.provenance.datasetFile, /^train2017\//);
    assert.doesNotMatch(sample.provenance.datasetFile, /^val2017\//);
  }
});

test("the recorded candidate matches the bundled PDF and remains behind approval", () => {
  const pdf = readFileSync(new URL("../public/examples/factory-quality-spec-example.pdf", import.meta.url));
  const fingerprint = `sha256:${createHash("sha256").update(pdf).digest("hex")}`;
  assert.equal(fingerprint, PUBLIC_DEMO.spec.document.documentId);
  assert.equal(validateInspectionRuleSet(PUBLIC_DEMO.spec.extraction.candidate).valid, true);
  assert.deepEqual(verifyExtractedRuleEvidence(PUBLIC_DEMO.spec.extraction.candidate, PUBLIC_DEMO.spec.document), []);
  const approved = approveInspectionRuleCandidate(PUBLIC_DEMO.spec.extraction.candidate, PUBLIC_DEMO.spec.document);
  assert.notEqual(approved, PUBLIC_DEMO.spec.extraction.candidate);
});

test("real cached samples deterministically cover PASS, REVIEW, and FAIL", () => {
  const policy = approveInspectionRuleCandidate(PUBLIC_DEMO.spec.extraction.candidate, PUBLIC_DEMO.spec.document);
  const outcomes = new Set();
  for (const sample of PUBLIC_DEMO.samples) {
    const decision = evaluateInspection(sample.run.detections, policy);
    assert.equal(decision.outcome, sample.expectedOutcome, sample.id);
    assert.equal(decision.severity, sample.expectedSeverity, sample.id);
    assert.ok(sample.run.detections.length > 0, sample.id);
    assert.equal(sample.run.executionProvider, "cached validation inference");
    outcomes.add(decision.outcome);
    const relativeInput = `../public${sample.imagePath}`;
    const relativeOutput = `../public${sample.annotatedPath}`;
    assert.equal(existsSync(new URL(relativeInput, import.meta.url)), true);
    assert.equal(existsSync(new URL(relativeOutput, import.meta.url)), true);
  }
  assert.deepEqual([...outcomes].sort(), ["FAIL", "PASS", "REVIEW"]);
});
