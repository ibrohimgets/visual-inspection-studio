# Isolated YOLOv8n validation experiment

This directory is intentionally separate from the deployed browser detector.
It prepares the existing frozen DsPCBSD+ manifest for Ultralytics YOLO format,
trains YOLOv8n on `train`, and predicts only `validation` for comparison with
the preserved YOLOX-Nano baseline.

Ultralytics 8.3.39 is pinned for experiment reproducibility. Ultralytics code
and its trained model artifacts are subject to Ultralytics' AGPL-3.0 or
Enterprise licensing terms. Generated datasets, downloaded upstream weights,
checkpoints, and predictions remain under `reports/local/`, are ignored by
Git, and are not loaded or distributed by the hosted application.

The scripts reject the frozen `test` split. A deployment decision must not be
made from this validation experiment alone.

The first five-epoch, 256 px CPU run reached 65.03% precision, 55.52% recall,
59.90% F1, and 62.15% mAP@0.5 in the project's shared evaluator. It averaged
14.33 ms/image wall time and produced a 5.91 MiB checkpoint. This did not beat
the preserved YOLOX quality baseline, so YOLOv8n remains isolated. See the
[tracked comparison](../experiments/2026-09-12-yolox-vs-yolov8n-validation.md)
for the exact protocol and interpretation limits.

```powershell
python detector/yolov8/prepare_dataset.py
python detector/yolov8/train.py --epochs 5 --batch-size 32 --image-size 256
python detector/yolov8/predict.py --training-report reports/local/detector/yolov8n-pcb/runs/yolov8n-256-e5-s20260912/training-report.json
node scripts/tune-detector.mjs --predictions reports/local/detector/yolov8n-pcb/validation-predictions.json --output reports/local/detector/yolov8n-pcb/validation-thresholds.json
```
