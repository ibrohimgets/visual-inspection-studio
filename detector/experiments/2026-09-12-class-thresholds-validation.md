# Class-specific threshold profile

This validation-only pass tests whether one confidence threshold per PCB defect
class gives a useful product operating profile without retraining the model.
The frozen test split was not accessed.

| Profile | Precision | Recall | F1 | Ranked mAP@0.5 |
| --- | ---: | ---: | ---: | ---: |
| Global threshold 0.37 | 69.86% | 66.19% | 67.98% | 69.41% |
| Class-specific thresholds | 76.97% | 64.53% | 70.20% | 69.41% |

The class-specific profile removes 150 false positives while losing 27 true
positives. Precision improves by 7.11 percentage points and F1 improves by 2.23
points; recall decreases by 1.67 points. Ranked mAP is unchanged because the
underlying prediction ranking is unchanged. The mAP of the routed output is
58.76%, compared with 60.58% at the global threshold.

This is useful as a **precision-first QA profile**, not as a universal
improvement. The product should let an operator choose the operating point
based on the cost of false alarms versus missed defects.

Hard-negative retraining is intentionally deferred. The threshold pass already
produced a meaningful operating profile, while the current product milestone
prioritizes batch inspection, review ergonomics, reporting, and detector
integration over open-ended model tuning.

Exact thresholds, counts, and provenance are stored in the adjacent JSON file.
