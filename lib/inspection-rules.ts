import type { Detection } from "./detectors/types.ts";

export const INSPECTION_RULE_SCHEMA_VERSION = 1 as const;
export const OUTCOME_PRECEDENCE = ["FAIL", "REVIEW", "PASS"] as const;

export type InspectionOutcome = "PASS" | "FAIL" | "REVIEW";
export type InspectionSeverity = "none" | "info" | "minor" | "major" | "critical";
export type RuleSeverity = Exclude<InspectionSeverity, "none">;

type RuleBase = {
  id: string;
  description: string;
  severity: RuleSeverity;
};

export type DefectClassRule = RuleBase & {
  type: "defect-class";
  classes: string[];
  outcome: InspectionOutcome;
};

export type MaximumDefectCountRule = RuleBase & {
  type: "maximum-defect-count";
  classes?: string[];
  maximumAllowed: number;
  outcome: InspectionOutcome;
};

export type ConfidenceReviewRule = RuleBase & {
  type: "confidence-review";
  classes?: string[];
  ignoreBelow: number;
  reviewBelow: number;
};

export type UnsupportedInspectionRule = RuleBase & {
  type: "unsupported";
  sourceType: string;
  statement: string;
  reason: string;
};

export type InspectionRule = DefectClassRule | MaximumDefectCountRule | ConfidenceReviewRule | UnsupportedInspectionRule;

export type InspectionRuleSet = {
  schemaVersion: typeof INSPECTION_RULE_SCHEMA_VERSION;
  id: string;
  name: string;
  version: string;
  description: string;
  defaultOutcome: InspectionOutcome;
  defaultSeverity: InspectionSeverity;
  rules: InspectionRule[];
};

export type RuleTraceStatus = "triggered" | "not-triggered" | "excluded" | "context" | "selected";

export type RuleTraceEntry = {
  step: number;
  code: string;
  ruleId: string | null;
  ruleType: string;
  status: RuleTraceStatus;
  outcome: InspectionOutcome;
  severity: InspectionSeverity;
  detectionIds: number[];
  message: string;
  facts?: Record<string, string | number | boolean | string[] | number[]>;
};

export type InspectionDecision = {
  schemaVersion: typeof INSPECTION_RULE_SCHEMA_VERSION;
  policy: InspectionRuleSet;
  outcome: InspectionOutcome;
  severity: InspectionSeverity;
  summary: string;
  precedence: readonly ["FAIL", "REVIEW", "PASS"];
  decisiveRuleIds: string[];
  evidence: {
    inputDetections: number;
    actionableDetectionIds: number[];
    reviewDetectionIds: number[];
    excludedDetectionIds: number[];
  };
  trace: RuleTraceEntry[];
};

export type NormalizedRuleSet = {
  ruleSet: InspectionRuleSet;
  issues: string[];
};

const outcomeRank: Record<InspectionOutcome, number> = { PASS: 0, REVIEW: 1, FAIL: 2 };
const severityRank: Record<InspectionSeverity, number> = { none: 0, info: 1, minor: 2, major: 3, critical: 4 };
const ruleTypeRank: Record<InspectionRule["type"], number> = {
  unsupported: 0,
  "confidence-review": 1,
  "defect-class": 2,
  "maximum-defect-count": 3,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isOutcome(value: unknown): value is InspectionOutcome {
  return value === "PASS" || value === "FAIL" || value === "REVIEW";
}

function isSeverity(value: unknown): value is InspectionSeverity {
  return value === "none" || value === "info" || value === "minor" || value === "major" || value === "critical";
}

function isRuleSeverity(value: unknown): value is RuleSeverity {
  return value === "info" || value === "minor" || value === "major" || value === "critical";
}

function validText(value: unknown, maximum = 500): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every(key => allowed.includes(key));
}

function validClasses(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 100
    && value.every(item => validText(item, 100)) && new Set(value).size === value.length;
}

function optionalClasses(value: unknown): value is string[] | undefined {
  return value === undefined || validClasses(value);
}

function validConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function unsupportedFrom(raw: unknown, index: number, reason: string, idOverride?: string): UnsupportedInspectionRule {
  const source = isRecord(raw) ? raw : {};
  const sourceType = validText(source.type, 100) ? source.type : "unknown";
  const suppliedId = validId(source.id) ? source.id : `unsupported-${String(index + 1).padStart(2, "0")}`;
  return {
    id: idOverride ?? suppliedId,
    type: "unsupported",
    sourceType,
    statement: validText(source.statement, 500)
      ? source.statement.trim()
      : validText(source.description, 500) ? source.description.trim() : `Unsupported rule of type ${sourceType}`,
    reason,
    description: validText(source.description, 500) ? source.description.trim() : "This requirement cannot be evaluated deterministically.",
    severity: isRuleSeverity(source.severity) ? source.severity : "major",
  };
}

function normalizeRule(raw: unknown, index: number): { rule: InspectionRule; issue?: string } {
  if (!isRecord(raw)) {
    const issue = `Rule ${index + 1} must be an object.`;
    return { rule: unsupportedFrom(raw, index, issue), issue };
  }
  if (!validId(raw.id) || !validText(raw.description) || !isRuleSeverity(raw.severity)) {
    const issue = `Rule ${index + 1} has invalid id, description, or severity metadata.`;
    return { rule: unsupportedFrom(raw, index, issue), issue };
  }

  if (raw.type === "defect-class") {
    if (!hasOnlyKeys(raw, ["id", "type", "description", "severity", "classes", "outcome"])
      || !validClasses(raw.classes) || !isOutcome(raw.outcome)) {
      const issue = `Rule ${raw.id} has invalid classes or outcome.`;
      return { rule: unsupportedFrom(raw, index, issue), issue };
    }
    return { rule: { id: raw.id, type: raw.type, description: raw.description.trim(), severity: raw.severity,
      classes: [...raw.classes], outcome: raw.outcome } };
  }

  if (raw.type === "maximum-defect-count") {
    if (!hasOnlyKeys(raw, ["id", "type", "description", "severity", "classes", "maximumAllowed", "outcome"])
      || !optionalClasses(raw.classes) || !Number.isInteger(raw.maximumAllowed) || (raw.maximumAllowed as number) < 0
      || !isOutcome(raw.outcome)) {
      const issue = `Rule ${raw.id} has an invalid class filter, maximumAllowed, or outcome.`;
      return { rule: unsupportedFrom(raw, index, issue), issue };
    }
    return { rule: { id: raw.id, type: raw.type, description: raw.description.trim(), severity: raw.severity,
      ...(raw.classes ? { classes: [...raw.classes] } : {}), maximumAllowed: raw.maximumAllowed as number,
      outcome: raw.outcome } };
  }

  if (raw.type === "confidence-review") {
    if (!hasOnlyKeys(raw, ["id", "type", "description", "severity", "classes", "ignoreBelow", "reviewBelow"])
      || !optionalClasses(raw.classes) || !validConfidence(raw.ignoreBelow) || !validConfidence(raw.reviewBelow)
      || raw.ignoreBelow >= raw.reviewBelow) {
      const issue = `Rule ${raw.id} needs 0 <= ignoreBelow < reviewBelow <= 1 and a valid optional class filter.`;
      return { rule: unsupportedFrom(raw, index, issue), issue };
    }
    return { rule: { id: raw.id, type: raw.type, description: raw.description.trim(), severity: raw.severity,
      ...(raw.classes ? { classes: [...raw.classes] } : {}), ignoreBelow: raw.ignoreBelow,
      reviewBelow: raw.reviewBelow } };
  }

  if (raw.type === "unsupported") {
    if (!hasOnlyKeys(raw, ["id", "type", "description", "severity", "sourceType", "statement", "reason"])
      || !validText(raw.sourceType, 100) || !validText(raw.statement) || !validText(raw.reason)) {
      const issue = `Unsupported rule ${raw.id} needs sourceType, statement, and reason.`;
      return { rule: unsupportedFrom(raw, index, issue), issue };
    }
    return { rule: { id: raw.id, type: raw.type, description: raw.description.trim(), severity: raw.severity,
      sourceType: raw.sourceType.trim(), statement: raw.statement.trim(), reason: raw.reason.trim() } };
  }

  const issue = `Rule ${raw.id} uses unsupported type ${String(raw.type)}.`;
  return { rule: unsupportedFrom(raw, index, issue), issue };
}

