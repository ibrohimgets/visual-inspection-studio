#!/usr/bin/env python3
"""Create an ignored YOLO-format view of the manifest's train/validation data.

The frozen test records remain in the source manifest but their image and
annotation files are never opened by this converter.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path
from typing import Any


EXPECTED_CLASSES = ["SH", "SP", "SC", "OP", "MB", "HB", "CS", "CFO", "BMFO"]
EXPECTED_COUNTS = {
    "train": {"images": 7357, "boxes": 14563},
    "validation": {"images": 851, "boxes": 1621},
}


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Prepare train/validation YOLO labels without accessing the frozen test split.")
    parser.add_argument("--manifest", type=Path, default=root / "evaluation/dspcbsd-plus.manifest.json")
    parser.add_argument("--output", type=Path, default=root / "reports/local/detector/yolov8n-pcb/dataset")
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_if_identical_or_new(path: Path, content: str) -> None:
    if path.exists():
        if path.read_text(encoding="utf-8") != content:
            raise RuntimeError(f"Refusing to overwrite different generated content: {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def link_or_copy(source: Path, destination: Path) -> str:
    if destination.exists():
        if destination.stat().st_size != source.stat().st_size:
            raise RuntimeError(f"Refusing to overwrite a different generated image: {destination}")
        return "existing"
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, destination)
        return "hardlink"
    except OSError:
        shutil.copy2(source, destination)
        return "copy"


def label_text(record: dict[str, Any], class_to_index: dict[str, int]) -> str:
    width = float(record["width"])
    height = float(record["height"])
    if width <= 0 or height <= 0:
        raise RuntimeError(f"Invalid dimensions for {record['imageId']}")
    rows = []
    for box in record["boxes"]:
        if box["label"] not in class_to_index:
            raise RuntimeError(f"Unknown class {box['label']} in {record['imageId']}")
        x = float(box["x"])
        y = float(box["y"])
        box_width = float(box["width"])
        box_height = float(box["height"])
        if box_width <= 0 or box_height <= 0 or x < 0 or y < 0 or x + box_width > width + .05 or y + box_height > height + .05:
            raise RuntimeError(f"Invalid box in {record['imageId']}")
        center_x = (x + box_width / 2) / width
        center_y = (y + box_height / 2) / height
        normalized_width = box_width / width
        normalized_height = box_height / height
        values = [center_x, center_y, normalized_width, normalized_height]
        if any(value < 0 or value > 1.000001 for value in values):
            raise RuntimeError(f"Normalized box escaped image bounds in {record['imageId']}")
        rows.append(f"{class_to_index[box['label']]} " + " ".join(f"{value:.8f}" for value in values))
    return "\n".join(rows) + ("\n" if rows else "")


def main() -> None:
    args = parse_args()
    manifest_path = args.manifest.resolve()
    output = args.output.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    classes = list(manifest["dataset"]["classes"])
    if classes != EXPECTED_CLASSES:
        raise RuntimeError(f"Class order changed; expected {EXPECTED_CLASSES}, found {classes}")
    if manifest["dataset"].get("license") != "CC BY 4.0":
        raise RuntimeError("DsPCBSD+ license metadata changed")
    image_root = (manifest_path.parents[1] / manifest["imageRoot"]).resolve()
    class_to_index = {label: index for index, label in enumerate(classes)}
    seen_names: set[str] = set()
    methods = {"hardlink": 0, "copy": 0, "existing": 0}
    summary_splits: dict[str, dict[str, int]] = {}

    for split in ("train", "validation"):
        records = sorted((record for record in manifest["images"] if record.get("split") == split), key=lambda record: record["imageId"])
        image_count = len(records)
        box_count = sum(len(record["boxes"]) for record in records)
        if {"images": image_count, "boxes": box_count} != EXPECTED_COUNTS[split]:
            raise RuntimeError(f"Pinned {split} counts changed: {image_count} images, {box_count} boxes")
        for record in records:
            source = (image_root / record["file"]).resolve()
            if not source.is_file():
                raise FileNotFoundError(f"Missing {split} image: {source}")
            file_name = Path(record["file"]).name
            if file_name in seen_names:
                raise RuntimeError(f"Duplicate filename would make the YOLO view ambiguous: {file_name}")
            seen_names.add(file_name)
            method = link_or_copy(source, output / "images" / split / file_name)
            methods[method] += 1
            write_if_identical_or_new(output / "labels" / split / f"{Path(file_name).stem}.txt", label_text(record, class_to_index))
        summary_splits[split] = {"images": image_count, "boxes": box_count}

    yaml = [
        f"path: {json.dumps(output.as_posix())}",
        "train: images/train",
        "val: images/validation",
        "names:",
        *[f"  {index}: {label}" for index, label in enumerate(classes)],
        "",
    ]
    dataset_yaml = output / "dataset.yaml"
    write_if_identical_or_new(dataset_yaml, "\n".join(yaml))
    summary = {
        "schemaVersion": 1,
        "dataset": manifest["dataset"]["id"],
        "datasetLicense": manifest["dataset"]["license"],
        "manifest": str(manifest_path),
        "manifestSha256": sha256(manifest_path),
        "datasetYaml": str(dataset_yaml),
        "classes": classes,
        "splits": summary_splits,
        "testSplitAccessed": False,
        "imageMaterialization": methods,
    }
    summary_path = output / "prepared-dataset.json"
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"event": "dataset_prepared", **summary}, indent=2))


if __name__ == "__main__":
    main()
