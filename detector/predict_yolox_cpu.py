#!/usr/bin/env python3
"""Run a trained YOLOX-Nano checkpoint on the manifest validation split."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset


EXPECTED_YOLOX_COMMIT = "419778480ab6ec0590e5d3831b3afb3b46ab2aa3"


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Predict DsPCBSD+ validation boxes with YOLOX-Nano.")
    parser.add_argument("--manifest", type=Path, default=root / "evaluation/dspcbsd-plus.manifest.json")
    parser.add_argument("--yolox", type=Path, default=root / "reports/local/external/YOLOX")
    parser.add_argument("--checkpoint", type=Path, default=root / "reports/local/detector/yolox-nano-pcb/latest.pth")
    parser.add_argument("--output", type=Path, default=root / "reports/local/detector/yolox-nano-pcb/validation-predictions.json")
    parser.add_argument("--split", choices=["train", "validation"], default="validation")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--threads", type=int, default=14)
    parser.add_argument("--confidence", type=float, default=.001)
    parser.add_argument("--nms", type=float, default=.65)
    parser.add_argument("--max-images", type=int, default=0)
    return parser.parse_args()


class PcbValidationDataset(Dataset):
    def __init__(self, images: list[dict[str, Any]], image_root: Path, image_size: int, transform: Any):
        self.images = images
        self.image_root = image_root
        self.image_size = image_size
        self.transform = transform

    def __len__(self) -> int:
        return len(self.images)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, str, float]:
        record = self.images[index]
        image = cv2.imread(str(self.image_root / record["file"]))
        if image is None:
            raise FileNotFoundError(f"Could not read image {record['file']}")
        ratio = min(self.image_size / image.shape[0], self.image_size / image.shape[1])
        transformed, _ = self.transform(image, None, (self.image_size, self.image_size))
        return torch.from_numpy(transformed), record["imageId"], ratio


def main() -> None:
    args = parse_args()
    if args.split == "test":
        raise RuntimeError("The frozen test split is sealed")
    torch.set_num_threads(max(1, args.threads))
    torch.set_num_interop_threads(1)
    commit = subprocess.check_output(["git", "-C", str(args.yolox.resolve()), "rev-parse", "HEAD"], text=True).strip()
    if commit != EXPECTED_YOLOX_COMMIT:
        raise RuntimeError(f"YOLOX checkout must be pinned to {EXPECTED_YOLOX_COMMIT}, found {commit}")
    sys.path.insert(0, str(args.yolox.resolve()))
    from yolox.data import ValTransform  # pylint: disable=import-outside-toplevel
    from yolox.exp import get_exp  # pylint: disable=import-outside-toplevel
    from yolox.utils import postprocess  # pylint: disable=import-outside-toplevel

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    classes = list(manifest["dataset"]["classes"])
    images = sorted((image for image in manifest["images"] if image.get("split") == args.split), key=lambda image: image["imageId"])
    if args.max_images:
        images = images[: args.max_images]
    if not images or any(image.get("split") != args.split for image in images):
        raise RuntimeError("Prediction selection escaped the requested split")
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    if checkpoint.get("training_split") != "train":
        raise RuntimeError("Checkpoint provenance does not prove training-only data")
    image_size = int(checkpoint["image_size"])
    exp = get_exp(str(args.yolox / "exps/default/yolox_nano.py"), None)
    exp.num_classes = len(classes)
    exp.input_size = (image_size, image_size)
    exp.test_size = exp.input_size
    model = exp.get_model().cpu()
    model.load_state_dict(checkpoint["model"])
    model.eval()
    image_root = (args.manifest.resolve().parents[1] / manifest.get("imageRoot", ".")).resolve()
    dataset = PcbValidationDataset(images, image_root, image_size, ValTransform(legacy=False))
    loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=False, num_workers=args.workers)
    image_by_id = {image["imageId"]: image for image in images}
    records = []
    total_started = time.perf_counter()
    with torch.inference_mode():
        for batch_index, (inputs, image_ids, ratios) in enumerate(loader, start=1):
            started = time.perf_counter()
            outputs = model(inputs.float())
            outputs = postprocess(outputs, len(classes), args.confidence, args.nms, class_agnostic=False)
            batch_ms = (time.perf_counter() - started) * 1000
            for output, image_id, ratio in zip(outputs, image_ids, ratios.tolist()):
                predictions = []
                if output is not None:
                    for row in output.cpu().tolist():
                        x1, y1, x2, y2, objectness, class_confidence, class_index = row
                        predictions.append({
                            "label": classes[int(class_index)],
                            "x": max(0.0, x1 / ratio),
                            "y": max(0.0, y1 / ratio),
                            "width": max(.001, (x2 - x1) / ratio),
                            "height": max(.001, (y2 - y1) / ratio),
                            "confidence": objectness * class_confidence,
                            "source": "yolox-nano-pcb",
                            "decision": "review",
                        })
                record = image_by_id[image_id]
                for prediction in predictions:
                    prediction["x"] = min(prediction["x"], record["width"] - .001)
                    prediction["y"] = min(prediction["y"], record["height"] - .001)
                    prediction["width"] = min(prediction["width"], record["width"] - prediction["x"])
                    prediction["height"] = min(prediction["height"], record["height"] - prediction["y"])
                records.append({"imageId": image_id, "inferenceMs": batch_ms / len(image_ids), "predictions": predictions})
            if batch_index == 1 or batch_index % 10 == 0 or batch_index == len(loader):
                print(json.dumps({"event": "prediction_progress", "batch": batch_index, "batches": len(loader), "records": len(records)}))

    output = {
        "schemaVersion": 1,
        "model": "YOLOX-Nano PCB",
        "upstreamCommit": commit,
        "checkpoint": str(args.checkpoint.resolve()),
        "checkpointEpoch": checkpoint["epoch"],
        "trainingSplit": checkpoint["training_split"],
        "predictionSplit": args.split,
        "testSplitAccessed": False,
        "inputSize": image_size,
        "proposalConfidence": args.confidence,
        "nmsThreshold": args.nms,
        "imageCount": len(images),
        "totalInferenceMs": (time.perf_counter() - total_started) * 1000,
        "results": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"event": "prediction_complete", "output": str(args.output.resolve()), "images": len(images), "predictions": sum(len(record["predictions"]) for record in records)}))


if __name__ == "__main__":
    main()