function invalidRuleSet(reason: string): NormalizedRuleSet {
  return {
    issues: [reason],
    ruleSet: {
      schemaVersion: INSPECTION_RULE_SCHEMA_VERSION,
      id: "invalid-rule-set",
      name: "Invalid inspection rule set",
      version: "0",
      description: "The supplied inspection policy could not be validated.",
      defaultOutcome: "PASS",
      defaultSeverity: "none",
      rules: [unsupportedFrom({ id: "invalid-policy", type: "rule-set", description: reason, severity: "critical" }, 0, reason)],
    },
  };
}

export function normalizeInspectionRuleSet(input: unknown): NormalizedRuleSet {
  if (!isRecord(input)) return invalidRuleSet("Inspection rule set must be an object.");
  if (input.schemaVersion !== INSPECTION_RULE_SCHEMA_VERSION) {
    return invalidRuleSet(`Unsupported inspection rule schema version ${String(input.schemaVersion)}.`);
  }
  if (!hasOnlyKeys(input, ["schemaVersion", "id", "name", "version", "description", "defaultOutcome", "defaultSeverity", "rules"])
    || !validId(input.id) || !validText(input.name, 200) || !validText(input.version, 100)
    || !validText(input.description) || !isOutcome(input.defaultOutcome) || !isSeverity(input.defaultSeverity)
    || !Array.isArray(input.rules)) {
    return invalidRuleSet("Inspection rule set metadata or rules array is invalid.");
  }

  const normalized = input.rules.map(normalizeRule);
  const issues = normalized.flatMap(item => item.issue ? [item.issue] : []);
  const idCounts = new Map<string, number>();
  normalized.forEach(({ rule }) => idCounts.set(rule.id, (idCounts.get(rule.id) ?? 0) + 1));
  const rules = normalized.map(({ rule }, index) => {
    if ((idCounts.get(rule.id) ?? 0) === 1) return rule;
    const issue = `Duplicate rule id ${rule.id}.`;
    issues.push(issue);
    return unsupportedFrom(rule, index, issue, `duplicate-${String(index + 1).padStart(2, "0")}`);
  });

  return {
    issues,
    ruleSet: {
      schemaVersion: INSPECTION_RULE_SCHEMA_VERSION,
      id: input.id,
      name: input.name.trim(),
      version: input.version.trim(),
      description: input.description.trim(),
      defaultOutcome: input.defaultOutcome,
      defaultSeverity: input.defaultSeverity,
      rules,
    },
  };
}

function appliesToClass(classes: string[] | undefined, detection: Detection) {
  return !classes || classes.includes(detection.label);
}

function compareRules(left: InspectionRule, right: InspectionRule) {
  return ruleTypeRank[left.type] - ruleTypeRank[right.type] || left.id.localeCompare(right.id);
}

function compareDetections(left: Detection, right: Detection) {
  return left.id - right.id || left.label.localeCompare(right.label) || left.x - right.x || left.y - right.y;
}

function maximumSeverity(values: InspectionSeverity[]) {
  return values.reduce((selected, value) => severityRank[value] > severityRank[selected] ? value : selected, "none" as InspectionSeverity);
}

