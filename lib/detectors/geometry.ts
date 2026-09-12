import type { Detection } from "./types.ts";

export function iou(a: Detection, b: Detection) {
  const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

export function suppressOverlaps(items: Detection[], threshold = 0.45, classAgnostic = true) {
  const sorted = [...items].sort((a, b) => b.confidence - a.confidence);
  const kept: Detection[] = [];
  for (const item of sorted) {
    if (kept.every(other => (!classAgnostic && other.label !== item.label) || iou(item, other) <= threshold)) {
      kept.push(item);
    }
    if (kept.length === 300) break;
  }
  return kept.map((item, index) => ({ ...item, id: index + 1 }));
}
