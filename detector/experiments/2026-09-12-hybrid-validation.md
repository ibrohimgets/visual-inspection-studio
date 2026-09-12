# Detector-first hybrid validation — 2026-09-12

This experiment asks whether selective GPT-5.6 Terra crop verification improves
the trained YOLOX-Nano PCB detector. It uses the full DsPCBSD+ validation split,
not the frozen test split.

## Fixed protocol

- Detector: the five-epoch YOLOX-Nano PCB checkpoint trained only on `train`.
- Evaluation: 851 validation images, 1,621 boxes, class-aware IoU 0.5.
- Detector-only threshold: 0.37, previously selected by validation F1.
- Lower band boundary: 0.29, the highest threshold retaining at least 70%
  validation recall (70.02% measured at the boundary).
- Upper band boundary: 0.60, the lowest higher threshold reaching at least 85%
  validation precision (85.38% measured at the boundary).
- Routing: scores below 0.29 are rejected; scores from 0.29 through 0.5999 are
  ambiguous; scores of 0.60 or more are trusted detector proposals.
- Terra input: only the 839 ambiguous proposal crops, grouped into contact
  sheets of at most eight. No full PCB or test image was sent.
- Terra action: only a non-uncertain, low-uncertainty structured verdict can
  act automatically. The validation action-score grid was extended through
  1.00 after the first optimum landed at the initial 0.80 boundary.
- API storage: `store: false`.

## Validation comparison

`Routed mAP@0.5` is 101-point class mean AP at IoU 0.5 on the final routed
predictions. It is not COCO mAP@[.5:.95].

| System | TP | FP | Missed | Precision | Recall | F1 | Routed mAP@0.5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Detector only | 1,073 | 463 | 548 | 69.86% | 66.19% | 67.98% | 60.58% |
| Detector + Terra | 1,073 | 463 | 548 | 69.86% | 66.19% | 67.98% | 60.58% |
| Detector + Terra + review queue, before review | 795 | 138 | 826 | 85.21% | 49.04% | 62.26% | 47.48% |
| Perfect validation-oracle reviewer ceiling | 1,186 | 138 | 435 | 89.58% | 73.16% | 80.54% | 69.74% |

The selected Terra action threshold is 0.95. At that safety level, only three
ambiguous decisions act automatically and detector + Terra becomes identical
to detector-only. Lower Terra thresholds were worse. For example, thresholds
0.50–0.70 produced 1,069 TP and 522 FP, versus 1,073 TP and 463 FP for the
detector alone. The verifier therefore provided no measured automatic gain.

The final review router withholds 836 of 839 ambiguous proposals, spanning 419
of 851 validation images (49.24%). Its 85.21% automatic precision is useful,
but the 99.64% ambiguity-band review rate is too high to claim workload
reduction. The oracle row uses validation ground truth to simulate a perfect
reviewer. It is an upper bound and must not be presented as human-tested
accuracy.

## Terra behavior, latency, and cost

Terra returned 669 `confirm`, 85 `relabel`, 55 `reject`, and 30 `uncertain`
verdicts. It confirmed 79.7% of ambiguous proposals, which explains why lower
action thresholds retained or added false positives rather than filtering
them reliably.

- 105 successful API calls covered all 839 ambiguous proposals.
- One additional response exceeded its initial output budget and lacked usage
  metadata; it was retried successfully with a larger budget.
- Successful calls used 118,912 input tokens, 3,392 cached input tokens, and
  127,728 output tokens.
- Measured successful-call cost was $1.76445. Including a conservative upper
  bound for the unmetered failed call gives an estimated experiment range of
  $1.76445–$1.79553.
- Successful Terra batches took 14.80 seconds on average; p95 was 22.57
  seconds, with a 6.23–29.85 second range.
- Sequential detector plus successful Terra time was 1,574.2 seconds, or 1.85
  seconds per validation image when amortized across the full set. Human-review
  time is not included.

## Conclusion

The trained detector remains the best fully automatic system in this protocol.
Terra crop verification adds latency and cost without improving precision,
recall, F1, or routed mAP. Human review still has clear potential, but the
current Terra gate does not reduce its workload enough.

The next experiment should not send a VLM more of the same crops. Better
options are class-specific detector thresholds, probability calibration,
hard-negative mining, a second detector/anomaly model, or an active-learning
queue that sends only the smallest high-value subset to people. The frozen test
split must stay sealed until one validation strategy clearly improves the
detector baseline.

The prior VLM-only six-image capability results remain available in
[`../../vlm/experiments/2026-09-12-terra-crop-few-shot-comparison.md`](../../vlm/experiments/2026-09-12-terra-crop-few-shot-comparison.md),
but they are not directly comparable to this full-validation run.
