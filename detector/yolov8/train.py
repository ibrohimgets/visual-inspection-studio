#!/usr/bin/env python3
"""Train an isolated YOLOv8n checkpoint using only the prepared train split."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import time
from pathlib import Path

import cv2
import numpy as np
import torch
import ultralytics
from ultralytics import YOLO


EXPECTED_ULTRALYTICS_VERSION = "8.3.39"
EXPECTED_CLASSES = ["SH", "SP", "SC", "OP", "MB", "HB", "CS", "CFO", "BMFO"]


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Train YOLOv8n at 256px on the pinned DsPCBSD+ train split.")
    parser.add_argument("--manifest", type=Path, default=root / "evaluation/dspcbsd-plus.manifest.json")
    parser.add_argument("--dataset", type=Path, default=root / "reports/local/detector/yolov8n-pcb/dataset")
    parser.add_argument("--output", type=Path, default=root / "reports/local/detector/yolov8n-pcb")
    parser.add_argument("--weights", type=Path, default=root / "reports/local/detector/yolov8n-pcb/upstream/yolov8n.pt")
    parser.add_argument("--run-name", default="yolov8n-256-e5-s20260912")
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--image-size", type=int, default=256)
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--threads", type=int, default=14)
    parser.add_argument("--seed", type=int, default=20260912)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def acquire_upstream_weights(path: Path) -> None:
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    previous = Path.cwd()
    try:
        os.chdir(path.parent)
        YOLO(path.name)
    finally:
        os.chdir(previous)
    if not path.is_file():
        raise FileNotFoundError(f"Ultralytics did not materialize the requested upstream weights at {path}")


def main() -> None:
    args = parse_args()
    if ultralytics.__version__ != EXPECTED_ULTRALYTICS_VERSION:
        raise RuntimeError(f"Expected ultralytics {EXPECTED_ULTRALYTICS_VERSION}, found {ultralytics.__version__}")
    if args.image_size != 256:
        raise ValueError("This isolated first experiment is intentionally locked to 256px")
    if args.epochs < 1 or args.batch_size < 1 or args.workers < 0:
        raise ValueError("epochs and batch size must be positive; workers cannot be negative")
    manifest_path = args.manifest.resolve()
    dataset_root = args.dataset.resolve()
    output = args.output.resolve()
    prepared_path = dataset_root / "prepared-dataset.json"
    dataset_yaml = dataset_root / "dataset.yaml"
    if not prepared_path.is_file() or not dataset_yaml.is_file():
        raise FileNotFoundError("Run prepare_dataset.py before training")
    prepared = json.loads(prepared_path.read_text(encoding="utf-8"))
    if prepared.get("testSplitAccessed") is not False or prepared.get("classes") != EXPECTED_CLASSES:
        raise RuntimeError("Prepared dataset provenance is invalid")
    if prepared.get("manifestSha256") != sha256(manifest_path):
        raise RuntimeError("Prepared dataset does not match the current frozen manifest")
    if prepared.get("splits") != {"train": {"images": 7357, "boxes": 14563}, "validation": {"images": 851, "boxes": 1621}}:
        raise RuntimeError("Prepared split counts changed")

    run_dir = output / "runs" / args.run_name
    if run_dir.exists():
        raise FileExistsError(f"Refusing to overwrite an existing experiment: {run_dir}")
    weights = args.weights.resolve()
    acquire_upstream_weights(weights)
    upstream_sha = sha256(weights)
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    torch.set_num_threads(max(1, args.threads))
    torch.set_num_interop_threads(1)
    model = YOLO(str(weights))

    print(json.dumps({
        "event": "training_start",
        "model": "YOLOv8n",
        "ultralyticsVersion": ultralytics.__version__,
        "upstreamWeightsSha256": upstream_sha,
        "trainingSplit": "train",
        "validationSplit": "validation",
        "testSplitAccessed": False,
        "imageSize": args.image_size,
        "epochs": args.epochs,
        "batchSize": args.batch_size,
        "device": "cpu",
    }))
    started = time.perf_counter()
    result = model.train(
        data=str(dataset_yaml),
        imgsz=args.image_size,
        epochs=args.epochs,
        batch=args.batch_size,
        device="cpu",
        workers=args.workers,
        seed=args.seed,
        deterministic=True,
        project=str(output / "runs"),
        name=args.run_name,
        exist_ok=False,
        pretrained=True,
        amp=False,
        cache=False,
        val=True,
        plots=False,
        save_json=False,
        verbose=True,
    )
    total_seconds = time.perf_counter() - started
    actual_run_dir = Path(result.save_dir).resolve()
    if actual_run_dir != run_dir:
        raise RuntimeError(f"Ultralytics changed the requested run directory: {actual_run_dir}")
    best = actual_run_dir / "weights/best.pt"
    last = actual_run_dir / "weights/last.pt"
    if not best.is_file() or not last.is_file():
        raise FileNotFoundError("Training completed without expected best/last checkpoints")
    report = {
        "schemaVersion": 1,
        "model": "YOLOv8n PCB",
        "modelFamily": "Ultralytics YOLOv8",
        "upstreamLicense": "AGPL-3.0 / Ultralytics Enterprise",
        "deploymentStatus": "isolated-experiment",
        "ultralyticsVersion": ultralytics.__version__,
        "upstreamWeights": str(weights),
        "upstreamWeightsSha256": upstream_sha,
        "manifest": str(manifest_path),
        "manifestSha256": sha256(manifest_path),
        "datasetYaml": str(dataset_yaml),
        "datasetYamlSha256": sha256(dataset_yaml),
        "trainingSplit": "train",
        "validationSplit": "validation",
        "testSplitAccessed": False,
        "trainImages": prepared["splits"]["train"]["images"],
        "trainBoxes": prepared["splits"]["train"]["boxes"],
        "validationImages": prepared["splits"]["validation"]["images"],
        "validationBoxes": prepared["splits"]["validation"]["boxes"],
        "classes": EXPECTED_CLASSES,
        "epochs": args.epochs,
        "batchSize": args.batch_size,
        "imageSize": args.image_size,
        "seed": args.seed,
        "device": "cpu",
        "threads": torch.get_num_threads(),
        "totalSeconds": total_seconds,
        "bestCheckpoint": str(best),
        "bestCheckpointSha256": sha256(best),
        "bestCheckpointBytes": best.stat().st_size,
        "parameterCount": sum(parameter.numel() for parameter in model.model.parameters()),
        "lastCheckpoint": str(last),
        "lastCheckpointSha256": sha256(last),
        "environment": {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "opencv": cv2.__version__,
            "numpy": np.__version__,
            "ultralytics": ultralytics.__version__,
        },
    }
    report_path = actual_run_dir / "training-report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"event": "training_complete", "report": str(report_path), "seconds": total_seconds, "checkpointBytes": report["bestCheckpointBytes"]}, indent=2))


if __name__ == "__main__":
    main()
