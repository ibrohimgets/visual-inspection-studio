# Governed inspection rules

This directory contains the versioned contract that separates probabilistic
document extraction from deterministic image decisions.

The runtime boundary is [`rule-schema.v1.json`](rule-schema.v1.json). AJV
compiles it into `lib/generated/rule-schema-validator.mjs`; both generated
validators are checked before every production build. A policy cannot enter the
inspection engine unless it conforms to this schema.

## PDF-to-policy safety boundary

The first document workflow is intentionally narrow:

1. PDF.js extracts selectable text and page numbers in the browser.
2. The server sends page-labelled text and the detector's supported classes to
   the configured OpenAI model.
3. The model must return strict JSON matching
   [`spec-extraction-output-schema.v1.json`](spec-extraction-output-schema.v1.json).
4. The adapter materializes that output as `rule-schema.v1.json`.
5. AJV validates the candidate and evidence verification confirms every excerpt
   occurs on the declared page of the fingerprinted PDF.
6. The UI shows the candidate, source page, evidence, and unsupported reason.
7. Only an explicit human approval copies the candidate into the active policy.
8. The existing rule engine evaluates detector findings. The LLM is not called
   during `PASS`, `FAIL`, or `REVIEW` resolution.

Generated candidates are never activated automatically. Unknown detector
classes, physical measurements, missing capabilities, malformed rules,
ambiguous statements, and evidence mismatches fail closed. Representable but
unsupported requirements become explicit `unsupported` rules, which force
`REVIEW`; invalid contracts cannot be approved at all.

This version accepts searchable PDFs only. It rejects scanned/image-only PDFs,
encrypted or malformed files, more than 25 pages, more than 10 MB, over 15,000
characters on one page, or over 80,000 characters total. OCR and table-layout
reconstruction are outside the MVP.

## Supported runtime rules

- `defect-class`: map one or more detector labels to an outcome and severity.
- `maximum-defect-count`: act when qualified findings exceed
  `maximumAllowed`, globally or for selected classes.
- `confidence-review`: ignore evidence below `ignoreBelow`, quarantine
  unconfirmed evidence below `reviewBelow`, and allow stronger evidence into
  class/count evaluation.
- `unsupported`: preserve a requirement that the current sensor, detector, or
  engine cannot verify and force a safe `REVIEW`.

Each rule has a stable ID, description, severity, and source record. A
document-derived rule additionally carries the PDF SHA-256 fingerprint, source
page, and exact evidence. Outcomes are `PASS`, `REVIEW`, and `FAIL`; severities
are `none`, `info`, `minor`, `major`, and `critical`.

## Deterministic evaluation order

1. Normalize defensive input and enforce the runtime schema.
2. Exclude reviewer-dismissed findings. Reviewer-confirmed findings bypass the
   confidence gate but still pass through class and count rules.
3. Quarantine ambiguous unreviewed findings. Exclude evidence below the
   configured floor. If confidence rules conflict, choose review.
4. Apply class rules to qualified findings.
5. Apply count limits to the same qualified findings.
6. Treat every active unsupported requirement as review evidence.
7. Resolve all triggered results with `FAIL > REVIEW > PASS`, independently of
   JSON rule order.

The result includes the normalized policy, final outcome, highest severity,
decisive rule IDs, evidence buckets, and ordered trace. JSON and CSV reports
retain that trace so an operator can audit the decision.

## Shipped examples

- [`policies/general-object-demo.json`](policies/general-object-demo.json) is
  connected to the browser YOLOX/COCO workflow. It is an object-presence demo,
  not a PCB quality specification.
- [`policies/pcb-example.json`](policies/pcb-example.json) demonstrates critical
  rejection, cosmetic allowance, confidence deferral, and a total-defect cap.
  Its limits are examples, not production acceptance criteria.
- [`factory-quality-spec-example.pdf`](../output/pdf/factory-quality-spec-example.pdf)
  is the searchable two-page input for the governed end-to-end demo.

Typical PCB-policy results:

| Input | Result | Reason |
| --- | --- | --- |
| No findings | `PASS` | No fail or review rule triggers |
| One 92% `SH` finding | `FAIL` | Critical class rule |
| One unreviewed 55% `SH` finding | `REVIEW` | Confidence gate quarantines it |
| The same 55% finding confirmed | `FAIL` | Confirmation bypasses confidence gating; class rule applies |
| Three strong cosmetic findings | `FAIL` | Count exceeds two and overrides cosmetic `PASS` |
| Unsupported 2 mm measurement | `REVIEW` | No calibrated measurement is available |

## Verification

```bash
npm run schema:check
npm run rules:examples
npm test
```

With a server-side `OPENAI_API_KEY`, `npm run spec:example` extracts the shipped
PDF, validates its evidence, performs an explicit harness approval, and sends a
synthetic detector finding through the unchanged rule engine. The output is
written only under ignored `reports/local/`.

Relevant automated tests cover direct AJV rejection, strict structured output,
extra-field rejection, searchable-document limits, unsupported-class routing,
evidence tampering, the approval boundary, precedence, reviewer corrections,
count limits, and report export.
