# Upwork portfolio package

## Recommended project title

**PDF-Driven Industrial Visual Inspection and QA Review System**

## Short description

I built an end-to-end computer-vision quality inspection product that connects factory requirements to explainable image decisions.

A client uploads a searchable quality-spec PDF. The system converts the requirements into structured rule candidates, validates every rule against its source page, and requires human approval. A specialized detector then localizes defects, while a deterministic rule engine produces PASS, FAIL, or HUMAN REVIEW with a complete decision trace.

The product includes defect boxes, confidence controls, zoomed review, accept/dismiss actions, notes, batch inspection, latency/model evidence, and downloadable JSON/CSV reports. The detector interface is modular so it can be adapted to a client’s own product images and defect taxonomy.

The public demo uses real PCB validation predictions and zero paid LLM calls. Owner mode keeps protected live PDF extraction available. The LLM translates quality documents; it never acts as the defect detector and never makes the final quality decision.

## Client problem it solves

Most vision demos stop after drawing a box. A production QA team also needs to answer:

- Which written requirement applies?
- Should an uncertain finding stop the line or go to a person?
- Who approved the decision logic?
- Can we review, correct, and export the result?
- Can the same workflow use our own detector and classes?

This project demonstrates those engineering layers in one working product.

## My contribution

- model-agnostic detector interface and browser inference worker;
- PCB detector training/evaluation with split controls;
- searchable-PDF text extraction and SHA-256 fingerprinting;
- strict structured LLM output and AJV runtime contract;
- exact page-evidence verification and explicit approval gate;
- deterministic PASS / FAIL / REVIEW rule engine;
- operator review, batch inspection, decision trace, JSON/CSV export;
- owner-only paid endpoint and zero-cost public walkthrough;
- automated tests, measured validation results, licensing, and deployment documentation.

## Recommended image order and captions

1. **`upwork-cover-1600x1200.png`**

   *From quality requirements to auditable inspection decisions.*

2. **`05-input-output-cases.png`**

   *Real PCB validation inputs and detector outputs: PASS, human REVIEW, and critical FAIL under one approved policy.*

3. **`01-spec-to-rules.png`**

   *Searchable PDF intake with strict schema validation, page evidence, and a human approval gate.*

4. **`02-inspection-review.png`**

   *Localized open-circuit finding with confidence, region zoom, operator notes, and accept/dismiss workflow.*

5. **`03-decision-trace.png`**

   *Deterministic rule evaluation showing exactly why the image failed.*

6. **`04-architecture.png`**

   *Engineering architecture separating LLM extraction, policy governance, detector inference, human review, and reporting.*

All visuals are direct product captures, code-rendered architecture, or attributed DsPCBSD+ samples. No generative concept art is used.

## Suggested skills/tags

Computer Vision · Object Detection · Machine Learning · Python · TypeScript · React · ONNX · YOLOX · YOLOv8 · PDF Processing · OpenAI API · Quality Assurance · MLOps

## Links

- Live demo: https://visual-inspection-studio.iibrohimm.chatgpt.site/
- Source code: https://github.com/ibrohimgets/visual-inspection-studio

## Honest scope statement

The hosted arbitrary-upload model recognizes general COCO objects. The public PCB cases are disclosed cached validation predictions from a separately trained detector until its browser ONNX export is verified. Reported metrics are validation results, not production guarantees, and the frozen test partition remains sealed.
