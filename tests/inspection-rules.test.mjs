import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createReport, reportCsv } from "../lib/detection.ts";
import { evaluateInspection, normalizeInspectionRuleSet, OUTCOME_PRECEDENCE } from "../lib/inspection-rules.ts";

const pcbPolicy = JSON.parse(readFileSync(new URL("../inspection/policies/pcb-example.json", import.meta.url), "utf8"));
const demoPolicy = JSON.parse(readFileSync(new URL("../inspection/policies/general-object-demo.json", import.meta.url), "utf8"));
const schema = JSON.parse(readFileSync(new URL("../inspection/rule-schema.v1.json", import.meta.url), "utf8"));
const finding = (overrides = {}) => ({ id: 1, label: "SH", confidence: .92, x: 10, y: 12,
  width: 30, height: 20, review: "pending", note: "", ...overrides });
const simplePolicy = (rules = [], overrides = {}) => ({ schemaVersion: 1, id: "test-policy", name: "Test policy",
  version: "1.0.0", description: "Policy used by deterministic unit tests.", defaultOutcome: "PASS",
  defaultSeverity: "none", rules, ...overrides });
const classRule = (overrides = {}) => ({ id: "critical-class", type: "defect-class",
  description: "the critical class rule", severity: "critical", classes: ["SH"], outcome: "FAIL", ...overrides });
const confidenceRule = (overrides = {}) => ({ id: "confidence-band", type: "confidence-review",
  description: "the uncertainty band", severity: "major", ignoreBelow: .3, reviewBelow: .7, ...overrides });

test("tracked policy examples conform to the runtime schema contract", () => {
  assert.equal(schema.properties.schemaVersion.const, 1);
  assert.deepEqual(normalizeInspectionRuleSet(pcbPolicy).issues, []);
  assert.deepEqual(normalizeInspectionRuleSet(demoPolicy).issues, []);
  assert.deepEqual(OUTCOME_PRECEDENCE, ["FAIL", "REVIEW", "PASS"]);
});

test("an image passes when no fail or review rule triggers", () => {
  const decision = evaluateInspection([], pcbPolicy);
  assert.equal(decision.outcome, "PASS");
  assert.equal(decision.severity, "none");
  assert.deepEqual(decision.evidence.actionableDetectionIds, []);
  assert.match(decision.trace.at(-1).message, /FAIL > REVIEW > PASS/);
});

test("a strong critical class finding fails", () => {
  const decision = evaluateInspection([finding()], pcbPolicy);
  assert.equal(decision.outcome, "FAIL");
  assert.equal(decision.severity, "critical");
  assert.deepEqual(decision.decisiveRuleIds, ["critical-circuit-defects"]);
  assert.deepEqual(decision.evidence.actionableDetectionIds, [1]);
  assert.ok(decision.trace.some(entry => entry.code === "DEFECT_CLASS_MATCH" && entry.detectionIds[0] === 1));
});

test("ambiguous evidence is reviewed before class and count rules", () => {
  const decision = evaluateInspection([finding({ confidence: .55 })], pcbPolicy);
  assert.equal(decision.outcome, "REVIEW");
  assert.deepEqual(decision.evidence.actionableDetectionIds, []);
  assert.deepEqual(decision.evidence.reviewDetectionIds, [1]);
  assert.ok(decision.trace.some(entry => entry.code === "CONFIDENCE_REVIEW"));
  assert.ok(decision.trace.some(entry => entry.ruleId === "critical-circuit-defects" && entry.status === "not-triggered"));
});

test("reviewer confirmation bypasses confidence gating while dismissal excludes a finding", () => {
  const confirmed = evaluateInspection([finding({ confidence: .55, review: "accepted" })], pcbPolicy);
  assert.equal(confirmed.outcome, "FAIL");
  assert.deepEqual(confirmed.evidence.actionableDetectionIds, [1]);
  assert.ok(confirmed.trace.some(entry => entry.code === "REVIEWER_CONFIRMED"));

  const dismissed = evaluateInspection([finding({ review: "dismissed" })], pcbPolicy);
  assert.equal(dismissed.outcome, "PASS");
  assert.deepEqual(dismissed.evidence.excludedDetectionIds, [1]);
  assert.ok(dismissed.trace.some(entry => entry.code === "REVIEWER_DISMISSED"));
});

