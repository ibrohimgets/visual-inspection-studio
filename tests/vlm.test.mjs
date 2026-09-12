import test from "node:test";
import assert from "node:assert/strict";
import { buildInspectionPrompt, buildZeroShotPrompt, createHttpVlmAdapter, parseVlmResponse, validateInspectionRequest, VlmAdapterError } from "../lib/vlm.ts";

const task = {
  id: "dspcbsd-plus",
  title: "PCB surface-defect inspection",
  instructions: "Look for visible PCB surface defects.",
  classes: [{ label: "CS", description: "Conductor scratch" }, { label: "SP", description: "Spur" }],
};
const request = { image: { mimeType: "image/jpeg", base64: "ZmFrZQ==", width: 226, height: 226 }, task, mode: "zero-shot" };

const validResponse = {
  status: "suspected_defect",
  summary: "A linear mark is visible on the conductor.",
  findings: [{
    label: "CS", box: { x: 10, y: 20, width: 40, height: 12 }, modelScore: .72,
    evidence: "A narrow irregular line interrupts the conductor surface.",
    uncertainty: { level: "medium", reasons: ["The mark is low contrast."] },
  }],
};

test("zero-shot prompt requires structured, localized, non-calibrated output", () => {
  const prompt = buildZeroShotPrompt(task);
  assert.match(prompt, /zero-shot/);
  assert.match(prompt, /JSON only/);
  assert.match(prompt, /modelScore is an uncalibrated model score/);
  assert.match(prompt, /CS: Conductor scratch/);
});

test("request validation enforces zero-shot and few-shot counts", () => {
  assert.doesNotThrow(() => validateInspectionRequest(request));
  assert.throws(() => validateInspectionRequest({ ...request, supportExamples: [{ id: "one", label: "CS" }] }), /Zero-shot/);
  assert.throws(() => validateInspectionRequest({ ...request, mode: "few-shot", supportExamples: [] }), /exactly 1, 3, or 5/);
  assert.doesNotThrow(() => validateInspectionRequest({ ...request, mode: "few-shot", supportExamples: [{ id: "one", label: "CS" }] }));
  assert.match(buildInspectionPrompt({ ...request, mode: "few-shot", supportExamples: [{ id: "one", label: "CS", description: "approved scratch example" }] }), /one: CS/);
});

test("response parsing normalizes findings and always defers to review", () => {
  const result = parseVlmResponse(validResponse, request, "local-test-vlm", 42);
  assert.equal(result.protocolVersion, 1);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].decision, "review");
  assert.equal(result.findings[0].scoreIsCalibrated, false);
  assert.equal(result.findings[0].source, "vlm");
  assert.equal(result.latencyMs, 42);
});

test("response parser accepts a fenced JSON string but rejects unsafe outputs", () => {
  const result = parseVlmResponse("```json\n" + JSON.stringify(validResponse) + "\n```", request, "local-test-vlm", 1);
  assert.equal(result.findings[0].label, "CS");
  assert.throws(() => parseVlmResponse({ ...validResponse, findings: [{ ...validResponse.findings[0], label: "rust" }] }, request, "local-test-vlm", 1), /unsupported label/);
  assert.throws(() => parseVlmResponse({ ...validResponse, findings: [{ ...validResponse.findings[0], box: { x: 220, y: 220, width: 20, height: 20 } }] }, request, "local-test-vlm", 1), /inside image bounds/);
  assert.throws(() => parseVlmResponse({ ...validResponse, findings: [{ ...validResponse.findings[0], uncertainty: { level: "low", reasons: [] } }] }, request, "local-test-vlm", 1), /reasons/);
});

test("HTTP adapter sends the protocol and parses the provider response", async () => {
  let sent;
  const adapter = createHttpVlmAdapter({
    endpoint: "http://127.0.0.1:8000/inspect",
    model: "local-test-vlm",
    fetchImpl: async (_url, options) => {
      sent = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => validResponse };
    },
  });
  const result = await adapter.inspect(request);
  assert.equal(sent.protocolVersion, 1);
  assert.equal(sent.model, "local-test-vlm");
  assert.equal(sent.request.mode, "zero-shot");
  assert.equal(result.model, "local-test-vlm");
});

test("HTTP adapter preserves malformed local-model output for failure analysis", async () => {
  const adapter = createHttpVlmAdapter({
    endpoint: "http://127.0.0.1:8000/inspect",
    model: "local-test-vlm",
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ output: "not-json" }) }),
  });
  await assert.rejects(() => adapter.inspect(request), error => {
    assert.ok(error instanceof VlmAdapterError);
    assert.equal(error.rawOutput, "not-json");
    assert.ok(Number.isFinite(error.latencyMs));
    return true;
  });
});
