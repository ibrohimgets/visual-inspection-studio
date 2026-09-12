# YOLOX-Nano PCB validation baseline — 2026-09-12

## Protocol

- Dataset: DsPCBSD+ (CC BY 4.0), nine source-defined defect classes.
- Training: 7,357 `train` images and 14,563 boxes only.
- Threshold tuning: 851 `validation` images and 1,621 boxes only.
- Frozen test split: not accessed.
- Model: YOLOX-Nano at upstream commit
  `419778480ab6ec0590e5d3831b3afb3b46ab2aa3`.
- Initialization: official YOLOX-Nano checkpoint; 636 of 642 tensors matched.
  The six unmatched tensors are the task-specific classification heads.
- Input: 256 × 256; batch size 32; five epochs; seed 20260912; CPU only.
- Selection rule: maximize class-aware F1 at IoU 0.5 on validation; ties favor
  recall, then precision, then the lower confidence threshold.

## Training result

Training took 1,456.9 seconds (24.3 minutes). Mean total loss declined every
epoch from 6.449 to 4.077.

| Epoch | Total loss | IoU loss | Objectness loss | Class loss |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 6.449 | 2.582 | 2.459 | 1.408 |
| 2 | 5.242 | 2.369 | 1.809 | 1.064 |
| 3 | 4.716 | 2.224 | 1.570 | 0.923 |
| 4 | 4.311 | 2.105 | 1.377 | 0.829 |
| 5 | 4.077 | 2.047 | 1.253 | 0.776 |

## Validation result

The selected confidence threshold is **0.37**.

| Metric | Result |
| --- | ---: |
| Class-aware true positives | 1,073 |
| False positives | 463 |
| Missed defects | 548 |
| Precision | 69.86% |
| Recall | 66.19% |
| F1 | 67.98% |
| Ranked mAP@0.5 at 0.001 proposal floor | 69.41% |
| Class-agnostic localization precision | 74.61% |
| Class-agnostic localization recall | 70.70% |
| Correct class among localized proposals | 91.97% |

Per-class results at the selected threshold use class-aware IoU 0.5. AP@0.5
uses the full ranked proposal list at the 0.001 proposal floor.

| Class | TP | FP | FN | Precision | Recall | F1 | AP@0.5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SH | 65 | 25 | 24 | 72.22% | 73.03% | 72.63% | 72.65% |
| SP | 213 | 66 | 164 | 76.34% | 56.50% | 64.94% | 63.68% |
| SC | 70 | 46 | 35 | 60.34% | 66.67% | 63.35% | 69.43% |
| OP | 123 | 106 | 18 | 53.71% | 87.23% | 66.49% | 75.80% |
| MB | 87 | 13 | 98 | 87.00% | 47.03% | 61.05% | 58.85% |
| HB | 225 | 55 | 7 | 80.36% | 96.98% | 87.89% | 96.32% |
| CS | 125 | 69 | 86 | 64.43% | 59.24% | 61.73% | 63.52% |
| CFO | 58 | 27 | 96 | 68.24% | 37.66% | 48.54% | 45.42% |
| BMFO | 107 | 56 | 20 | 65.64% | 84.25% | 73.79% | 79.01% |

Full validation inference took 19.84 seconds wall-clock for 851 images: 23.32
ms/image, or 42.89 images/second, on the test machine. The recorded model
forward/post-processing mean was 9.79 ms/image; wall-clock throughput is the
more conservative deployment number because it includes input loading.

## Interpretation

This is a useful baseline, not a production-readiness claim. Localization is
better than final class-aware detection, so an uncertainty-aware verifier may
help ambiguous proposals. CFO and MB have the largest miss rates; OP has high
recall but too many false positives. Those measured failure modes should drive
hybrid routing rather than calling a VLM on every image.

The next milestone will define detector uncertainty bands on validation, call
Terra only inside the ambiguous band, and measure whether verification changes
precision, recall, review rate, latency, and API cost. The frozen test set must
remain sealed until that routing protocol is fixed.
