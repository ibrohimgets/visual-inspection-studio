# Zero-shot VLM adapter

The first VLM milestone is a provider-neutral HTTP contract in
`lib/vlm.ts`. Gateways implement that contract without exposing provider
credentials to the browser. The repository includes a local open-model gateway
and an optional hosted OpenAI gateway; neither creates demo predictions.

## Request contract

`createHttpVlmAdapter` sends a JSON request containing:

- `protocolVersion`
- `model`
- `promptVersion`
- a deterministic inspection prompt
- the image as base64 plus original dimensions
- `mode: "zero-shot"` or `"few-shot"`
- zero, one, three, or five approved support examples

Zero-shot requests reject support examples. Few-shot requests accept exactly
1, 3, or 5 examples so the experiment cannot accidentally mix protocols.

## Response contract

The gateway must return JSON with:

```json
{
  "status": "normal|suspected_defect|uncertain",
  "summary": "short summary",
  "findings": [
    {
      "label": "CS",
      "box": {"x": 10, "y": 20, "width": 40, "height": 12},
      "modelScore": 0.72,
      "evidence": "visible evidence",
      "uncertainty": {
        "level": "medium",
        "reasons": ["The mark is low contrast."]
      }
    }
  ]
}
```

The adapter rejects unknown labels, invalid JSON, out-of-bounds boxes,
non-finite values, unsupported confidence ranges, and missing uncertainty
reasons. It marks every parsed finding as `decision: "review"` and
`scoreIsCalibrated: false`. No model-provided number is treated as a calibrated
probability until the evaluation harness measures calibration.

## Local open-model gateway

The first local provider is [SmolVLM-256M-Instruct](https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct), released under Apache 2.0. It is a small general-purpose image+text model, not a PCB-defect model; its output must therefore be treated as an experiment and may be rejected by the strict adapter.

Install the Python dependencies from `vlm/requirements-local.txt`, then start
the loopback-only gateway (the model is downloaded by Transformers on first
use):

```powershell
python vlm/local_gateway.py --model HuggingFaceTB/SmolVLM-256M-Instruct --port 8008
```

Run a deterministic six-image probe from the non-test validation split:

```powershell
node scripts/run-vlm-validation.mjs `
  --endpoint http://127.0.0.1:8008/inspect `
  --model HuggingFaceTB/SmolVLM-256M-Instruct `
  --limit 6
```

The runner records raw model text, strict-parser failures, boxes, latency, and
the shared evaluation report under `reports/local/` (ignored by Git). It does
not run the frozen test split automatically. A model must first produce valid
structured responses on this probe; malformed JSON, unsupported labels,
out-of-bounds boxes, and missing uncertainty reasons remain explicit failure
cases rather than being repaired into predictions.

The first recorded result is in
[`experiments/2026-09-12-smolvlm-256m-validation.md`](experiments/2026-09-12-smolvlm-256m-validation.md).
That probe failed the structured-output gate, so the frozen test split was
intentionally not run.

## Optional GPT-5.6 Terra gateway

`openai_gateway.py` maps the same provider-neutral contract to the OpenAI
Responses API using strict structured outputs. It binds to loopback by default
and reads the API key only from `OPENAI_API_KEY`; never place a key in source
code, `.env` files, browser JavaScript, requests to `/inspect`, or committed
reports.

Set a Windows user-level environment variable, restart the terminal or app that
will launch the gateway, and then run:

```powershell
python vlm/openai_gateway.py `
  --model gpt-5.6-terra `
  --reasoning-effort low `
  --port 8010
```

Run the same deterministic validation probe:

```powershell
node scripts/run-vlm-validation.mjs `
  --endpoint http://127.0.0.1:8010/inspect `
  --model gpt-5.6-terra `
  --limit 6 `
  --output reports/local/gpt-5.6-terra-zero-shot-validation-subset.json
```

Images sent through this gateway leave the local machine and are processed by
the hosted API. The gateway sets `store: false`, records request provenance and
token usage (never the API key), and keeps local reports under the Git-ignored
`reports/local/` directory. Review your organization's OpenAI data controls and
cost requirements before using proprietary inspection images.

The first Terra probe is recorded in
[`experiments/2026-09-12-gpt-5.6-terra-validation.md`](experiments/2026-09-12-gpt-5.6-terra-validation.md).
It passed the response-structure gate but did not pass the localization and
class gate, so the frozen test split was intentionally not run.

## Privacy boundary

The adapter accepts an explicit endpoint and both included gateways bind to
loopback. Images stay on the operator's machine only when using the local
open-model gateway. The optional OpenAI gateway sends images to a hosted API;
that boundary is explicit and should be presented to operators before use.
