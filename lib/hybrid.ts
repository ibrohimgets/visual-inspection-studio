export type ThresholdPoint = {
  confidenceThreshold: number;
  precision: number;
  recall: number;
};

export type ConfidenceBands = {
  rejectBelow: number;
  trustAtOrAbove: number;
  minimumRecallTarget: number;
  minimumPrecisionTarget: number;
};

export type TerraProposalDecision = {
  candidateId: string;
  verdict: "confirm" | "relabel" | "reject" | "uncertain";
  label: string;
  modelScore: number;
  evidence: string;
  uncertainty: { level: "low" | "medium" | "high"; reasons: string[] };
};

export function deriveConfidenceBands(
  curve: ThresholdPoint[],
  options = { minimumRecallTarget: .7, minimumPrecisionTarget: .85 },
): ConfidenceBands {
  const rows = curve
    .filter(row => [row.confidenceThreshold, row.precision, row.recall].every(Number.isFinite))
    .sort((a, b) => a.confidenceThreshold - b.confidenceThreshold);
  if (!rows.length) throw new Error("A non-empty validation threshold curve is required.");
  const lower = rows.filter(row => row.recall >= options.minimumRecallTarget).at(-1);
  if (!lower) throw new Error(`No threshold preserves recall >= ${options.minimumRecallTarget}.`);
  const upper = rows.find(row => row.confidenceThreshold > lower.confidenceThreshold && row.precision >= options.minimumPrecisionTarget);
  if (!upper) throw new Error(`No threshold above the lower band reaches precision >= ${options.minimumPrecisionTarget}.`);
  return {
    rejectBelow: lower.confidenceThreshold,
    trustAtOrAbove: upper.confidenceThreshold,
    minimumRecallTarget: options.minimumRecallTarget,
    minimumPrecisionTarget: options.minimumPrecisionTarget,
  };
}

export function validateTerraDecisions(value: unknown, candidateIds: string[], labels: string[]): TerraProposalDecision[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Terra verification output must be an object.");
  const decisions = (value as { decisions?: unknown }).decisions;
  if (!Array.isArray(decisions)) throw new Error("Terra verification output needs a decisions array.");
  const expected = new Set(candidateIds);
  const allowedLabels = new Set(labels);
  const seen = new Set<string>();
  const parsed = decisions.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Terra decision ${index} must be an object.`);
    const item = raw as Record<string, unknown>;
    const candidateId = item.candidateId;
    const verdict = item.verdict;
    const label = item.label;
    const modelScore = item.modelScore;
    const evidence = item.evidence;
    const uncertainty = item.uncertainty;
    if (typeof candidateId !== "string" || !expected.has(candidateId) || seen.has(candidateId)) throw new Error(`Terra decision ${index} has an unknown or duplicate candidateId.`);
    if (verdict !== "confirm" && verdict !== "relabel" && verdict !== "reject" && verdict !== "uncertain") throw new Error(`Terra decision ${index} has an invalid verdict.`);
    if (typeof label !== "string" || !allowedLabels.has(label)) throw new Error(`Terra decision ${index} has an invalid label.`);
    if (typeof modelScore !== "number" || !Number.isFinite(modelScore) || modelScore < 0 || modelScore > 1) throw new Error(`Terra decision ${index} has an invalid modelScore.`);
    if (typeof evidence !== "string" || !evidence.trim() || evidence.length > 800) throw new Error(`Terra decision ${index} needs concise evidence.`);
    if (!uncertainty || typeof uncertainty !== "object" || Array.isArray(uncertainty)) throw new Error(`Terra decision ${index} needs uncertainty.`);
    const level = (uncertainty as Record<string, unknown>).level;
    const reasons = (uncertainty as Record<string, unknown>).reasons;
    if (level !== "low" && level !== "medium" && level !== "high") throw new Error(`Terra decision ${index} has invalid uncertainty.`);
    if (!Array.isArray(reasons) || !reasons.length || !reasons.every(reason => typeof reason === "string" && reason.trim())) throw new Error(`Terra decision ${index} needs uncertainty reasons.`);
    seen.add(candidateId);
    return { candidateId, verdict, label, modelScore, evidence: evidence.trim(), uncertainty: { level, reasons: reasons.slice(0, 8).map(String) } } as TerraProposalDecision;
  });
  if (seen.size !== expected.size) throw new Error(`Terra returned ${seen.size} decisions for ${expected.size} candidates.`);
  return parsed;
}

export function isActionableTerraDecision(decision: TerraProposalDecision, scoreThreshold: number) {
  return decision.verdict !== "uncertain" && decision.uncertainty.level === "low" && decision.modelScore >= scoreThreshold;
}
