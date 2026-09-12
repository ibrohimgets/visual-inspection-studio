# Zero-shot VLM adapter

The first VLM milestone is a provider-neutral HTTP contract in
`lib/vlm.ts`. It does not call a hosted model and does not create demo
predictions. A local inference gateway must implement the contract before the
browser workflow can display VLM findings.

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

## Privacy boundary

The adapter accepts an explicit endpoint. The next implementation milestone
will use a local open-model gateway so industrial images do not leave the
operator's machine by default. A hosted provider can be added later behind the
same interface with explicit user configuration and separate cost/privacy
documentation.