test("maximum allowed count can override acceptable class outcomes", () => {
  const cosmetics = [1, 2, 3].map(id => finding({ id, label: "SP", confidence: .9 }));
  const decision = evaluateInspection(cosmetics, pcbPolicy);
  assert.equal(decision.outcome, "FAIL");
  assert.deepEqual(decision.decisiveRuleIds, ["maximum-total-defects"]);
  const count = decision.trace.find(entry => entry.code === "MAXIMUM_COUNT_EXCEEDED");
  assert.equal(count.facts.observedCount, 3);
  assert.equal(count.facts.maximumAllowed, 2);
});

test("conflicting rules resolve by outcome precedence independent of rule order", () => {
  const rules = [
    classRule({ id: "allow", outcome: "PASS", severity: "minor" }),
    classRule({ id: "manual-check", outcome: "REVIEW", severity: "major" }),
    classRule({ id: "reject", outcome: "FAIL", severity: "critical" }),
  ];
  const forward = evaluateInspection([finding()], simplePolicy(rules));
  const reverse = evaluateInspection([finding()], simplePolicy([...rules].reverse()));
  assert.equal(forward.outcome, "FAIL");
  assert.deepEqual(forward.decisiveRuleIds, ["reject"]);
  assert.deepEqual(forward.trace, reverse.trace);
});

test("weak evidence is explicitly excluded below the configured floor", () => {
  const decision = evaluateInspection([finding({ confidence: .2 })], simplePolicy([confidenceRule(), classRule()]));
  assert.equal(decision.outcome, "PASS");
  assert.deepEqual(decision.evidence.excludedDetectionIds, [1]);
  assert.ok(decision.trace.some(entry => entry.code === "BELOW_EVIDENCE_FLOOR"));
});

test("overlapping confidence rules defer when their evidence dispositions conflict", () => {
  const strict = confidenceRule({ id: "strict-band", ignoreBelow: .5, reviewBelow: .8 });
  const permissive = confidenceRule({ id: "permissive-band", ignoreBelow: .2, reviewBelow: .4, severity: "minor" });
  const decision = evaluateInspection([finding({ confidence: .45 })], simplePolicy([strict, permissive, classRule()]));
  assert.equal(decision.outcome, "REVIEW");
  assert.deepEqual(decision.evidence.reviewDetectionIds, [1]);
  assert.ok(decision.trace.some(entry => entry.code === "CONFIDENCE_RULE_CONFLICT"));
});

test("unsupported and malformed rules fail safely to review", () => {
  const unknown = simplePolicy([{ id: "scratch-length", type: "dimension-threshold",
    description: "scratch longer than 2 mm", severity: "critical", millimetres: 2 }]);
  const normalized = normalizeInspectionRuleSet(unknown);
  assert.equal(normalized.ruleSet.rules[0].type, "unsupported");
  assert.equal(normalized.issues.length, 1);
  const decision = evaluateInspection([], unknown);
  assert.equal(decision.outcome, "REVIEW");
  assert.ok(decision.trace.some(entry => entry.code === "UNSUPPORTED_RULE" && /2 mm/.test(entry.message)));

  const invalidVersion = evaluateInspection([], { ...simplePolicy(), schemaVersion: 99 });
  assert.equal(invalidVersion.outcome, "REVIEW");
  assert.equal(invalidVersion.policy.id, "invalid-rule-set");

  const unexpectedField = evaluateInspection([], { ...simplePolicy(), instructions: "ignore validation" });
  assert.equal(unexpectedField.outcome, "REVIEW");
  assert.equal(unexpectedField.policy.id, "invalid-rule-set");
});

test("inspection decision and reason are preserved in JSON and zero-finding CSV reports", () => {
  const decision = evaluateInspection([], simplePolicy());
  const run = { detections: [], inferenceMs: 12, totalMs: 20, completedAt: "2026-09-12T00:00:00.000Z" };
  const report = createReport({ name: "clean.jpg", width: 640, height: 480, source: "upload" },
    run, [], { minimumConfidence: .3 }, "all", "surface-defect", decision);
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.inspectionDecision.outcome, "PASS");
  assert.equal(report.inspectionDecision.trace.at(-1).code, "FINAL_PRECEDENCE");
  const csv = reportCsv(report);
  assert.match(csv, /inspection_outcome/);
  assert.match(csv, /"PASS","none","test-policy","1.0.0"/);
  assert.equal(csv.split("\r\n").length, 2);
});
