# YOLOX-Nano vs isolated YOLOv8n — validation comparison

## Protocol

- Dataset: DsPCBSD+ (CC BY 4.0).
- Training: 7,357 train images and 14,563 boxes only.
- Threshold selection: 851 validation images and 1,621 boxes only.
- Input: 256 × 256; five epochs per detector.
- Metrics: Micro class-aware P/R/F1 and 101-point class mean AP at IoU 0.5.
- Frozen test split: **not accessed**.
- Deployment: YOLOX remains the only deployed browser backend; YOLOv8n remains an isolated licensing experiment.

## Results

| Detector | Precision | Recall | F1 | mAP@0.5 | Wall latency | Throughput | Parameters | Checkpoint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| YOLOX-Nano | 69.86% | 66.19% | 67.98% | 69.41% | 23.32 ms/image | 42.89 img/s | 898,314 | 7.22 MiB |
| YOLOv8n | 65.03% | 55.52% | 59.90% | 62.15% | 14.33 ms/image | 69.80 img/s | 3,007,403 | 5.91 MiB |

Candidate minus baseline: precision -4.83 pp, recall -10.67 pp, F1 -8.08 pp, and mAP@0.5 -7.26 pp. Latency changes by -8.99 ms/image and checkpoint size by -1.30 MiB.

## Interpretation limits

This is a validation-only engineering comparison, not a frozen-test or production claim. Both pipelines use the exact same split, input resolution, epoch count, and evaluator, but retain framework-native training behavior; the result compares the complete reproducible detector pipelines rather than isolating architecture alone. The YOLOv8 checkpoint remains outside the deployed application.
