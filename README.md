# Visual Inspection Studio

Visual Inspection Studio is a browser-local review console for computer-vision
results. It keeps the product work that matters after inference: confidence
controls, human decisions, notes, audit-friendly exports, and measured run
timing.

[Open the private demo](https://visual-inspection-studio.iibrohimm.chatgpt.site)

![Synthetic metal inspection sample](public/synthetic-metal-inspection.png)

## Current release: real local YOLOX inference

The **General Object Detection** workflow runs the official YOLOX-Nano ONNX
model in a Web Worker with ONNX Runtime Web. The model is pinned by SHA-256 in
`lib/detection.ts`, and the browser verifies the downloaded bytes before
inference. No image is uploaded to an API.

It can recognize the 80 COCO object categories, such as people, vehicles,
animals, bottles, furniture, and electronics. It is a general-purpose object
detector; it does **not** recognize scratches, dents, cracks, rust, or other
manufacturing defects. The product deliberately says that limitation instead
of presenting generic object predictions as industrial findings.

The review workflow supports:

- PNG, JPEG, and WebP upload or drag-and-drop (20 MB / 40 megapixel guardrails)
- confidence threshold, class, and review-status filters
- image and table selection with original-image-pixel coordinates
- accept, dismiss, and reviewer notes for every finding
- JSON and CSV exports with model provenance, timing, coordinates, and review state
- a measured evaluation view that does not invent precision, recall, or mAP

## Defect-inspection direction

The mode selector includes **Surface Defect Inspection**, but it is intentionally
shown as **model required** rather than bundled with fake results. A useful
defect detector must be trained or fine-tuned on a known product, camera setup,
and defect taxonomy. Once connected, it can reuse the existing review, notes,
filters, and export workflow.

Our recommended production path is [Anomalib](https://github.com/open-edge-platform/anomalib)
with an Apache-2.0 model such as PatchCore or PaDiM. Train it on approved
normal images from the target line, validate it on labelled defect images,
then export a browser-compatible model and connect its anomaly map to this
same review workflow. This is a better fit for many inspection lines than
pretending a COCO detector understands surface damage.

For a reproducible public benchmark, two useful CC BY 4.0 candidates are:

- [NEU-CLS](https://figshare.com/articles/dataset/NEU-CLS/28903550): 1,800
  grayscale steel images across six defect classes. It is a classification
  benchmark, so it is suitable for a future classifier or training reference,
  not direct bounding-box inference.
- [DsPCBSD+](https://figshare.com/articles/dataset/DsPCBSD_/24970329): PCB
  images with manually annotated defect boxes across nine categories. It is a
  stronger supervised detection benchmark, but its PCB domain should not be
  represented as a metal-surface model.

[KolektorSDD2](https://www.vicos.si/resources/kolektorsdd2/) is a valuable real
industrial dataset, but its CC BY-NC-SA 4.0 terms are not appropriate for
unrestricted commercial redistribution. It should only be used after the
necessary permission is obtained.

## Evidence and limitations

- The included sample is a synthetic image used to make the workflow easy to
  try. Its detections are produced by the pinned model, not hardcoded fixture
  data.
- Inference runs in a browser Web Worker using WASM. The UI reports the actual
  model inference time and total processing time for the current device; the
  first run can include model loading. A sample development run measured about
  173 ms inference on the test machine, but this is not a performance promise.
- General COCO-demo accuracy is not claimed for this app. The separate PCB
  detector now has a repeatable validation-only baseline documented below;
  frozen-test performance remains intentionally unreported.
- Images stay on the local device in this demo. Do not use it as the sole basis
  for safety-critical or high-impact decisions.

Potential client use cases include component presence checks, PPE or equipment
review, visual triage, QA annotation, and a human-in-the-loop front end for a
future customer-specific defect model.

## Phase 1: evaluation harness

The repository now contains the first reproducible layer for the
zero/few-shot study in `lib/evaluation.ts`, `scripts/evaluate.mjs`, and
`evaluation/README.md`. It validates a versioned ground-truth manifest,
assigns deterministic group-aware train/validation/test splits, computes
box-level precision, recall, F1, per-class metrics, 101-point AP, mean AP, and
latency summaries, and provides calibration and selective-risk utilities for
future uncertainty experiments.

Phase 1 deliberately does not contain VLM predictions or accuracy claims. Run
it only with a real manifest and recorded model output:

```bash
npm run evaluate -- --manifest path/to/manifest.json \
  --predictions path/to/predictions.json --split test \
  --output reports/local/run.json
```

The first benchmark domain is DsPCBSD+, a PCB surface-defect dataset with
nine annotated categories. Its source and license are recorded in the harness;
raw images and generated local reports remain outside Git by default.

## Phase 2: zero/few-shot VLM contract

The next layer is a strict, provider-neutral adapter in [`lib/vlm.ts`](lib/vlm.ts)
with its protocol documented in [`vlm/README.md`](vlm/README.md). It supports
zero-shot inspection and exactly 1-, 3-, or 5-shot support examples without
pretending that a model score is a calibrated probability. Responses must use
the frozen DsPCBSD+ labels, pixel-space boxes, evidence, and explicit
uncertainty reasons. Every finding is routed to human review by default.

The first local provider is the loopback-only
[SmolVLM-256M-Instruct](https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct)
gateway documented in [`vlm/README.md`](vlm/README.md). It is a general
multimodal model rather than a PCB-defect model, so malformed responses and
weak localization are expected failure cases. The validation runner records
those failures instead of repairing them into predictions.

An optional loopback gateway for GPT-5.6 Terra uses the same adapter and keeps
the API key out of browser code and committed files. Its first six-image
validation probe produced valid structured responses, but did not meet the
IoU/class gate. The measured results and limitations are recorded in
[`vlm/experiments/2026-09-12-gpt-5.6-terra-validation.md`](vlm/experiments/2026-09-12-gpt-5.6-terra-validation.md).
The browser YOLOX workflow remains unchanged, and the frozen test split has not
been run.

The next controlled experiment adds magnified crop verification and real
training-only support images. Its measured comparison is documented in
[`vlm/experiments/2026-09-12-terra-crop-few-shot-comparison.md`](vlm/experiments/2026-09-12-terra-crop-few-shot-comparison.md).
On the six-image validation probe, the best few-shot conditions matched only 2
of 13 defects at class-aware IoU 0.5, while crop verification over-abstained.
That result supports a detector-first hybrid next rather than additional prompt
tuning. It is not a full-dataset accuracy claim.

## Phase 3: specialized PCB detector baseline

A YOLOX-Nano PCB detector has now been trained on all 7,357 training images and
validated on the 851-image validation split. At the validation-selected 0.37
confidence threshold and class-aware IoU 0.5, it measured 69.86% precision,
66.19% recall, 67.98% F1, and 69.41% ranked mAP@0.5. Full CPU validation ran at
42.89 images/second wall-clock on the development machine.

These are validation results, not frozen-test or production claims. The
training scripts, integrity checks, exact protocol, per-class results, and
failure analysis are in [`detector/README.md`](detector/README.md) and
[`detector/experiments/2026-09-12-yolox-nano-validation.md`](detector/experiments/2026-09-12-yolox-nano-validation.md).
The existing browser-local YOLOX object-detection workflow remains unchanged.
Terra verification and human-review routing are deliberately deferred to the
next milestone so the detector-only baseline remains independently auditable.

## Phase 4: validation-only hybrid routing

The full validation split has now been used to test selective Terra verification
for only the detector's 0.29–0.60 uncertainty band. The result is deliberately
reported even though it is negative: detector + Terra did not beat detector
only. The safe validation-selected Terra cutoff suppresses almost every VLM
action, leaving the same 69.86% precision, 66.19% recall, and 67.98% F1 while
adding 105 successful API calls and roughly $1.76–$1.80 of measured/estimated
cost.

Human routing can lift automatic precision to 85.21%, but it queues 836 of 839
ambiguous proposals across 49.24% of validation images. A perfect ground-truth
reviewer simulation reaches 80.54% F1, but that is explicitly an oracle ceiling,
not measured human performance. The protocol, routing tradeoffs, latency, cost,
and limitations are documented in
[`detector/experiments/2026-09-12-hybrid-validation.md`](detector/experiments/2026-09-12-hybrid-validation.md).
The frozen test split remains sealed.

## Local development

```bash
npm ci
npm run dev
```

Open `http://localhost:5173`.

Quality checks used before release:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

## Model and runtime attribution

- [YOLOX](https://github.com/Megvii-BaseDetection/YOLOX) and the bundled
  `public/models/yolox_nano.onnx` are distributed under Apache-2.0. The full
  license text is included in `public/models/YOLOX-LICENSE.txt`.
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) is used under
  its MIT license. The relevant license text is included in
  `public/models/ONNX-Runtime-LICENSE.txt`.

## License

MIT for this application code. Third-party model, runtime, and dataset terms
remain applicable as described above.
