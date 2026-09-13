import publicDemoJson from "./generated/public-demo-data.json" with { type: "json" };
import type { Run } from "./detection.ts";
import type { InspectionOutcome, InspectionRuleSet, InspectionSeverity } from "./inspection-rules.ts";
import type { RuleExtractionResult, SearchableSpecDocument } from "./spec-extraction.ts";

export type PublicDemoSample = {
  id: string;
  imageId: string;
  title: string;
  clientSummary: string;
  imagePath: string;
  annotatedPath: string;
  width: number;
  height: number;
  expectedOutcome: InspectionOutcome;
  expectedSeverity: InspectionSeverity;
  classNames: string[];
  run: Run;
  provenance: {
    datasetSplit: string;
    datasetFile: string;
    model: string;
    checkpointEpoch: number;
    thresholdProfile: string;
  };
};

export type PublicDemo = {
  schemaVersion: 1;
  kind: "safe-public-demo";
  generatedAt: string;
  spec: {
    pdfPath: string;
    document: SearchableSpecDocument;
    extraction: RuleExtractionResult;
  };
  samples: PublicDemoSample[];
  safety: {
    paidLlmCalls: 0;
    extractionMode: "recorded";
    publicUploadsEnabled: false;
    frozenTestSplitAccessed: false;
  };
  dataset: {
    name: string;
    source: string;
    doi: string;
    license: string;
    licenseUrl: string;
    attribution: string;
  };
};

export function validatePublicDemo(input: PublicDemo) {
  const issues: string[] = [];
  if (input.schemaVersion !== 1 || input.kind !== "safe-public-demo") issues.push("Unsupported public-demo manifest.");
  if (input.safety.paidLlmCalls !== 0 || input.safety.extractionMode !== "recorded") issues.push("Public demo is not zero-cost.");
  if (input.safety.frozenTestSplitAccessed !== false) issues.push("Frozen test access is not allowed.");
  if (input.samples.length < 3) issues.push("Public demo needs at least three inspection samples.");
  const outcomes = new Set(input.samples.map(sample => sample.expectedOutcome));
  for (const outcome of ["PASS", "REVIEW", "FAIL"] as InspectionOutcome[]) {
    if (!outcomes.has(outcome)) issues.push(`Public demo is missing a ${outcome} example.`);
  }
  for (const sample of input.samples) {
    if (sample.provenance.datasetSplit !== "validation" || !sample.provenance.datasetFile.startsWith("train2017/")) {
      issues.push(`${sample.id} is not an internal-validation sample.`);
    }
    if (!sample.run.detections.length) issues.push(`${sample.id} has no recorded detector finding.`);
  }
  return issues;
}

export const PUBLIC_DEMO = publicDemoJson as PublicDemo;
export const PUBLIC_DEMO_POLICY = PUBLIC_DEMO.spec.extraction.candidate as InspectionRuleSet;
