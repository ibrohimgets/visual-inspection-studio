import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DSPCBSD_PLUS, stableHash, validateManifest } from "../lib/evaluation.ts";

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: npm run prepare:dataset -- [--root datasets/dspcbsd-plus/raw/Data_COCO] [--output evaluation/dspcbsd-plus.manifest.json] [--seed dspcbsd-plus-v1]");
  process.exit(0);
}

const root = path.resolve(argument("root", "datasets/dspcbsd-plus/raw/Data_COCO"));
const output = path.resolve(argument("output", "evaluation/dspcbsd-plus.manifest.json"));
const seed = argument("seed", "dspcbsd-plus-v1");
const annotationPaths = {
  train: path.join(root, "annotations", "instances_train2017.json"),
  officialValidation: path.join(root, "annotations", "instances_val2017.json"),
};
const categoryNames = [...DSPCBSD_PLUS.classes];
const categorySet = new Set(categoryNames);

async function readJson(file) {
  const bytes = await readFile(file);
  return { value: JSON.parse(bytes.toString("utf8")), sha256: createHash("sha256").update(bytes).digest("hex") };
}

function fail(message) { throw new Error(message); }

function convertSource(source, document, splitForImage) {
  if (!Array.isArray(document.images) || !Array.isArray(document.annotations) || !Array.isArray(document.categories)) fail(`${source} COCO document is missing images, annotations, or categories.`);
  const categories = new Map(document.categories.map(category => [category.id, category.name]));
  if (document.categories.length !== categoryNames.length || document.categories.some(category => !categorySet.has(category.name))) fail(`${source} category list does not match the pinned DsPCBSD+ taxonomy.`);
  const annotationsByImage = new Map();
  for (const annotation of document.annotations) {
    if (annotation.iscrowd) fail(`${source} contains an unsupported crowd annotation.`);
    const label = categories.get(annotation.category_id);
    if (!label) fail(`${source} annotation ${annotation.id} references an unknown category.`);
    if (!Array.isArray(annotation.bbox) || annotation.bbox.length !== 4 || !annotation.bbox.every(value => typeof value === "number" && Number.isFinite(value))) fail(`${source} annotation ${annotation.id} has an invalid bbox.`);
    const list = annotationsByImage.get(annotation.image_id) || [];
    list.push({ label, bbox: annotation.bbox });
    annotationsByImage.set(annotation.image_id, list);
  }
  const images = document.images.map(image => {
    const boxes = (annotationsByImage.get(image.id) || []).map(({ label, bbox }) => {
      const [x, y, width, height] = bbox;
      const roundingTolerance = 0.05;
      if (width <= 0 || height <= 0 || x < -roundingTolerance || y < -roundingTolerance || x + width > image.width + roundingTolerance || y + height > image.height + roundingTolerance) fail(`${source} image ${image.file_name} has an out-of-bounds bbox.`);
      const left = Math.max(0, x); const top = Math.max(0, y);
      const right = Math.min(image.width, x + width); const bottom = Math.min(image.height, y + height);
      return { label, x: left, y: top, width: right - left, height: bottom - top };
    });
    const split = splitForImage(image.file_name);
    return {
      imageId: `${source}:${image.file_name}`,
      file: `${source === "officialValidation" ? "val2017" : "train2017"}/${image.file_name}`,
      width: image.width,
      height: image.height,
      // The archive has no production-batch field, so the filename is the
      // strongest available grouping key and is documented as a limitation.
      group: image.file_name,
      split,
      boxes,
    };
  });
  const referencedImageIds = new Set(document.images.map(image => image.id));
  for (const imageId of annotationsByImage.keys()) if (!referencedImageIds.has(imageId)) fail(`${source} has an annotation for a missing image ${imageId}.`);
  return { images, annotationCount: document.annotations.length };
}

const trainDocument = await readJson(annotationPaths.train);
const validationDocument = await readJson(annotationPaths.officialValidation);
const train = convertSource("train2017", trainDocument.value, fileName => stableHash(`${seed}:train:${fileName}`) % 10 === 0 ? "validation" : "train");
const officialValidation = convertSource("officialValidation", validationDocument.value, () => "test");
const images = [...train.images, ...officialValidation.images].sort((a, b) => a.imageId.localeCompare(b.imageId));
const manifest = {
  schemaVersion: 1,
  imageRoot: "datasets/dspcbsd-plus/raw/Data_COCO",
  dataset: {
    ...DSPCBSD_PLUS,
    source: "https://figshare.com/articles/dataset/DsPCBSD_/24970329",
    doi: "10.6084/m9.figshare.24970329.v1",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    annotationFormat: "COCO bounding boxes",
    archive: { name: "DsPCBSD+.zip", md5: "508334b65bdaea7336f4c1b5d5a80a81", sizeBytes: 128541608 },
    annotationFiles: {
      train: { file: "annotations/instances_train2017.json", sha256: trainDocument.sha256 },
      officialValidation: { file: "annotations/instances_val2017.json", sha256: validationDocument.sha256 },
    },
    splitProtocol: {
      seed,
      testSource: "official validation split (instances_val2017), frozen as test",
      trainSource: "instances_train2017",
      trainValidationRule: "stableHash(seed + ':train:' + file_name) % 10 === 0 -> validation; otherwise train",
      groupingLimitation: "The archive has no production-batch identifier; filename is retained as the grouping key.",
      bboxPolicy: "COCO boxes are clipped to image bounds only when the overrun is <= 0.05 pixels, to absorb annotation rounding.",
    },
  },
  images,
};
const errors = validateManifest(manifest);
if (errors.length) fail(`Generated manifest failed validation:\n${errors.join("\n")}`);
if (images.length !== 10259) fail(`Expected 10,259 images, found ${images.length}.`);
if (images.reduce((sum, image) => sum + image.boxes.length, 0) !== 20276) fail("Expected 20,276 boxes.");
if (train.annotationCount !== 16184 || officialValidation.annotationCount !== 4092) fail("COCO annotation counts do not match the published dataset summary.");

await writeFile(output, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
  output,
  dataset: manifest.dataset.id,
  images: images.length,
  boxes: images.reduce((sum, image) => sum + image.boxes.length, 0),
  splits: Object.fromEntries(["train", "validation", "test"].map(split => [split, images.filter(image => image.split === split).length])),
  boxesBySplit: Object.fromEntries(["train", "validation", "test"].map(split => [split, images.filter(image => image.split === split).reduce((sum, image) => sum + image.boxes.length, 0)])),
  annotationSha256: manifest.dataset.annotationFiles,
}, null, 2));
