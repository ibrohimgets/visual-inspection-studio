import assert from "node:assert/strict";
import test from "node:test";
import { deriveConfidenceBands, isActionableTerraDecision, validateTerraDecisions } from "../lib/hybrid.ts";

test("confidence bands preserve recall below and precision above", () => {
  const bands = deriveConfidenceBands([
    { confidenceThreshold: .2, precision: .5, recall: .8 },
    { confidenceThreshold: .3, precision: .65, recall: .71 },
    { confidenceThreshold: .4, precision: .75, recall: .65 },
    { confidenceThreshold: .6, precision: .86, recall: .5 },
  ]);
  assert.deepEqual(bands, { rejectBelow: .3, trustAtOrAbove: .6, minimumRecallTarget: .7, minimumPrecisionTarget: .85 });
});

test("Terra batch decisions must cover each candidate exactly once", () => {
  const output = { decisions: [{
    candidateId: "p-1", verdict: "confirm", label: "SH", modelScore: .8,
    evidence: "Visible bridge inside the marked proposal.", uncertainty: { level: "low", reasons: ["clear edge"] },
  }] };
  const [decision] = validateTerraDecisions(output, ["p-1"], ["SH"]);
  assert.equal(decision.candidateId, "p-1");
  assert.throws(() => validateTerraDecisions({ decisions: [] }, ["p-1"], ["SH"]), /returned 0 decisions/);
});

test("only low-uncertainty, sufficiently scored Terra verdicts are actionable", () => {
  const decision = { candidateId: "p-1", verdict: "reject", label: "SH", modelScore: .7, evidence: "Normal trace.", uncertainty: { level: "low", reasons: ["clear"] } };
  assert.equal(isActionableTerraDecision(decision, .65), true);
  assert.equal(isActionableTerraDecision({ ...decision, uncertainty: { ...decision.uncertainty, level: "medium" } }, .65), false);
  assert.equal(isActionableTerraDecision({ ...decision, verdict: "uncertain" }, .65), false);
});
