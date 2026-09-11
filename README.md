# Visual Inspection Studio

An interactive, client-facing workspace for reviewing computer-vision
detections, confidence thresholds, evaluation metrics, and exportable results.

[Open the private demo](https://visual-inspection-studio.iibrohimm.chatgpt.site)

![Synthetic metal inspection sample](public/synthetic-metal-inspection.png)

## Why this project exists

Computer-vision delivery is more than drawing boxes. A usable inspection
workflow needs threshold controls, human review, measurable validation, clear
failure handling, and structured exports. This project demonstrates that
product layer in a polished web interface.

## Features

- Image upload and drag-and-drop
- Interactive detection overlays and finding selection
- Adjustable confidence threshold
- Class filters
- Baseline-versus-model evaluation view
- JSON and CSV export
- Responsive desktop and mobile layout
- Clear human-review and limitation messaging

## Evidence policy

This first release is intentionally labeled **portfolio demo mode**:

- The included metal component is a synthetic sample created for this project.
- Detection output and evaluation metrics are representative interface data.
- Uploaded images remain in the browser.
- No production accuracy claim is made.

The next technical milestone is to connect this interface to a versioned
object-detection API and replace representative values with reproducible
evaluation artifacts.

## Tech stack

- Vinext / React 19
- TypeScript
- Tailwind CSS
- Radix-based UI primitives
- Lucide icons
- Cloudflare-compatible Sites build

## Local development

```bash
npm ci
npm run dev
```

Open `http://localhost:5173`.

## Production build

```bash
npm run build
```

## Planned model integration

1. FastAPI inference endpoint returning boxes, labels, scores, and latency.
2. Versioned model and dataset metadata in every result.
3. Real baseline and fine-tuned evaluation reports.
4. Batch upload with background processing.
5. Saved review decisions and downloadable QA reports.

## Responsible use

Low-confidence findings require human review. A detection result must not be
used as the sole basis for safety-critical or high-impact decisions.

## License

MIT