export function evaluateInspection(detections: readonly Detection[], inputRuleSet: unknown): InspectionDecision {
  const { ruleSet } = normalizeInspectionRuleSet(inputRuleSet);
  const rules = [...ruleSet.rules].sort(compareRules);
  const orderedDetections = [...detections].sort(compareDetections);
  const trace: Omit<RuleTraceEntry, "step">[] = [];
  const contributions: { ruleId: string; outcome: InspectionOutcome; severity: InspectionSeverity }[] = [{
    ruleId: "policy-default", outcome: ruleSet.defaultOutcome, severity: ruleSet.defaultSeverity,
  }];

  for (const rule of rules) {
    if (rule.type !== "unsupported") continue;
    trace.push({
      code: "UNSUPPORTED_RULE", ruleId: rule.id, ruleType: rule.sourceType, status: "triggered",
      outcome: "REVIEW", severity: rule.severity, detectionIds: [],
      message: `${rule.statement} requires review: ${rule.reason}`,
    });
    contributions.push({ ruleId: rule.id, outcome: "REVIEW", severity: rule.severity });
  }

  const confidenceRules = rules.filter((rule): rule is ConfidenceReviewRule => rule.type === "confidence-review");
  const actionable: Detection[] = [];
  const reviewIds: number[] = [];
  const excludedIds: number[] = [];

  for (const detection of orderedDetections) {
    if (detection.review === "dismissed") {
      excludedIds.push(detection.id);
      trace.push({ code: "REVIEWER_DISMISSED", ruleId: null, ruleType: "review-state", status: "excluded",
        outcome: "PASS", severity: "info", detectionIds: [detection.id],
        message: `Finding #${detection.id} (${detection.label}) was dismissed by the reviewer and excluded.` });
      continue;
    }
    if (detection.review === "accepted") {
      actionable.push(detection);
      trace.push({ code: "REVIEWER_CONFIRMED", ruleId: null, ruleType: "review-state", status: "context",
        outcome: "PASS", severity: "info", detectionIds: [detection.id],
        message: `Finding #${detection.id} (${detection.label}) was confirmed by the reviewer; confidence gating was bypassed.` });
      continue;
    }

    const matching = confidenceRules.filter(rule => appliesToClass(rule.classes, detection));
    const reviewing = matching.filter(rule => detection.confidence >= rule.ignoreBelow && detection.confidence < rule.reviewBelow);
    if (reviewing.length) {
      reviewIds.push(detection.id);
      for (const rule of reviewing) {
        trace.push({ code: "CONFIDENCE_REVIEW", ruleId: rule.id, ruleType: rule.type, status: "triggered",
          outcome: "REVIEW", severity: rule.severity, detectionIds: [detection.id],
          message: `Finding #${detection.id} (${detection.label}) at ${(detection.confidence * 100).toFixed(1)}% is inside the review band.`,
          facts: { confidence: Number(detection.confidence.toFixed(6)), ignoreBelow: rule.ignoreBelow, reviewBelow: rule.reviewBelow } });
        contributions.push({ ruleId: rule.id, outcome: "REVIEW", severity: rule.severity });
      }
      continue;
    }

    const ignoring = matching.filter(rule => detection.confidence < rule.ignoreBelow);
    const qualifying = matching.filter(rule => detection.confidence >= rule.reviewBelow);
    if (ignoring.length && qualifying.length) {
      reviewIds.push(detection.id);
      const conflictingRuleIds = [...ignoring, ...qualifying].map(rule => rule.id).sort();
      const conflictSeverity = maximumSeverity([...ignoring, ...qualifying].map(rule => rule.severity));
      trace.push({ code: "CONFIDENCE_RULE_CONFLICT", ruleId: conflictingRuleIds.join("+"),
        ruleType: "confidence-review", status: "triggered", outcome: "REVIEW", severity: conflictSeverity,
        detectionIds: [detection.id],
        message: `Confidence rules disagree on finding #${detection.id} (${detection.label}); human review is required.`,
        facts: { confidence: Number(detection.confidence.toFixed(6)), ruleIds: conflictingRuleIds } });
      contributions.push({ ruleId: conflictingRuleIds.join("+"), outcome: "REVIEW", severity: conflictSeverity });
      continue;
    }

    if (matching.length && ignoring.length === matching.length) {
      excludedIds.push(detection.id);
      trace.push({ code: "BELOW_EVIDENCE_FLOOR", ruleId: matching.map(rule => rule.id).sort().join("+"),
        ruleType: "confidence-review", status: "excluded", outcome: "PASS", severity: "info",
        detectionIds: [detection.id],
        message: `Finding #${detection.id} (${detection.label}) at ${(detection.confidence * 100).toFixed(1)}% is below the configured evidence floor.`,
        facts: { confidence: Number(detection.confidence.toFixed(6)), ruleIds: matching.map(rule => rule.id).sort() } });
      continue;
    }
    actionable.push(detection);
    if (matching.length) {
      trace.push({ code: "CONFIDENCE_ACTIONABLE", ruleId: qualifying.map(rule => rule.id).sort().join("+") || null,
        ruleType: "confidence-review", status: "context", outcome: "PASS", severity: "info",
        detectionIds: [detection.id],
        message: `Finding #${detection.id} (${detection.label}) at ${(detection.confidence * 100).toFixed(1)}% cleared the confidence gate.`,
        facts: { confidence: Number(detection.confidence.toFixed(6)), ruleIds: qualifying.map(rule => rule.id).sort() } });
    }
  }

  for (const rule of rules) {
    if (rule.type !== "defect-class") continue;
    const matches = actionable.filter(detection => rule.classes.includes(detection.label));
    if (matches.length) {
      const detectionIds = matches.map(detection => detection.id);
      trace.push({ code: "DEFECT_CLASS_MATCH", ruleId: rule.id, ruleType: rule.type, status: "triggered",
        outcome: rule.outcome, severity: rule.severity, detectionIds,
        message: `${matches.length} actionable finding${matches.length === 1 ? "" : "s"} matched ${rule.description}`,
        facts: { classes: rule.classes, matchedCount: matches.length } });
      contributions.push({ ruleId: rule.id, outcome: rule.outcome, severity: rule.severity });
    } else {
      trace.push({ code: "DEFECT_CLASS_CLEAR", ruleId: rule.id, ruleType: rule.type, status: "not-triggered",
        outcome: "PASS", severity: "none", detectionIds: [], message: `No actionable findings matched ${rule.description}`,
        facts: { classes: rule.classes, matchedCount: 0 } });
    }
  }

  for (const rule of rules) {
    if (rule.type !== "maximum-defect-count") continue;
    const matches = actionable.filter(detection => appliesToClass(rule.classes, detection));
    const detectionIds = matches.map(detection => detection.id);
    if (matches.length > rule.maximumAllowed) {
      trace.push({ code: "MAXIMUM_COUNT_EXCEEDED", ruleId: rule.id, ruleType: rule.type, status: "triggered",
        outcome: rule.outcome, severity: rule.severity, detectionIds,
        message: `${matches.length} actionable findings exceed the allowed maximum of ${rule.maximumAllowed}.`,
        facts: { observedCount: matches.length, maximumAllowed: rule.maximumAllowed, ...(rule.classes ? { classes: rule.classes } : {}) } });
      contributions.push({ ruleId: rule.id, outcome: rule.outcome, severity: rule.severity });
    } else {
      trace.push({ code: "MAXIMUM_COUNT_OK", ruleId: rule.id, ruleType: rule.type, status: "not-triggered",
        outcome: "PASS", severity: "none", detectionIds,
        message: `${matches.length} actionable findings are within the allowed maximum of ${rule.maximumAllowed}.`,
        facts: { observedCount: matches.length, maximumAllowed: rule.maximumAllowed, ...(rule.classes ? { classes: rule.classes } : {}) } });
    }
  }

  const outcome = contributions.reduce((selected, contribution) =>
    outcomeRank[contribution.outcome] > outcomeRank[selected] ? contribution.outcome : selected, "PASS" as InspectionOutcome);
  const decisiveContributions = contributions.filter(contribution => contribution.outcome === outcome);
  const severity = maximumSeverity(decisiveContributions.map(contribution => contribution.severity));
  const decisiveRuleIds = Array.from(new Set(decisiveContributions.map(contribution => contribution.ruleId))).sort();
  const decisiveWithoutDefault = decisiveRuleIds.filter(id => id !== "policy-default");
  const summary = outcome === "FAIL"
    ? `Inspection failed because ${decisiveWithoutDefault.length || 1} highest-precedence rule${(decisiveWithoutDefault.length || 1) === 1 ? "" : "s"} triggered.`
    : outcome === "REVIEW"
      ? `Human review is required by ${decisiveWithoutDefault.length || 1} rule${(decisiveWithoutDefault.length || 1) === 1 ? "" : "s"}.`
      : "Inspection passed because no fail or review rule triggered.";

  trace.push({ code: "FINAL_PRECEDENCE", ruleId: null, ruleType: "decision-precedence", status: "selected",
    outcome, severity, detectionIds: [], message: `${summary} Deterministic precedence is FAIL > REVIEW > PASS.`,
    facts: { candidateOutcomes: contributions.map(contribution => contribution.outcome), decisiveRuleIds } });

  return {
    schemaVersion: INSPECTION_RULE_SCHEMA_VERSION,
    policy: ruleSet,
    outcome,
    severity,
    summary,
    precedence: OUTCOME_PRECEDENCE,
    decisiveRuleIds,
    evidence: {
      inputDetections: orderedDetections.length,
      actionableDetectionIds: actionable.map(detection => detection.id),
      reviewDetectionIds: reviewIds,
      excludedDetectionIds: excludedIds,
    },
    trace: trace.map((entry, index) => ({ step: index + 1, ...entry })),
  };
}
