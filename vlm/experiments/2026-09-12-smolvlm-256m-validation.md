# SmolVLM-256M zero-shot validation probe

This is a recorded capability probe, not a full benchmark and not an
accuracy claim.

- Dataset: DsPCBSD+, deterministic `validation` split only
- Subset: 6 images selected one-per-class where available
- Model: `HuggingFaceTB/SmolVLM-256M-Instruct` (Apache 2.0)
- Host: Windows CPU-only PyTorch runtime
- Adapter: `pcb-zero-shot-v1`, strict JSON/label/box/uncertainty validation
- Test split: **not run**

Observed result from the local run:

- 6/6 requests failed strict response validation
- 0 structured predictions were admitted to evaluation
- Failure modes included schema imitation/repetition, natural-language output,
  and unsupported status values
- Inference latency: mean 32,453 ms; p50 31,174 ms; p95 36,443 ms; range
  27,613–36,443 ms
- Because no predictions were admitted, localization and accuracy are
  unmeasured. The shared evaluator reports zero admitted predictions and does
  not turn malformed model text into boxes.

The next experiment should use a stronger or constrained local VLM and repeat
this validation gate. Do not run the frozen test split until the model produces
valid structured responses on this probe.
