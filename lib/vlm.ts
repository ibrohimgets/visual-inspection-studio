/**
 * Provider-neutral contract for zero/few-shot visual inspection.
 *
 * This module does not call a model by itself and never fabricates findings.
 * A local or remote inference gateway must return the structured response
 * described here. Every parsed finding remains a human-review recommendation
 * until an uncertainty calibration phase has been measured.
 */

export const VLM_PROTOCOL_VERSION = 1 as const;
export const ZERO_SHOT_PROMPT_VERSION = "pcb-zero-shot-v1" as const;

export type VlmMode = "zero-shot" | "few-shot";
export type VlmImage = { mimeType: string; base64: string; width: number; height: number };
export type SupportExample = {
  id: string;
  label: string;
  description?: string;
  image?: VlmImage;
};
export type InspectionTask = {
  id: string;
  title: string;
  instructions: string;
  classes: Array<{ label: string; description: string }>;
};
export type VlmInspectionRequest = {
  image: VlmImage;
  task: InspectionTask;
  mode: VlmMode;
  supportExamples?: SupportExample[];
  promptVersion?: string;
};
export type Uncertainty = { level: "low" | "medium" | "high"; reasons: string[] };
export type VlmFinding = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  modelScore: number;
  scoreIsCalibrated: false;
  evidence: string;
  uncertainty: Uncertainty;
  decision: "review";
  source: "vlm";
};
export type VlmInspectionResult = {
  protocolVersion: 1;
  mode: VlmMode;
  model: string;
  promptVersion: string;
  status: "normal" | "suspected_defect" | "uncertain";
  summary: string;
  findings: VlmFinding[];
  latencyMs: number;
};

const MAX_FINDINGS = 100;
const MAX_EVIDENCE_LENGTH = 800;

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }

function clampText(value: unknown, field: string, maxLength: number, required = true) {
  if (typeof value !== "string") {
    if (!required) return "";
    throw new Error(`${field} must be a string.`);
  }
  const text = value.trim();
  if (required && !text) throw new Error(`${field} cannot be empty.`);
  if (text.length > maxLength) throw new Error(`${field} exceeds ${maxLength} characters.`);
  return text;
}

function numberField(record: Record<string, unknown>, key: string, field: string) {
  const value = record[key];
  if (!finite(value)) throw new Error(`${field} must be a finite number.`);
  return value;
}

function validateImage(image: VlmImage) {
  if (!image || typeof image.mimeType !== "string" || !image.mimeType.startsWith("image/")) throw new Error("VLM image mimeType must be an image type.");
  if (typeof image.base64 !== "string" || !image.base64) throw new Error("VLM image base64 data is required.");
  if (!finite(image.width) || !finite(image.height) || image.width <= 0 || image.height <= 0) throw new Error("VLM image dimensions must be positive finite numbers.");
}

export function validateInspectionRequest(request: VlmInspectionRequest) {
  validateImage(request.image);
  if (!request.task || !request.task.id || !Array.isArray(request.task.classes) || !request.task.classes.length) throw new Error("VLM task must include an id and at least one class.");
  if (!request.task.classes.every(item => item && item.label && item.description)) throw new Error("Every VLM task class needs a label and description.");
  const supportExamples = request.supportExamples || [];
  if (request.mode === "zero-shot" && supportExamples.length) throw new Error("Zero-shot requests cannot include support examples.");
  if (request.mode === "few-shot" && ![1, 3, 5].includes(supportExamples.length)) throw new Error("Few-shot requests must contain exactly 1, 3, or 5 support examples.");
  const labels = new Set(request.task.classes.map(item => item.label));
  for (const example of supportExamples) {
    if (!example.id || !labels.has(example.label)) throw new Error(`Support example ${example.id || "(missing id)"} uses an unsupported label.`);
    if (example.image) validateImage(example.image);
  }
  return request;
}

export function buildInspectionPrompt(request: VlmInspectionRequest): string {
  validateInspectionRequest(request);
  const classList = request.task.classes.map(item => `- ${item.label}: ${item.description}`).join("\n");
  const examples = request.mode === "few-shot"
    ? [`This is a ${request.supportExamples?.length}-shot run. Compare the query image against these approved support examples, but do not copy their coordinates:`, ...(request.supportExamples || []).map(example => `- ${example.id}: ${example.label}${example.description ? ` — ${example.description}` : ""}`)]
    : ["This is a zero-shot run: do not assume task-specific training and do not invent a defect."];
  return [
    `You are performing ${request.task.title} for an industrial visual-inspection study.`,
    request.task.instructions.trim(),
    ...examples,
    "Only use labels from the allowed list below.",
    "Inspect the full image, then identify only visually supported suspected defects.",
    "Use pixel coordinates relative to the original image. If you cannot localize a finding reliably, return no finding and set status to uncertain.",
    "modelScore is an uncalibrated model score, not a probability. Always explain uncertainty reasons.",
    "Every finding must remain a human-review recommendation; never return an automatic acceptance decision.",
    "Return JSON only, with this exact shape:",
    '{"status":"normal|suspected_defect|uncertain","summary":"short summary","findings":[{"label":"allowed label","box":{"x":0,"y":0,"width":0,"height":0},"modelScore":0.0,"evidence":"visible evidence","uncertainty":{"level":"low|medium|high","reasons":["reason"]}}]}',
    "Allowed labels:",
    classList,
  ].join("\n");
}

