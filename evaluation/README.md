# Phase 1 evaluation harness

This directory documents the evaluation contract for the uncertainty-aware
zero/few-shot inspection study. It does not contain model predictions or
accuracy claims. Predictions must be produced by a versioned VLM, detector, or
hybrid run and saved separately from the source tree.

## First domain

The first domain is **PCB surface-defect detection** using [DsPCBSD+](https://figshare.com/articles/dataset/DsPCBSD_/24970329).
The source lists a CC BY 4.0 license, 10,259 images, 20,276 manually annotated
bounding boxes, and nine defect categories:

`SH`, `SP`, `SC`, `OP`, `MB`, `HB`, `CS`, `CFO`, `BMFO`.

This is a narrow benchmark choice, not a claim that the system generalizes to
steel, textiles, automotive paint, or every industrial surface.

## Ground-truth manifest

The evaluator expects a JSON object with `schemaVersion: 1`, dataset metadata,
and one record per image:

```json
{
  "schemaVersion": 1,
  "dataset": {
    "id": "dspcbsd-plus",
    "title": "DsPCBSD+",
    "license": "CC BY 4.0",
    "classes": ["SH", "SP", "SC", "OP", "MB", "HB", "CS", "CFO", "BMFO"]
  },
  "images": [
    {
      "imageId": "board-0001",
      "file": "images/board-0001.jpg",
      "width": 1920,
      "height": 1080,
      "group": "production-batch-01",
      "boxes": [
        {"label": "CS", "x": 120, "y": 80, "width": 60, "height": 24}
      ]
    }
  ]
}
```

`group` is optional but strongly recommended. Split assignment hashes the
group, so related crops or images from one production batch stay in one split.
If the source already supplies trusted splits, preserve them instead of
reassigning them.

## Prediction file

The prediction file can be an array or an object with a `results` array:

```json
{
  "model": {"id": "vlm-zero-shot", "version": "prompt-v1"},
  "results": [
    {
      "imageId": "board-0001",
      "inferenceMs": 812,
      "predictions": [
        {
          "label": "CS",
          "x": 116,
          "y": 78,
          "width": 68,
          "height": 28,
          "confidence": 0.71,
          "source": "vlm",
          "uncertainty": 0.29,
          "decision": "review"
        }
      ]
    }
  ]
}
```

The evaluator uses the prediction coordinates and confidence values. Extra
fields such as `source`, `uncertainty`, and `decision` are retained for later
routing analysis but do not silently change detection metrics.

## Run an evaluation

```bash
npm run evaluate -- \
  --manifest path/to/dspcbsd-plus-manifest.json \
  --predictions path/to/predictions.json \
  --split test \
  --iou 0.5 \
  --confidence 0.0 \
  --resolved-manifest reports/local/manifest-with-splits.json \
  --output reports/vlm-zero-shot-test.json
```

The evaluator reports image count, ground-truth box count, prediction count,
precision, recall, F1, mean average precision, per-class metrics, and measured
latency summaries. When the source manifest has no split values,
`--resolved-manifest` saves the deterministic group-aware assignment so every
future model sees the same test set. It does not generate predictions, download
datasets, or invent missing labels.

## Protocol rules

1. Freeze the test split before comparing methods.
2. Keep zero-shot, 1-shot, 3-shot, and 5-shot support images outside the query
   split.
3. Store model, prompt, support-example, and dataset versions beside every
   prediction file.
4. Evaluate all systems on exactly the same query images.
5. Report confidence calibration and abstention separately from detection
   accuracy.
6. Never tune a threshold on the final test split.
7. Publish failure cases and human corrections, not only the best aggregate
   score.
