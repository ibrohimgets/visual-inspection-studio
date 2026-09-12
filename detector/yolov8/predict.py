#!/usr/bin/env python3
"""Generate validation-only predictions from an isolated YOLOv8n checkpoint."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch
import ultralytics
from ultralytics import YOLO


EXPECTED_ULTRALYTICS_VERSION = "8.3.39"


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Predict the manifest validation split with trained YOLOv8n weights.")
    parser.add_argument("--training-report", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, default=root / "evaluation/dspcbsd-plus.manifest.json")
    parser.add_argument("--output", type=Path, default=root / "reports/local/detector/yolov8n-pcb/validation-predictions.json")
    parser.add_argument("--split", choices=["train", "validation"], default="validation")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--threads", type=int, default=14)
    parser.add_argument("--confidence", type=float, default=.001)
    parser.add_argument("--nms", type=float, default=.65)
    parser.add_argument("--max-images", type=int, default=0)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clipped_prediction(box: list[float], confidence: float, label: str, record: dict[str, Any]) -> dict[str, Any] | None:
    x1, y1, x2, y2 = box
    width = float(record["width"])
    height = float(record["height"])
    left = max(0.0, min(width, x1))
    top = max(0.0, min(height, y1))
    right = max(0.0, min(width, x2))
    bottom = max(0.0, min(height, y2))
    if right - left < .001 or bottom - top < .001:
        return None
    return {
        "label": label,
        "x": left,
        "y": top,
        "width": right - left,
        "height": bottom - top,
        "confidence": confidence,
        "source": "yolov8n-pcb",
        "decision": "review",
    }


def main() -> None:
    args = parse_args()
    if args.split == "test":
        raise RuntimeError("The frozen test split is sealed")
    if ultralytics.__version__ != EXPECTED_ULTRALYTICS_VERSION:
        raise RuntimeError(f"Expected ultralytics {EXPECTED_ULTRALYTICS_VERSION}, found {ultralytics.__version__}")
    if args.batch_size < 1 or args.threads < 1 or not 0 <= args.confidence <= 1 or not 0 < args.nms <= 1:
        raise ValueError("Invalid prediction arguments")
    training_report_path = args.training_report.resolve()
    training = json.loads(training_report_path.read_text(encoding="utf-8"))
    if training.get("trainingSplit") != "train" or training.get("testSplitAccessed") is not False:
        raise RuntimeError("Checkpoint provenance does not prove train-only training")
    if training.get("deploymentStatus") != "isolated-experiment":
        raise RuntimeError("YOLOv8 experiment must remain isolated")
    manifest_path = args.manifest.resolve()
    if training.get("manifestSha256") != sha256(manifest_path):
        raise RuntimeError("Training report and manifest do not match")
    checkpoint = Path(training["bestCheckpoint"]).resolve()
    if not checkpoint.is_file() or sha256(checkpoint) != training.get("bestCheckpointSha256"):
        raise RuntimeError("Best checkpoint is missing or changed")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    classes = list(manifest["dataset"]["classes"])
    if classes != training.get("classes"):
        raise RuntimeError("Training and manifest class orders differ")
    images = sorted((record for record in manifest["images"] if record.get("split") == args.split), key=lambda record: record["imageId"])
    if args.max_images:
        images = images[: args.max_images]
    if not images or any(record.get("split") != args.split for record in images):
        raise RuntimeError("Prediction selection escaped the requested split")
    image_root = (manifest_path.parents[1] / manifest["imageRoot"]).resolve()
    path_to_record: dict[str, dict[str, Any]] = {}
    paths = []
    for record in images:
        source = (image_root / record["file"]).resolve()
        if not source.is_file():
            raise FileNotFoundError(f"Missing {args.split} image: {source}")
        key = str(source).casefold()
        if key in path_to_record:
            raise RuntimeError(f"Duplicate source image path: {source}")
        path_to_record[key] = record
        paths.append(str(source))

    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    model = YOLO(str(checkpoint))
    model_names = [model.names[index] for index in range(len(model.names))]
    if model_names != classes:
        raise RuntimeError(f"Checkpoint class order differs from manifest: {model_names}")

    records = []
    total_preprocess_ms = 0.0
    total_model_ms = 0.0
    wall_started = time.perf_counter()
    results = model.predict(
        source=paths,
        stream=True,
        batch=args.batch_size,
        imgsz=int(training["imageSize"]),
        conf=args.confidence,
        iou=args.nms,
        max_det=300,
        device="cpu",
        augment=False,
        agnostic_nms=False,
        verbose=False,
        save=False,
    )
    for index, result in enumerate(results, start=1):
        source = str(Path(result.path).resolve()).casefold()
        record = path_to_record.get(source)
        if record is None:
            raise RuntimeError(f"Ultralytics returned an unexpected image: {result.path}")
        predictions = []
        if result.boxes is not None:
            boxes = result.boxes.xyxy.cpu().tolist()
            confidences = result.boxes.conf.cpu().tolist()
            class_ids = result.boxes.cls.cpu().tolist()
            for box, confidence, class_id in zip(boxes, confidences, class_ids):
                prediction = clipped_prediction(box, float(confidence), classes[int(class_id)], record)
                if prediction is not None:
                    predictions.append(prediction)
        preprocess_ms = float(result.speed.get("preprocess", 0.0))
        model_ms = float(result.speed.get("inference", 0.0)) + float(result.speed.get("postprocess", 0.0))
        total_preprocess_ms += preprocess_ms
        total_model_ms += model_ms
        records.append({
            "imageId": record["imageId"],
            "inferenceMs": model_ms,
            "preprocessMs": preprocess_ms,
            "predictions": predictions,
        })
        if index == 1 or index % 100 == 0 or index == len(images):
            print(json.dumps({"event": "prediction_progress", "images": index, "total": len(images)}))

    total_wall_ms = (time.perf_counter() - wall_started) * 1000
    if len(records) != len(images) or {record["imageId"] for record in records} != {record["imageId"] for record in images}:
        raise RuntimeError("Prediction results do not cover the requested split exactly once")
    output = {
        "schemaVersion": 1,
        "model": "YOLOv8n PCB",
        "modelFamily": "Ultralytics YOLOv8",
        "upstreamLicense": "AGPL-3.0 / Ultralytics Enterprise",
        "deploymentStatus": "isolated-experiment",
        "ultralyticsVersion": ultralytics.__version__,
        "checkpoint": str(checkpoint),
        "checkpointSha256": training["bestCheckpointSha256"],
        "checkpointBytes": checkpoint.stat().st_size,
        "parameterCount": sum(parameter.numel() for parameter in model.model.parameters()),
        "trainingReport": str(training_report_path),
        "trainingSplit": "train",
        "predictionSplit": args.split,
        "testSplitAccessed": False,
        "inputSize": training["imageSize"],
        "proposalConfidence": args.confidence,
        "nmsThreshold": args.nms,
        "imageCount": len(images),
        "totalInferenceMs": total_wall_ms,
        "timing": {
            "wallClockMs": total_wall_ms,
            "preprocessMs": total_preprocess_ms,
            "modelAndPostprocessMs": total_model_ms,
            "meanWallClockMsPerImage": total_wall_ms / len(images),
            "meanModelAndPostprocessMsPerImage": total_model_ms / len(images),
        },
        "results": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "event": "prediction_complete",
        "output": str(args.output.resolve()),
        "images": len(images),
        "predictions": sum(len(record["predictions"]) for record in records),
        "wallClockMs": total_wall_ms,
        "testSplitAccessed": False,
    }, indent=2))


if __name__ == "__main__":
    main()
