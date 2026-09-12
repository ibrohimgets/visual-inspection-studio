# Deterministic inspection rules

This milestone applies hand-written, JSON-serializable inspection rules to the
existing detector findings. It does not read PDFs, call an LLM, retrain a
detector, or access the frozen test split.

The machine-readable contract is
[`rule-schema.v1.json`](rule-schema.v1.json). The same contract can later be the
validated output target for PDF/LLM extraction; the engine itself does not need
to change.

## Supported rules

- `defect-class`: map one or more detector labels to an outcome and severity.
- `maximum-defect-count`: act when the number of qualified findings is greater
  than `maximumAllowed`, globally or for selected classes.
- `confidence-review`: ignore evidence below `ignoreBelow`, quarantine
  unconfirmed evidence below `reviewBelow`, and allow stronger evidence into
  class/count evaluation.
- `unsupported`: retain a requirement the current sensors or algorithms cannot
  verify and force a safe `REVIEW` instead of silently dropping it.

Every rule has a stable ID, plain-language description, and severity. Supported
outcomes are `PASS`, `REVIEW`, and `FAIL`; severities are `none`, `info`,
`minor`, `major`, and `critical`.

## Deterministic evaluation order

1. Normalize the schema. Unknown, malformed, and duplicate rules become
   `unsupported` rules.
2. Exclude reviewer-dismissed findings. Reviewer-confirmed findings bypass the
   confidence gate but still pass through class and count rules.
3. Quarantine ambiguous unreviewed findings for human review. Very weak evidence
   below the configured floor is excluded. If overlapping confidence rules
   disagree between excluding and accepting evidence, the engine chooses review.
4. Apply class rules to qualified findings.
5. Apply count limits to the same qualified findings.
6. Resolve every triggered result with `FAIL > REVIEW > PASS`, independent of
   JSON rule order.

The result contains the normalized policy, final outcome, highest triggered
severity, decisive rule IDs, evidence buckets, and an ordered trace. Reports
store the entire result so an operator can see why the image received its
decision.

## Hand-written examples

- [`policies/general-object-demo.json`](policies/general-object-demo.json) is
  connected to the current hosted YOLOX/COCO workflow. It is clearly labelled
  as an object-presence demonstration rather than a PCB quality specification.
- [`policies/pcb-example.json`](policies/pcb-example.json) demonstrates critical
  class rejection, cosmetic allowance, confidence deferral, and a total-defect
  cap. Its limits are examples, not production acceptance criteria.

Typical results from the PCB example:

| Input | Result | Reason |
| --- | --- | --- |
| No findings | `PASS` | No fail or review rule triggers |
| One 92% `SH` finding | `FAIL` | Critical class rule |
| One unreviewed 55% `SH` finding | `REVIEW` | Confidence gate quarantines it before automatic rejection |
| The same 55% finding confirmed by a reviewer | `FAIL` | Confirmation bypasses confidence gating; class rule applies |
| Three strong cosmetic findings | `FAIL` | Total count exceeds the maximum of two, overriding cosmetic `PASS` |
| Unsupported 2 mm measurement requirement | `REVIEW` | No calibrated measurement is available |

Run `npm run rules:examples` to print the scenarios above with their actual
engine decisions. Run `npm test` for executable assertions covering precedence,
confidence, reviewer corrections, count limits, malformed input, unsupported
rules, and report export.
