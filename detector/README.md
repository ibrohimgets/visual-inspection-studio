# Specialized PCB detector

This directory contains the reproducible, detector-first baseline for the
DsPCBSD+ experiment. It fine-tunes YOLOX-Nano on the manifest's `train` split,
runs proposals on `validation`, and chooses an operating threshold using only
validation metrics. The frozen `test` split is intentionally unavailable from
the prediction CLI.

## Reproducibility and licenses

- Model: YOLOX-Nano, pinned to upstream commit
  `419778480ab6ec0590e5d3831b3afb3b46ab2aa3` (Apache-2.0).
- Initial checkpoint: official YOLOX-Nano weights, verified as SHA-256
  `cd28f55fbbc1829f99d9ac9b38a16d259a22889739c8728ea877610201feff7b`.
- Data: DsPCBSD+ (CC BY 4.0); raw data stays in `reports/local/datasets/`.
- Generated checkpoints, predictions, and reports stay in `reports/local/`
  and are excluded from Git.

The training script checks both the YOLOX commit and initial-weight digest.
The prediction script checks the upstream commit and rejects any checkpoint
that does not declare `training_split: train`.

## Environment used

The first baseline was trained on an Intel Core i7-1280P with CPU-only PyTorch:

```text
Python 3.12
torch 2.5.1+cpu
torchvision 0.20.1+cpu
opencv-python 4.10.0
numpy 1.26.4
loguru 0.7.3
```

The external YOLOX checkout is deliberately not vendored. Prepare the ignored
local dependency and official checkpoint before training:

```bash
git clone https://github.com/Megvii-BaseDetection/YOLOX reports/local/external/YOLOX
git -C reports/local/external/YOLOX checkout 419778480ab6ec0590e5d3831b3afb3b46ab2aa3
```

Place the official `yolox_nano.pth` at
`reports/local/detector/yolox_nano.pth`; the training script refuses a file
whose checksum does not match.

## Train and validate

```bash
python detector/train_yolox_cpu.py --epochs 5 --batch-size 32 \
  --image-size 256 --output reports/local/detector/yolox-nano-pcb

python detector/predict_yolox_cpu.py --split validation --batch-size 32 \
  --confidence .001 --nms .65 \
  --output reports/local/detector/yolox-nano-pcb/validation-predictions.json

npm run detector:tune
```

Threshold selection maximizes class-aware F1 at IoU 0.5, with deterministic
ties favoring recall, then precision, then the lower threshold. Ranked mAP@0.5
is calculated at the recorded proposal floor independently of the chosen
operating threshold. This is not COCO mAP@[.5:.95].

The measured first run is recorded in
[`experiments/2026-09-12-yolox-nano-validation.md`](experiments/2026-09-12-yolox-nano-validation.md).
No Terra calls or test-set predictions are part of that milestone.

The next validation-only milestone routes detector scores from 0.29 through
0.5999 to batched Terra crop verification. Its full protocol and negative
result are recorded in
[`experiments/2026-09-12-hybrid-validation.md`](experiments/2026-09-12-hybrid-validation.md):
Terra did not improve the automatic detector, while reliable human routing
would still send nearly every ambiguous proposal to review. The frozen test
split remains untouched.
