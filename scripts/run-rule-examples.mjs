import { readFile } from "node:fs/promises";
import { evaluateInspection } from "../lib/inspection-rules.ts";

const policy = JSON.parse(await readFile(new URL("../inspection/policies/pcb-example.json", import.meta.url), "utf8"));
const finding = (id, label, confidence, review = "pending") => ({
  id, label, confidence, review, note: "", x: id * 10, y: id * 8, width: 24, height: 16,
});
const unsupportedPolicy = {
  ...policy,
  id: "unsupported-measurement-example",
  rules: [{ id: "scratch-length", type: "dimension-threshold", description: "scratch longer than 2 mm",
    severity: "critical", millimetres: 2 }],
};

const scenarios = [
  { id: "clean", description: "No findings", detections: [], ruleSet: policy },
  { id: "critical", description: "One strong critical finding", detections: [finding(1, "SH", .92)], ruleSet: policy },
  { id: "uncertain", description: "Critical-class proposal inside confidence review band", detections: [finding(1, "SH", .55)], ruleSet: policy },
  { id: "confirmed", description: "Reviewer-confirmed ambiguous critical finding", detections: [finding(1, "SH", .55, "accepted")], ruleSet: policy },
  { id: "count-limit", description: "Three otherwise acceptable cosmetic findings", detections: [1, 2, 3].map(id => finding(id, "SP", .9)), ruleSet: policy },
  { id: "unsupported", description: "Unmeasurable 2 mm requirement", detections: [], ruleSet: unsupportedPolicy },
];

const output = scenarios.map(scenario => {
  const decision = evaluateInspection(scenario.detections, scenario.ruleSet);
  return {
    id: scenario.id,
    description: scenario.description,
    outcome: decision.outcome,
    severity: decision.severity,
    decisiveRuleIds: decision.decisiveRuleIds,
    actionableDetectionIds: decision.evidence.actionableDetectionIds,
    reviewDetectionIds: decision.evidence.reviewDetectionIds,
    summary: decision.summary,
  };
});

console.log(JSON.stringify({ schemaVersion: 1, policy: policy.id, scenarios: output }, null, 2));
