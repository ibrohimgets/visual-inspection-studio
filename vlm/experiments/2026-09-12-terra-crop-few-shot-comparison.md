# Terra crop verification and few-shot comparison

This is a six-image validation capability probe, not a full benchmark, an
accuracy claim, or evidence of industrial readiness.

## Protocol

- Dataset: DsPCBSD+, deterministic `validation` subset only
- Query images: the same 6 images in every condition, containing 13 ground-truth
  boxes
- Model: `gpt-5.6-terra`, reasoning effort `low`, structured output
- IoU threshold: 0.5
- Support policy: nested sets of 1, 3, or 5 annotated **support images**, selected
  deterministically from the training split by new class coverage
- Leakage controls: support images must be `train`; query images must be
  `validation`; overlapping IDs fail the run
- Crop policy: pad each full-image proposal, enlarge to fit within 512×512,
  verify independently, then map a supported crop box back to original pixels
- API storage: `store: false`
- Test split: **not run**

"Shot" refers to support-image count, not examples per class. The first support
image contains five annotated defect classes; the first three together cover
all nine dataset classes. This definition is recorded to prevent overstating
the amount of supervision.

## Measured result

| Condition | Calls | Predictions | Class TP | FP | Missed | Localized at IoU 0.5 | Correct class among localized | Mean latency | p95 latency | Estimated cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Zero-shot | 6 | 4 | 1 | 3 | 12 | 3/13 | 1/3 | 8,379 ms | 19,688 ms | $0.04674 |
| Crop verification | 11 | 1 | 0 | 1 | 13 | 0/13 | 0/0 | 14,243 ms | 37,358 ms | $0.06187 |
| 1 support image | 6 | 5 | 2 | 3 | 11 | 2/13 | 2/2 | 8,722 ms | 15,771 ms | $0.03874 |
| 3 support images | 6 | 5 | 1 | 4 | 12 | 3/13 | 1/3 | 8,590 ms | 18,557 ms | $0.04261 |
| 5 support images | 6 | 5 | 2 | 3 | 11 | 3/13 | 2/3 | 6,574 ms | 9,519 ms | $0.03193 |

The final comparison run used 35 successful API calls and had an estimated
combined cost of $0.22189. Cost uses the response usage fields and the official
rates checked on 2026-09-12: $2.00 per million input tokens, $0.20 per million
cached input tokens, and $12.00 per million output tokens. Lower cost for five
support images is explained by prompt caching plus fewer output tokens; it does
not mean larger prompts are inherently cheaper.

## Interpretation

- Crop verification was too conservative. It removed four plausible proposals
  and retained one wrong-class/poor-overlap proposal, increasing latency and
  cost while reducing recall.
- One and five support images improved fine-grained classification on a few
  localized defects, but both still missed 11 of 13 ground-truth defects.
- Three support images covered all nine classes but did not outperform one
  support image. More visual context did not produce monotonic improvement.
- The same zero-shot inputs varied across repeated probes, and p95 latency was
  several times the fastest response. Repeatability must be measured before any
  production routing decision.
- Model scores remain uncalibrated. Every surviving prediction remains a human
  review recommendation.

The evidence does not support more prompt-only optimization as the primary
detector. The next experiment should train a specialized detector on the frozen
training split, tune only on validation, and route its uncertain proposals to
Terra for crop-level reasoning and then human review. The test split must remain
sealed until that hybrid protocol and thresholds are frozen.
