#!/usr/bin/env python3
"""CPU-safe YOLOX-Nano fine-tuning on the frozen DsPCBSD+ manifest.

The upstream YOLOX trainer targets CUDA. This script uses the unchanged pinned
YOLOX model and loss on CPU, and permits only the manifest's training split.
Checkpoints and generated reports belong under reports/local/ and stay out of
Git.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
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
EXPECTED_PRETRAINED_SHA256 = "cd28f55fbbc1829f99d9ac9b38a16d259a22889739c8728ea877610201feff7b"


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Fine-tune YOLOX-Nano on DsPCBSD+ using CPU.")
    parser.add_argument("--manifest", type=Path, default=root / "evaluation/dspcbsd-plus.manifest.json")
    parser.add_argument("--yolox", type=Path, default=root / "reports/local/external/YOLOX")
    parser.add_argument("--pretrained", type=Path, default=root / "reports/local/detector/yolox_nano.pth")
    parser.add_argument("--output", type=Path, default=root / "reports/local/detector/yolox-nano-pcb")
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--image-size", type=int, default=256)
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--threads", type=int, default=14)
    parser.add_argument("--print-every", type=int, default=25)
    parser.add_argument("--seed", type=int, default=20260912)
    parser.add_argument("--max-train-images", type=int, default=0, help="Smoke-test cap; 0 uses the complete training split.")
    return parser.parse_args()


class PcbTrainDataset(Dataset):
    def __init__(self, images: list[dict[str, Any]], image_root: Path, classes: list[str], image_size: int, transform: Any):
        self.images = images
        self.image_root = image_root
        self.class_to_index = {label: index for index, label in enumerate(classes)}
        self.input_size = (image_size, image_size)
        self.transform = transform

    def __len__(self) -> int:
        return len(self.images)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor]:
        record = self.images[index]
        image = cv2.imread(str(self.image_root / record["file"]))
        if image is None:
            raise FileNotFoundError(f"Could not read training image {record['file']}")
        targets = np.asarray([
            [box["x"], box["y"], box["x"] + box["width"], box["y"] + box["height"], self.class_to_index[box["label"]]]
            for box in record["boxes"]
        ], dtype=np.float32).reshape(-1, 5)
        transformed, labels = self.transform(image, targets, self.input_size)
        return torch.from_numpy(transformed), torch.from_numpy(labels)


def verify_yolox_checkout(path: Path) -> str:
    if not (path / ".git").exists():
        raise FileNotFoundError(f"Pinned YOLOX checkout is missing: {path}")
    commit = subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()
    if commit != EXPECTED_YOLOX_COMMIT:
        raise RuntimeError(f"YOLOX checkout must be pinned to {EXPECTED_YOLOX_COMMIT}, found {commit}")
    return commit


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_pretrained(model: torch.nn.Module, path: Path) -> dict[str, int | str]:
    if not path.exists():
        raise FileNotFoundError(f"Pretrained YOLOX-Nano checkpoint is missing: {path}")
    checksum = sha256(path)
    if checksum != EXPECTED_PRETRAINED_SHA256:
        raise RuntimeError(f"Pretrained checkpoint SHA-256 mismatch: expected {EXPECTED_PRETRAINED_SHA256}, found {checksum}")
    checkpoint = torch.load(path, map_location="cpu", weights_only=False)
    source = checkpoint.get("model", checkpoint)
    target = model.state_dict()
    matched = {key: value for key, value in source.items() if key in target and target[key].shape == value.shape}
    model.load_state_dict(matched, strict=False)
    return {"sha256": checksum, "matchedTensors": len(matched), "sourceTensors": len(source), "targetTensors": len(target)}


def main() -> None:
    args = parse_args()
    if args.epochs < 1 or args.batch_size < 1 or args.image_size < 64 or args.image_size % 32:
        raise ValueError("epochs/batch size must be positive and image size must be >=64 and divisible by 32")
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(max(1, args.threads))
    torch.set_num_interop_threads(1)

    commit = verify_yolox_checkout(args.yolox.resolve())
    sys.path.insert(0, str(args.yolox.resolve()))
    from yolox.data import TrainTransform  # pylint: disable=import-outside-toplevel
    from yolox.exp import get_exp  # pylint: disable=import-outside-toplevel

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    classes = list(manifest["dataset"]["classes"])
    train_images = sorted((image for image in manifest["images"] if image.get("split") == "train"), key=lambda image: image["imageId"])
    if any(image.get("split") != "train" for image in train_images):
        raise RuntimeError("Training selection escaped the training split")
    if args.max_train_images:
        train_images = train_images[: args.max_train_images]
    if not train_images:
        raise RuntimeError("No training images selected")
    image_root = (args.manifest.resolve().parents[1] / manifest.get("imageRoot", ".")).resolve()
    transform = TrainTransform(max_labels=50, flip_prob=.5, hsv_prob=.5)
    dataset = PcbTrainDataset(train_images, image_root, classes, args.image_size, transform)
    generator = torch.Generator().manual_seed(args.seed)
    loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=True, num_workers=args.workers, drop_last=False, generator=generator)

    exp = get_exp(str(args.yolox / "exps/default/yolox_nano.py"), None)
    exp.num_classes = len(classes)
    exp.input_size = (args.image_size, args.image_size)
    exp.test_size = exp.input_size
    model = exp.get_model().cpu()
    load_summary = load_pretrained(model, args.pretrained.resolve())
    initial_lr = .01 / 64 * args.batch_size
    optimizer = torch.optim.SGD(model.parameters(), lr=initial_lr, momentum=.9, nesterov=True, weight_decay=5e-4)
    args.output.mkdir(parents=True, exist_ok=True)
    history: list[dict[str, float]] = []

    print(json.dumps({
        "event": "training_start",
        "split": "train",
        "testSplitAccessed": False,
        "images": len(dataset),
        "boxes": sum(len(image["boxes"]) for image in train_images),
        "classes": classes,
        "epochs": args.epochs,
        "batchSize": args.batch_size,
        "imageSize": args.image_size,
        "device": "cpu",
        "threads": torch.get_num_threads(),
        "yoloxCommit": commit,
        "pretrainedLoad": load_summary,
    }))

    training_started = time.perf_counter()
    for epoch in range(args.epochs):
        model.train()
        epoch_started = time.perf_counter()
        totals = {"total_loss": 0.0, "iou_loss": 0.0, "conf_loss": 0.0, "cls_loss": 0.0}
        lr_scale = .25 + .75 * .5 * (1 + math.cos(math.pi * epoch / max(1, args.epochs - 1)))
        current_lr = initial_lr * lr_scale
        for group in optimizer.param_groups:
            group["lr"] = current_lr
        for step, (inputs, targets) in enumerate(loader, start=1):
            inputs = inputs.float()
            targets = targets.float()
            optimizer.zero_grad(set_to_none=True)
            losses = model(inputs, targets)
            losses["total_loss"].backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=20)
            optimizer.step()
            for key in totals:
                totals[key] += float(losses[key].detach())
            if step == 1 or step % max(1, args.print_every) == 0 or step == len(loader):
                print(json.dumps({"event": "training_progress", "epoch": epoch + 1, "step": step, "steps": len(loader), "loss": float(losses["total_loss"].detach()), "lr": current_lr}))
        epoch_seconds = time.perf_counter() - epoch_started
        summary = {"epoch": epoch + 1, "seconds": epoch_seconds, "learningRate": current_lr, **{key: value / len(loader) for key, value in totals.items()}}
        history.append(summary)
        checkpoint = {
            "model": model.state_dict(),
            "optimizer": optimizer.state_dict(),
            "epoch": epoch + 1,
            "classes": classes,
            "image_size": args.image_size,
            "training_split": "train",
            "manifest": str(args.manifest.resolve()),
            "yolox_commit": commit,
            "history": history,
        }
        torch.save(checkpoint, args.output / "latest.pth")
        torch.save(checkpoint, args.output / f"epoch-{epoch + 1}.pth")
        print(json.dumps({"event": "epoch_complete", **summary}))

    report = {
        "schemaVersion": 1,
        "model": "YOLOX-Nano",
        "upstreamCommit": commit,
        "upstreamLicense": "Apache-2.0",
        "trainingSplit": "train",
        "testSplitAccessed": False,
        "imageCount": len(dataset),
        "boxCount": sum(len(image["boxes"]) for image in train_images),
        "classes": classes,
        "epochs": args.epochs,
        "batchSize": args.batch_size,
        "imageSize": args.image_size,
        "device": "cpu",
        "seed": args.seed,
        "pretrainedLoad": load_summary,
        "totalSeconds": time.perf_counter() - training_started,
        "history": history,
        "checkpoint": str((args.output / "latest.pth").resolve()),
    }
    (args.output / "training-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"event": "training_complete", "report": str((args.output / "training-report.json").resolve()), "seconds": report["totalSeconds"]}))


if __name__ == "__main__":
    main()