export function buildZeroShotPrompt(task: InspectionTask): string {
  return buildInspectionPrompt({ image: { mimeType: "image/jpeg", base64: "placeholder", width: 1, height: 1 }, task, mode: "zero-shot" });
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(trimmed); } catch { /* Try extracting one JSON object from a cautious wrapper. */ }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("VLM response did not contain valid JSON.");
  try { return JSON.parse(trimmed.slice(start, end + 1)); }
  catch { throw new Error("VLM response did not contain valid JSON."); }
}

function responseObject(payload: unknown): Record<string, unknown> {
  if (typeof payload === "string") return responseObject(parseJsonText(payload));
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("VLM response must be a JSON object.");
  const record = payload as Record<string, unknown>;
  if (typeof record.output === "string") return responseObject(record.output);
  if (record.result && typeof record.result === "object" && !Array.isArray(record.result)) return responseObject(record.result);
  return record;
}

export function parseVlmResponse(payload: unknown, request: VlmInspectionRequest, model: string, latencyMs: number): VlmInspectionResult {
  validateInspectionRequest(request);
  const object = responseObject(payload);
  const status = object.status;
  if (status !== "normal" && status !== "suspected_defect" && status !== "uncertain") throw new Error("VLM response status must be normal, suspected_defect, or uncertain.");
  if (!Array.isArray(object.findings)) throw new Error("VLM response findings must be an array.");
  if (object.findings.length > MAX_FINDINGS) throw new Error(`VLM response cannot contain more than ${MAX_FINDINGS} findings.`);
  const labels = new Set(request.task.classes.map(item => item.label));
  const findings = object.findings.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`VLM finding ${index} must be an object.`);
    const item = raw as Record<string, unknown>;
    const label = clampText(item.label, `VLM finding ${index}.label`, 120);
    if (!labels.has(label)) throw new Error(`VLM finding ${index} uses unsupported label ${label}.`);
    const box = item.box;
    if (!box || typeof box !== "object" || Array.isArray(box)) throw new Error(`VLM finding ${index}.box must be an object.`);
    const coordinates = box as Record<string, unknown>;
    const x = numberField(coordinates, "x", `VLM finding ${index}.box.x`); const y = numberField(coordinates, "y", `VLM finding ${index}.box.y`); const width = numberField(coordinates, "width", `VLM finding ${index}.box.width`); const height = numberField(coordinates, "height", `VLM finding ${index}.box.height`);
    if (width <= 0 || height <= 0 || x < 0 || y < 0 || x + width > request.image.width || y + height > request.image.height) throw new Error(`VLM finding ${index}.box must be finite and inside image bounds.`);
    const modelScore = item.modelScore;
    if (!finite(modelScore) || modelScore < 0 || modelScore > 1) throw new Error(`VLM finding ${index}.modelScore must be between 0 and 1.`);
    const rawUncertainty = item.uncertainty;
    const uncertainty = rawUncertainty && typeof rawUncertainty === "object" && !Array.isArray(rawUncertainty) ? rawUncertainty as Record<string, unknown> : null;
    const level = uncertainty?.level;
    const reasons = uncertainty?.reasons;
    if (level !== "low" && level !== "medium" && level !== "high") throw new Error(`VLM finding ${index}.uncertainty.level is invalid.`);
    if (!Array.isArray(reasons) || !reasons.length || !reasons.every(reason => typeof reason === "string" && reason.trim())) throw new Error(`VLM finding ${index}.uncertainty.reasons must be non-empty strings.`);
    return {
      id: `vlm-${index + 1}`,
      label, x, y, width, height, modelScore, scoreIsCalibrated: false as const,
      evidence: clampText(item.evidence, `VLM finding ${index}.evidence`, MAX_EVIDENCE_LENGTH),
      uncertainty: { level: level as Uncertainty["level"], reasons: reasons.slice(0, 8).map(reason => clampText(reason, "uncertainty reason", 240)) },
      decision: "review" as const, source: "vlm" as const,
    };
  });
  const promptVersion = request.promptVersion || ZERO_SHOT_PROMPT_VERSION;
  return { protocolVersion: VLM_PROTOCOL_VERSION, mode: request.mode, model, promptVersion, status, summary: clampText(object.summary, "VLM response summary", 1000, false), findings, latencyMs: Math.max(0, Math.round(latencyMs)) };
}

export type HttpVlmAdapterConfig = { endpoint: string; model: string; timeoutMs?: number; fetchImpl?: typeof fetch };

export function createHttpVlmAdapter(config: HttpVlmAdapterConfig) {
  if (!config.endpoint || !/^https?:\/\//.test(config.endpoint)) throw new Error("VLM adapter endpoint must be an http(s) URL.");
  if (!config.model) throw new Error("VLM adapter model is required.");
  const fetchImpl = config.fetchImpl || fetch;
  return {
    async inspect(request: VlmInspectionRequest): Promise<VlmInspectionResult> {
      validateInspectionRequest(request);
      const promptVersion = request.promptVersion || (request.mode === "zero-shot" ? ZERO_SHOT_PROMPT_VERSION : "pcb-few-shot-v1");
      const started = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 120_000);
      try {
        const response = await fetchImpl(config.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ protocolVersion: VLM_PROTOCOL_VERSION, model: config.model, promptVersion, prompt: buildInspectionPrompt({ ...request, promptVersion }), request }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`VLM adapter returned HTTP ${response.status}.`);
        const payload = await response.json();
        return parseVlmResponse(payload, { ...request, promptVersion }, config.model, Date.now() - started);
      } catch (cause) {
        if (cause instanceof Error && cause.name === "AbortError") throw new Error("VLM inspection timed out.");
        throw cause instanceof Error ? cause : new Error("VLM inspection failed.");
      } finally { clearTimeout(timeout); }
    },
  };
}
