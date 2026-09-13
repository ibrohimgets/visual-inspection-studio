"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CLASSES, MODEL, createReport, reportCsv, validateImageFile, visibleDetections } from "@/lib/detection";
import type { Detection, ImageInfo, Review, Run } from "@/lib/detection";
import { DEFAULT_DETECTOR } from "@/lib/detectors/registry";
import { evaluateInspection, normalizeInspectionRuleSet, validateInspectionRuleSet } from "@/lib/inspection-rules";
import type { InspectionRule, InspectionRuleSet } from "@/lib/inspection-rules";
import { extractSearchablePdf } from "@/lib/pdf-text";
import { approveInspectionRuleCandidate, verifyExtractedRuleEvidence } from "@/lib/spec-extraction";
import type { RuleExtractionResult, SearchableSpecDocument } from "@/lib/spec-extraction";
import generalObjectDemoPolicy from "@/inspection/policies/general-object-demo.json";

declare global {
  interface Document {
    modelContext?: {
      registerTool: (tool: {
        name: string; title: string; description: string; inputSchema: object;
        annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
        execute: (input: unknown) => unknown;
      }, options?: { signal?: AbortSignal }) => void | Promise<void>;
    };
  }
}

const SAMPLE = { name: "objects-sample.jpg", source: "sample" as const, width: 0, height: 0 };
type WorkspaceMode = "general" | "surface-defect";
type BatchStatus = "queued" | "running" | "complete" | "failed";
type BatchItem = {
  id: number;
  name: string;
  url: string;
  width: number;
  height: number;
  status: BatchStatus;
  run: Run | null;
  error: string;
};
const modeLabel: Record<WorkspaceMode, string> = {
  general: "General Object Detection",
  "surface-defect": "Surface Defect Inspection",
};
const percent = (value: number) => (value * 100).toFixed(1) + "%";
const number = (value: number) => Math.round(value).toLocaleString();
const DEMO_RULE_SET = normalizeInspectionRuleSet(generalObjectDemoPolicy).ruleSet;
const configuredOutcome = (rule: InspectionRule) =>
  rule.type === "confidence-review" || rule.type === "unsupported" ? "REVIEW" : rule.outcome;

export default function Home() {
  const [mode, setMode] = useState<WorkspaceMode>("general");
  const [image, setImage] = useState<ImageInfo>(SAMPLE);
  const [imageUrl, setImageUrl] = useState("/objects-sample.jpg");
  const [ready, setReady] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [threshold, setThreshold] = useState(30);
  const [hiddenClasses, setHiddenClasses] = useState<string[]>([]);
  const [reviewFilter, setReviewFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [boxes, setBoxes] = useState(true);
  const [scope, setScope] = useState("all");
  const [dragging, setDragging] = useState(false);
  const [opening, setOpening] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState("review");
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [activeBatchId, setActiveBatchId] = useState<number | null>(null);
  const [activeRuleSet, setActiveRuleSet] = useState<InspectionRuleSet>(DEMO_RULE_SET);
  const [specDocument, setSpecDocument] = useState<SearchableSpecDocument | null>(null);
  const [ruleCandidate, setRuleCandidate] = useState<RuleExtractionResult | null>(null);
  const [specStatus, setSpecStatus] = useState("");
  const [specError, setSpecError] = useState("");
  const [candidateApproved, setCandidateApproved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const batchInputRef = useRef<HTMLInputElement>(null);
  const specInputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const cropRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const blobRef = useRef<string | null>(null);
  const batchUrlsRef = useRef<string[]>([]);
  const batchIdRef = useRef(1);
  const revision = useRef(0);
  const uploadRevision = useRef(0);
  const pending = useRef<{ reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const busy = phase !== "";
  const items = useMemo(() => run?.detections ?? [], [run]);
  const visible = useMemo(() => visibleDetections(items, threshold, hiddenClasses, reviewFilter), [items, threshold, hiddenClasses, reviewFilter]);
  const inspectionDecision = useMemo(() => run ? evaluateInspection(items, activeRuleSet) : null, [activeRuleSet, items, run]);
  const selected = visible.find(item => item.id === selectedId) ?? null;
  const classes = Array.from(new Set(items.map(item => item.label))).sort();
  const accepted = items.filter(item => item.review === "accepted").length;
  const dismissed = items.filter(item => item.review === "dismissed").length;
  const reviewed = accepted + dismissed;
  const completedBatch = batch.filter(item => item.status === "complete" && item.run);
  const batchDetections = completedBatch.reduce((total, item) => total + (item.run?.detections.filter(detection => detection.confidence * 100 >= threshold).length ?? 0), 0);
  const batchMeanLatency = completedBatch.length
    ? completedBatch.reduce((total, item) => total + (item.run?.inferenceMs ?? 0), 0) / completedBatch.length
    : 0;
  const specBusy = specStatus !== "";
  const activePolicyOrigin = activeRuleSet.rules.some(rule => rule.source.kind === "document") ? "Approved PDF policy" : "Hand-written policy";

  async function extractSpecRules(file?: File) {
    if (!file || specBusy) return;
    setSpecError(""); setRuleCandidate(null); setCandidateApproved(false); setSpecDocument(null);
    setSpecStatus("Reading searchable PDF…");
    try {
      const document = await extractSearchablePdf(file, [...CLASSES]);
      setSpecDocument(document);
      setSpecStatus("Extracting a structured rule candidate…");
      const response = await fetch("/api/specs/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(document),
      });
      const body = await response.json() as RuleExtractionResult & { error?: { code?: string; message?: string } };
      if (!response.ok) throw new Error(body.error?.message || "Rule extraction failed safely.");
      const contract = validateInspectionRuleSet(body.candidate);
      const evidenceIssues = verifyExtractedRuleEvidence(body.candidate, document);
      if (!contract.valid || evidenceIssues.length) throw new Error("The extracted candidate failed local contract or evidence validation.");
      setRuleCandidate(body);
      setNotice(`${body.candidate.rules.length} candidate rules extracted. Approval is still required.`);
    } catch (cause) {
      setRuleCandidate(null);
      setSpecError(cause instanceof Error ? cause.message : "Rule extraction failed safely. No policy was activated.");
    } finally {
      setSpecStatus("");
    }
  }

  async function loadExampleSpec() {
    if (specBusy) return;
    setSpecError(""); setSpecStatus("Loading the example quality specification…");
    try {
      const response = await fetch("/examples/factory-quality-spec-example.pdf", { cache: "no-store" });
      if (!response.ok) throw new Error("The example PDF is unavailable.");
      const blob = await response.blob();
      const file = new File([blob], "factory-quality-spec-example.pdf", { type: "application/pdf" });
      setSpecStatus("");
      await extractSpecRules(file);
    } catch (cause) {
      setSpecStatus("");
      setSpecError(cause instanceof Error ? cause.message : "The example PDF could not be loaded.");
    }
  }

  function approveCandidate() {
    if (!ruleCandidate || !specDocument) return;
    try {
      const approved = approveInspectionRuleCandidate(ruleCandidate.candidate, specDocument);
      setActiveRuleSet(approved);
      setCandidateApproved(true);
      setNotice(`${approved.name} is now the active inspection policy.`);
    } catch (cause) {
      setSpecError(cause instanceof Error ? cause.message : "This candidate could not be approved.");
    }
  }

  function restoreDefaultPolicy() {
    setActiveRuleSet(DEMO_RULE_SET);
    setCandidateApproved(false);
    setNotice("The hand-written demonstration policy is active again.");
  }

  function changeMode(next: WorkspaceMode) {
    if (next === mode || !canReplace()) return;
    clearResults();
    setMode(next);
    setNotice(next === "surface-defect"
      ? "Surface defect mode selected. A trained domain model is required before inference."
      : "General object detection mode selected.");
  }

  useEffect(() => {
    // Cached images can finish loading before hydration attaches onLoad.
    let active = true;
    const element = imageRef.current;
    if (element?.complete && element.naturalWidth) queueMicrotask(() => {
      if (!active) return;
      setImage(current => ({ ...current, width: element.naturalWidth, height: element.naturalHeight }));
      setReady(true);
    });
    return () => { active = false; };
  }, [imageUrl]);

  const cancel = useCallback(() => {
    revision.current++;
    workerRef.current?.terminate(); workerRef.current = null;
    if (pending.current) {
      clearTimeout(pending.current.timer);
      pending.current.reject(new Error("Detection cancelled.")); pending.current = null;
    }
    setPhase("");
  }, []);

  useEffect(() => () => {
    uploadRevision.current++;
    workerRef.current?.terminate();
    if (pending.current) {
      clearTimeout(pending.current.timer); pending.current.reject(new Error("Workspace closed."));
    }
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    batchUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    const canvas = cropRef.current;
    const source = imageRef.current;
    if (!canvas || !source || !selected || !ready) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const padding = Math.max(selected.width, selected.height) * 0.55;
    const x = Math.max(0, selected.x - padding);
    const y = Math.max(0, selected.y - padding);
    const right = Math.min(image.width, selected.x + selected.width + padding);
    const bottom = Math.min(image.height, selected.y + selected.height + padding);
    const cropWidth = Math.max(1, right - x);
    const cropHeight = Math.max(1, bottom - y);
    const scale = Math.min(canvas.width / cropWidth, canvas.height / cropHeight);
    const drawWidth = cropWidth * scale;
    const drawHeight = cropHeight * scale;
    const offsetX = (canvas.width - drawWidth) / 2;
    const offsetY = (canvas.height - drawHeight) / 2;
    context.fillStyle = "#171b20";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, x, y, cropWidth, cropHeight, offsetX, offsetY, drawWidth, drawHeight);
    context.strokeStyle = "#f4b942";
    context.lineWidth = 3;
    context.strokeRect(
      offsetX + (selected.x - x) * scale,
      offsetY + (selected.y - y) * scale,
      selected.width * scale,
      selected.height * scale,
    );
  }, [image.height, image.width, ready, selected]);

  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);

  function clearResults() {
    cancel(); setRun(null); setSelectedId(null); setHiddenClasses([]);
    setReviewFilter("all"); setError(""); setNotice(""); setDirty(false);
  }
  function canReplace() {
    return !dirty || window.confirm("This image has unexported review changes. Replace it and discard those changes?");
  }
  async function chooseFile(file?: File) {
    if (!file) return;
    const problem = validateImageFile(file);
    if (problem) { setError(problem); return; }
    if (!canReplace()) return;
    const ticket = ++uploadRevision.current;
    const url = URL.createObjectURL(file);
    setOpening(true); setError("");
    try {
      const decoded = new Image(); decoded.src = url; await decoded.decode();
      if (ticket !== uploadRevision.current) { URL.revokeObjectURL(url); return; }
      if (decoded.naturalWidth * decoded.naturalHeight > 40_000_000) throw new Error("Choose an image smaller than 40 megapixels.");
      clearResults();
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
      blobRef.current = url;
      setReady(false); setImageUrl(url);
      setImage({ name: file.name, source: "upload", width: decoded.naturalWidth, height: decoded.naturalHeight });
      setActiveBatchId(null);
    } catch (cause) {
      URL.revokeObjectURL(url);
      if (ticket === uploadRevision.current) setError(cause instanceof Error && cause.message.includes("megapixels") ? cause.message : "This image could not be decoded. Try a different PNG, JPEG or WebP.");
    } finally { if (ticket === uploadRevision.current) setOpening(false); }
  }
  function loadSample() {
    if (!canReplace()) return;
    uploadRevision.current++; setOpening(false); clearResults();
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    blobRef.current = null;
    if (imageUrl !== "/objects-sample.jpg") setReady(false);
    setImageUrl("/objects-sample.jpg");
    setImage(imageUrl === "/objects-sample.jpg" ? { ...SAMPLE, width: image.width, height: image.height } : SAMPLE);
    setThreshold(30);
    setActiveBatchId(null);
  }

  async function chooseBatchFiles(files?: FileList | null) {
    const selectedFiles = Array.from(files ?? []);
    if (!selectedFiles.length) return;
    if (batchRunning) { setError("Wait for the current batch to finish before adding images."); return; }
    if (batch.length + selectedFiles.length > 12) { setError("A browser batch can contain up to 12 images."); return; }
    const problem = selectedFiles.map(validateImageFile).find(Boolean);
    if (problem) { setError(problem); return; }
    setOpening(true); setError(""); setNotice("");
    const prepared: BatchItem[] = [];
    try {
      for (const file of selectedFiles) {
        const url = URL.createObjectURL(file);
        try {
          const decoded = new Image(); decoded.src = url; await decoded.decode();
          if (decoded.naturalWidth * decoded.naturalHeight > 40_000_000) throw new Error("Choose images smaller than 40 megapixels.");
          batchUrlsRef.current.push(url);
          prepared.push({ id: batchIdRef.current++, name: file.name, url, width: decoded.naturalWidth,
            height: decoded.naturalHeight, status: "queued", run: null, error: "" });
        } catch (cause) {
          URL.revokeObjectURL(url);
          throw cause;
        }
      }
      setBatch(current => [...current, ...prepared]);
      setNotice(prepared.length + (prepared.length === 1 ? " image added to the batch." : " images added to the batch."));
    } catch (cause) {
      for (const item of prepared) {
        URL.revokeObjectURL(item.url);
        batchUrlsRef.current = batchUrlsRef.current.filter(url => url !== item.url);
      }
      setError(cause instanceof Error ? cause.message : "One of these images could not be opened.");
    } finally { setOpening(false); }
  }

  const inferElement = useCallback(async (
    element: HTMLImageElement,
    ticket: number,
    onStatus: (message: string) => void,
  ) => {
    if (pending.current) throw new Error("An inspection is already running.");
    const started = performance.now();
    onStatus("Preparing image…");
    const canvas = document.createElement("canvas");
    const detector = DEFAULT_DETECTOR;
    const inputSize = detector.input.size;
    canvas.width = inputSize; canvas.height = inputSize;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Image processing is unavailable in this browser.");
    const ratio = Math.min(inputSize / element.naturalWidth, inputSize / element.naturalHeight);
    const drawWidth = Math.floor(element.naturalWidth * ratio);
    const drawHeight = Math.floor(element.naturalHeight * ratio);
    const drawX = detector.input.placement === "center" ? Math.floor((inputSize - drawWidth) / 2) : 0;
    const drawY = detector.input.placement === "center" ? Math.floor((inputSize - drawHeight) / 2) : 0;
    const padding = detector.input.paddingValue;
    context.fillStyle = `rgb(${padding},${padding},${padding})`;
    context.fillRect(0, 0, inputSize, inputSize);
    context.drawImage(element, drawX, drawY, drawWidth, drawHeight);
    const data = detector.preprocess(context.getImageData(0, 0, inputSize, inputSize).data);
    const worker = workerRef.current ?? new Worker("/runtime/inference.worker.js", { type: "module" });
    workerRef.current = worker;
    const result = await new Promise<{ detections: Detection[]; inferenceMs: number }>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.terminate(); workerRef.current = null; pending.current = null;
        reject(new Error("Detection timed out. Try again or reload the page."));
      }, 90_000);
      pending.current = { reject, timer };
      const finish = () => { clearTimeout(timer); pending.current = null; };
      worker.onerror = (event) => {
        console.error("Inference worker failed:", event.message);
        finish(); worker.terminate(); workerRef.current = null;
        reject(new Error("The detection engine could not start. Reload the page and try again."));
      };
      worker.onmessage = event => {
        if (ticket !== revision.current) return;
        if (event.data.type === "status") { onStatus(event.data.message); return; }
        finish();
        if (event.data.type === "error") {
          worker.terminate(); workerRef.current = null; reject(new Error(event.data.message));
        } else resolve(event.data);
      };
      worker.postMessage({ detectorId: detector.id, data, width: element.naturalWidth, height: element.naturalHeight }, [data.buffer]);
    });
    if (ticket !== revision.current) throw new Error("Detection cancelled.");
    return { ...result, totalMs: Math.round(performance.now() - started), completedAt: new Date().toISOString() } satisfies Run;
  }, []);

  const runDetection = useCallback(async () => {
    if (mode !== "general") throw new Error("Surface defect inspection is not configured yet. Train and export a domain-specific model before running it.");
    const element = imageRef.current;
    if (!ready || opening || !element?.naturalWidth) throw new Error("Wait for the image to finish loading.");
    const ticket = ++revision.current;
    setError(""); setNotice(""); setPhase("Preparing image…");
    try {
      const completed = await inferElement(element, ticket, setPhase);
      setRun(completed); setHiddenClasses([]); setReviewFilter("all");
      setSelectedId(completed.detections.find(item => item.confidence * 100 >= threshold)?.id ?? null);
      if (activeBatchId !== null) {
        setBatch(current => current.map(item => item.id === activeBatchId ? { ...item, status: "complete", run: completed, error: "" } : item));
      }
      setDirty(false); setPhase("");
      return completed;
    } catch (cause) {
      if (ticket === revision.current) { setError(cause instanceof Error ? cause.message : "Detection failed."); setPhase(""); }
      throw cause;
    }
  }, [activeBatchId, inferElement, mode, ready, opening, threshold]);

  async function runBatch() {
    if (mode !== "general") { setError("Batch inspection needs a configured detection model."); return; }
    const candidates = batch.filter(item => item.status === "queued" || item.status === "failed");
    if (!candidates.length || batchRunning) return;
    const ticket = ++revision.current;
    setBatchRunning(true); setError(""); setNotice("");
    try {
      for (let index = 0; index < candidates.length; index++) {
        const item = candidates[index];
        if (ticket !== revision.current) break;
        setBatch(current => current.map(entry => entry.id === item.id ? { ...entry, status: "running", error: "" } : entry));
        try {
          const element = new Image(); element.src = item.url; await element.decode();
          const completed = await inferElement(element, ticket, message => setPhase(`Batch ${index + 1}/${candidates.length} · ${message}`));
          setBatch(current => current.map(entry => entry.id === item.id ? { ...entry, status: "complete", run: completed, error: "" } : entry));
        } catch (cause) {
          if (ticket !== revision.current) {
            setBatch(current => current.map(entry => entry.id === item.id ? { ...entry, status: "queued" } : entry));
            break;
          }
          setBatch(current => current.map(entry => entry.id === item.id ? { ...entry, status: "failed", error: cause instanceof Error ? cause.message : "Inspection failed." } : entry));
        }
      }
      if (ticket === revision.current) setNotice("Batch inspection finished. Open any completed image for manual review.");
    } finally {
      setBatchRunning(false); setPhase("");
    }
  }

  function openBatchResult(item: BatchItem) {
    if (!item.run || !canReplace()) return;
    clearResults();
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    blobRef.current = null;
    setReady(false); setImageUrl(item.url);
    setImage({ name: item.name, source: "upload", width: item.width, height: item.height });
    setRun(item.run); setActiveBatchId(item.id);
    setSelectedId(item.run.detections.find(detection => detection.confidence * 100 >= threshold)?.id ?? null);
    setActiveTab("review");
  }

  function clearBatch() {
    if (batchRunning) return;
    if (activeBatchId !== null && !canReplace()) return;
    if (activeBatchId !== null) {
      uploadRevision.current++; setOpening(false); clearResults();
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
      blobRef.current = null; setReady(false); setImageUrl("/objects-sample.jpg"); setImage(SAMPLE); setThreshold(30);
    }
    batchUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    batchUrlsRef.current = [];
    setBatch([]); setActiveBatchId(null); setNotice("Batch cleared.");
  }

  const actionRef = useRef(runDetection);
  useEffect(() => { actionRef.current = runDetection; }, [runDetection]);
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  const activeRuleSetRef = useRef(activeRuleSet);
  useEffect(() => { activeRuleSetRef.current = activeRuleSet; }, [activeRuleSet]);
  useEffect(() => {
    if (!document.modelContext?.registerTool) return;
    const controller = new AbortController();
    const tool = {
      name: "run_object_detection", title: "Run object detection",
      description: "Run the active detection mode on the currently loaded image locally. The surface defect mode fails until a real domain model is configured.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input: unknown) {
        if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) throw new Error("Expected an empty object.");
        if (dirtyRef.current) throw new Error("Export review changes before running detection again.");
        if (modeRef.current !== "general") throw new Error("Surface defect inspection is not configured yet. Train and export a domain-specific model first.");
        const result = await actionRef.current();
        const decision = evaluateInspection(result.detections, activeRuleSetRef.current);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        return { status: "complete", mode: "general-object", model: MODEL.name, candidates: result.detections.length,
          inferenceMs: result.inferenceMs, inspectionOutcome: decision.outcome, severity: decision.severity };
      },
    };
    try { void Promise.resolve(document.modelContext.registerTool(tool, { signal: controller.signal })).catch(() => undefined); }
    catch { /* Unsupported experimental browser registry. */ }
    return () => controller.abort();
  }, []);

  function updateItem(id: number, values: Partial<Pick<Detection, "review" | "note">>) {
    setRun(current => current ? { ...current, detections: current.detections.map(item => item.id === id ? { ...item, ...values } : item) } : null);
    if (activeBatchId !== null) {
      setBatch(batchItems => batchItems.map(item => item.id === activeBatchId && item.run
        ? { ...item, run: { ...item.run, detections: item.run.detections.map(detection => detection.id === id ? { ...detection, ...values } : detection) } }
        : item));
    }
    setDirty(true); setNotice("");
  }
  function downloadFile(contents: string, filename: string, type: string) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  function exportResults(format: "json" | "csv") {
    if (!run) return;
    const report = createReport(image, run, scope === "all" ? items : visible,
      { minimumConfidence: threshold / 100, hiddenClasses, review: reviewFilter }, scope,
      mode === "general" ? "general-object" : "surface-defect", inspectionDecision);
    downloadFile(format === "json" ? JSON.stringify(report, null, 2) : reportCsv(report),
      image.name.replace(/\.[^.]+$/, "") + "-inspection." + format,
      format === "json" ? "application/json" : "text/csv;charset=utf-8");
    if (scope === "all") setDirty(false);
    setNotice((scope === "all" ? items.length : visible.length) + " results exported as " + format.toUpperCase() + ".");
  }

  function exportBatch(format: "json" | "csv") {
    const reports = completedBatch.map(item => createReport(
      { name: item.name, source: "upload", width: item.width, height: item.height },
      item.run as Run,
      (item.run as Run).detections.filter(detection => detection.confidence * 100 >= threshold),
      { minimumConfidence: threshold / 100, hiddenClasses: [], review: "all" },
      "filtered",
      "general-object",
      evaluateInspection((item.run as Run).detections, activeRuleSet),
    ));
    if (!reports.length) return;
    if (format === "json") {
      downloadFile(JSON.stringify({ schemaVersion: 2, reportType: "batch-inspection", exportedAt: new Date().toISOString(),
        summary: { images: reports.length, detections: reports.reduce((total, report) => total + report.detections.length, 0),
          meanInferenceMs: Number(batchMeanLatency.toFixed(2)), minimumConfidence: threshold / 100 }, inspections: reports }, null, 2),
      "inspection-batch.json", "application/json");
    } else {
      const rows = reports.map((report, index) => reportCsv(report).split("\r\n").slice(index === 0 ? 0 : 1).join("\r\n"));
      downloadFile(rows.join("\r\n"), "inspection-batch.csv", "text/csv;charset=utf-8");
    }
    if (activeBatchId !== null) setDirty(false);
    setNotice(reports.length + " completed inspections exported as " + format.toUpperCase() + ".");
  }

  return (
    <main className="studio">
      <header className="app-header">
        <div className="wordmark">Visual Inspection <span>Studio</span></div>
        <div className="header-meta">Local vision · Approved spec rules · Structured reports <span className="version">v0.5</span></div>
      </header>
      <div className="page-heading">
        <div><p className="breadcrumb">Workspace / {modeLabel[mode]}</p><h1>Inspect, review, export</h1><p className="heading-copy">Run a real detector, verify each region, and download an audit-ready report.</p></div>
        <div className="heading-actions">
          <label className="mode-picker"><span>Inspection mode</span><select aria-label="Inspection mode" value={mode} onChange={event => changeMode(event.target.value as WorkspaceMode)}><option value="general">General Object Detection</option><option value="surface-defect">Surface Defect Inspection</option></select></label>
          <Button variant="outline" onClick={loadSample} disabled={opening}>Load sample</Button>
          <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={opening}>{opening ? "Opening image…" : "Upload image"}</Button>
          <Button onClick={() => { if (canReplace()) void runDetection().catch(() => undefined); }} disabled={mode !== "general" || !ready || busy || opening}>{mode !== "general" ? "Model required" : busy ? phase : "Run detection"}</Button>
          {busy && <Button variant="outline" onClick={() => { cancel(); setNotice("Detection cancelled. Previous results retained."); }}>Cancel</Button>}
        </div>
        <input ref={inputRef} type="file" className="sr-only" aria-label="Choose inspection image" accept="image/png,image/jpeg,image/webp"
          onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
      </div>
      {error && <div className="message error" role="alert"><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
      <div className="sr-only" role="status" aria-live="polite">{phase || notice}</div>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="workspace-tabs">
        <div className="tab-bar">
          <TabsList variant="line"><TabsTrigger value="review">Review</TabsTrigger><TabsTrigger value="batch">Batch</TabsTrigger><TabsTrigger value="spec">Quality spec</TabsTrigger><TabsTrigger value="decision">Rules & decision</TabsTrigger><TabsTrigger value="evaluation">Model & performance</TabsTrigger></TabsList>
          <span className="tab-description">{mode === "general" ? <>{MODEL.name} <span className="divider">/</span> Browser inference <span className="divider">/</span> 80 classes</> : <>Domain model required <span className="divider">/</span> No results generated</>}</span>
        </div>
        {mode === "surface-defect" && <div className="mode-banner" role="status"><div><strong>Surface Defect Inspection is not configured</strong><p>This workspace is ready for a trained defect model, but it will not invent scratches, dents, cracks, or rust results. Use General Object Detection for the working YOLOX demo.</p></div><a href="https://github.com/open-edge-platform/anomalib" target="_blank" rel="noreferrer">Review recommended model path</a></div>}
        <TabsContent value="review">
          {mode === "general" && inspectionDecision && <section className={`decision-strip ${inspectionDecision.outcome.toLowerCase()}`} aria-label="Inspection decision">
            <div className="decision-mark"><span>RULE DECISION</span><strong>{inspectionDecision.outcome}</strong><small>{inspectionDecision.severity} severity</small></div>
            <div className="decision-copy"><strong>{inspectionDecision.policy.name}</strong><p>{inspectionDecision.summary}</p></div>
            <button className="text-control" onClick={() => setActiveTab("decision")}>View decision trace</button>
          </section>}
          <div className="workbench">
            <section className="review-main" aria-label="Image and detections">
              <div className="viewer-toolbar">
                <div className="file-heading"><strong title={image.name}>{image.name}</strong><span>{image.source === "sample" ? "Example image" : "Local image"}</span></div>
                <button className="text-control" aria-pressed={boxes} onClick={() => setBoxes(value => !value)}>{boxes ? "Hide boxes" : "Show boxes"}</button>
              </div>
              <div className={"image-viewport" + (dragging ? " drag-active" : "")}
                onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                onDrop={event => { event.preventDefault(); setDragging(false); void chooseFile(event.dataTransfer.files[0]); }}>
                <div className="image-plane" style={{ "--image-ratio": image.width && image.height ? image.width / image.height : 4 / 3 } as CSSProperties}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img ref={imageRef} src={imageUrl} alt={"Inspection image: " + image.name} draggable={false}
                    onLoad={event => { const el = event.currentTarget; setImage(current => ({ ...current, width: el.naturalWidth, height: el.naturalHeight })); setReady(true); }}
                    onError={() => { setReady(false); setError("Unable to load this image. Open another image or reload the sample."); }} />
                  {boxes && visible.map(item => <button key={item.id} className={"bounding-box " + item.review + (selectedId === item.id ? " selected" : "")}
                    aria-label={"Select " + item.label + " " + item.id} aria-pressed={selectedId === item.id} disabled={busy} onClick={() => setSelectedId(item.id)}
                    style={{ left: item.x / image.width * 100 + "%", top: item.y / image.height * 100 + "%", width: item.width / image.width * 100 + "%", height: item.height / image.height * 100 + "%" }}>
                    <span>{String(item.id).padStart(2, "0")} {item.label} <b>{percent(item.confidence)}</b></span>
                  </button>)}
                </div>
                {dragging && <div className="drop-caption">Drop image to inspect</div>}
                {busy && <div className="processing-status" role="status">{phase}</div>}
              </div>
              <div className="viewer-status"><span>{ready ? number(image.width) + " × " + number(image.height) + " px" : "Loading image…"}</span><span>{run ? number(run.inferenceMs) + " ms inference" : "Ready for detection"}</span><span>Fit to view</span></div>
              <div className="results-heading"><h2>Detections <span>{visible.length}</span></h2><span>{run ? reviewed + " / " + items.length + " reviewed" : "No run yet"}</span></div>
              <div className="table-scroll">
                <table className="results-table">
                  <thead><tr><th>ID</th><th>Object</th><th>Confidence</th><th>Region (px)</th><th>Review</th></tr></thead>
                  <tbody>{visible.map(item => <tr key={item.id} className={selected?.id === item.id ? "selected-row" : ""}>
                    <td className="mono">{String(item.id).padStart(2, "0")}</td>
                    <td><button className="object-link" onClick={() => setSelectedId(item.id)} aria-label={"Review " + item.label + " " + item.id} disabled={busy}>{item.label}</button></td>
                    <td className="confidence-cell"><span>{percent(item.confidence)}</span><div aria-hidden="true"><i style={{ width: item.confidence * 100 + "%" }} /></div></td>
                    <td className="mono region-cell">{Math.round(item.x)}, {Math.round(item.y)} · {Math.round(item.width)} × {Math.round(item.height)}</td>
                    <td><span className={"review-label " + item.review}>{item.review === "pending" ? "Unreviewed" : item.review}</span></td>
                  </tr>)}</tbody>
                </table>
                {!visible.length && <div className="table-empty">
                  <strong>{mode === "surface-defect" ? "No defect model configured" : !run ? "Run detection to inspect this image" : !items.length ? "No objects detected" : "No detections match these filters"}</strong>
                  <p>{mode === "surface-defect" ? "This mode will stay empty until a real model trained for the target product is exported and connected." : !run ? "Use the sample or open a PNG, JPEG or WebP. Maximum 20 MB." : !items.length ? "Try an image with people, vehicles, animals or household items." : "Lower the confidence threshold or reset the class and review filters."}</p>
                  {mode === "surface-defect" && <button className="text-control" onClick={() => changeMode("general")}>Switch to general object detection</button>}
                  {mode === "general" && run && !!items.length && <button className="text-control" onClick={() => { setThreshold(10); setHiddenClasses([]); setReviewFilter("all"); }}>Reset filters</button>}
                </div>}
              </div>
            </section>
            <aside className="inspector" aria-label="Detection inspector">
              <div className="inspector-title"><h2>Inspector</h2><span>{selected ? "#" + String(selected.id).padStart(2, "0") : "No selection"}</span></div>
              {mode === "surface-defect" && <section className="inspector-section model-status"><div className="status-kicker">SURFACE DEFECT MODEL</div><h3>Not configured</h3><p>Connect a model trained for this product and camera setup before reviewing defect findings.</p><dl className="properties"><div><dt>Recommended</dt><dd>Anomalib PatchCore / PaDiM</dd></div><div><dt>Input</dt><dd>Customer-approved normal images</dd></div><div><dt>Output</dt><dd>Anomaly map + review region</dd></div></dl><a className="text-control" href="https://github.com/open-edge-platform/anomalib" target="_blank" rel="noreferrer">Model documentation</a></section>}
              {mode === "general" && (selected ? <section className="inspector-section">
                <div className="selected-heading"><h3>{selected.label}</h3><strong className="mono">{percent(selected.confidence)}</strong></div>
                <div className="crop-view"><canvas ref={cropRef} width={640} height={320} aria-label={`Zoomed view of ${selected.label} detection ${selected.id}`} /><span>Region zoom · surrounding context included</span></div>
                <dl className="properties"><div><dt>Source</dt><dd>{MODEL.name}</dd></div><div><dt>Position</dt><dd className="mono">{Math.round(selected.x)}, {Math.round(selected.y)} px</dd></div><div><dt>Dimensions</dt><dd className="mono">{Math.round(selected.width)} × {Math.round(selected.height)} px</dd></div></dl>
                <label className="field-label" htmlFor="review-note">Review note</label>
                <textarea id="review-note" placeholder="Record an observation…" value={selected.note} maxLength={1000} disabled={busy} onChange={event => updateItem(selected.id, { note: event.target.value })} />
                <div className="review-actions">{(["accepted", "dismissed"] as Review[]).map(value => <Button key={value} variant={selected.review === value ? "default" : "outline"} aria-pressed={selected.review === value} disabled={busy} onClick={() => updateItem(selected.id, { review: value })}>{value === "accepted" ? "Accept finding" : "Reject finding"}</Button>)}</div>
                {selected.review !== "pending" && <button className="text-control reset-review" disabled={busy} onClick={() => updateItem(selected.id, { review: "pending" })}>Mark as unreviewed</button>}
              </section> : <section className="inspector-section inspector-empty"><p>{run ? "Select a detection in the image or table to review it." : "Detected objects will appear here after the first run."}</p></section>)}
              <section className="inspector-section filters">
                <div className="section-label"><h3>Display filters</h3><button className="text-control" onClick={() => { setThreshold(30); setHiddenClasses([]); setReviewFilter("all"); }}>Reset</button></div>
                <label className="range-label" htmlFor="confidence">Minimum confidence <output>{threshold}%</output></label>
                <input id="confidence" aria-label="Minimum confidence" type="range" min={10} max={95} step={1} value={threshold} disabled={mode !== "general"} onChange={event => setThreshold(Number(event.target.value))} />
                <div className="range-ends"><span>10%</span><span>95%</span></div>
                <label className="field-label" htmlFor="review-filter">Review status</label>
                <select id="review-filter" disabled={mode !== "general"} value={reviewFilter} onChange={event => setReviewFilter(event.target.value)}><option value="all">All detections</option><option value="pending">Unreviewed</option><option value="accepted">Accepted</option><option value="dismissed">Dismissed</option></select>
                {classes.length > 0 && <fieldset className="class-filter"><legend>Object classes</legend>{classes.map(label => <label key={label}><input type="checkbox" disabled={mode !== "general"} checked={!hiddenClasses.includes(label)} onChange={event => setHiddenClasses(current => event.target.checked ? current.filter(item => item !== label) : [...current, label])} /><span>{label}</span><span className="class-count">{items.filter(item => item.label === label).length}</span></label>)}</fieldset>}
              </section>
              <section className="inspector-section export-section">
                <h3>Export results</h3>
                <label htmlFor="export-scope" className="sr-only">Export scope</label>
                <select id="export-scope" disabled={mode !== "general"} value={scope} onChange={event => setScope(event.target.value)}><option value="all">All detections ({items.length})</option><option value="visible">Filtered view ({visible.length})</option></select>
                <div className="review-actions"><Button variant="outline" disabled={mode !== "general" || !run || busy} onClick={() => exportResults("json")}>Download JSON</Button><Button variant="outline" disabled={mode !== "general" || !run || busy} onClick={() => exportResults("csv")}>Download CSV</Button></div>
                <p className="export-note">{notice || (dirty ? "Review changes have not been exported." : "Includes coordinates, review state, rule outcome, severity, and the full decision trace.")}</p>
              </section>
            </aside>
          </div>
        </TabsContent>
        <TabsContent value="batch" className="batch-workspace">
          <div className="batch-heading">
            <div><p className="breadcrumb">Multi-image inspection</p><h2>Process a production sample</h2><p>Queue up to 12 local images, run one detector pass, then open any result in the same manual-review workspace.</p></div>
            <div className="batch-actions">
              <input ref={batchInputRef} type="file" className="sr-only" aria-label="Choose batch images" accept="image/png,image/jpeg,image/webp" multiple
                onChange={event => { void chooseBatchFiles(event.target.files); event.target.value = ""; }} />
              <Button variant="outline" onClick={() => batchInputRef.current?.click()} disabled={opening || batchRunning || batch.length >= 12}>Add images</Button>
              <Button onClick={() => void runBatch()} disabled={mode !== "general" || batchRunning || !batch.some(item => item.status === "queued" || item.status === "failed")}>{batchRunning ? phase || "Running batch…" : "Run batch"}</Button>
              {batchRunning && <Button variant="outline" onClick={() => cancel()}>Cancel</Button>}
            </div>
          </div>
          <div className="batch-summary" aria-label="Batch summary">
            <div><span>Queued images</span><strong>{batch.length}</strong></div>
            <div><span>Completed</span><strong>{completedBatch.length}</strong></div>
            <div><span>Visible findings</span><strong>{batchDetections}</strong></div>
            <div><span>Mean inference</span><strong>{completedBatch.length ? number(batchMeanLatency) + " ms" : "—"}</strong></div>
          </div>
          {batch.length ? <>
            <div className="batch-table-scroll"><table className="batch-table"><thead><tr><th>Image</th><th>Status</th><th>Findings ≥ {threshold}%</th><th>Decision</th><th>Inference</th><th>Action</th></tr></thead>
              <tbody>{batch.map(item => {
                const decision = item.run ? evaluateInspection(item.run.detections, activeRuleSet) : null;
                return <tr key={item.id}><td><strong title={item.name}>{item.name}</strong><span>{number(item.width)} × {number(item.height)} px</span></td><td><span className={`batch-status ${item.status}`}>{item.status === "complete" ? "Complete" : item.status === "running" ? "Inspecting" : item.status === "failed" ? "Needs retry" : "Queued"}</span>{item.error && <small title={item.error}>{item.error}</small>}</td><td className="mono">{item.run ? item.run.detections.filter(detection => detection.confidence * 100 >= threshold).length : "—"}</td><td>{decision ? <span className={`decision-badge ${decision.outcome.toLowerCase()}`}>{decision.outcome}</span> : "—"}</td><td className="mono">{item.run ? number(item.run.inferenceMs) + " ms" : "—"}</td><td><Button variant="outline" size="sm" disabled={!item.run || batchRunning} onClick={() => openBatchResult(item)}>Open review</Button></td></tr>;
              })}</tbody>
            </table></div>
            <div className="batch-footer"><p>Exports include image metadata, coordinates, confidence, timing, reviewer corrections, and the deterministic rule decision.</p><div><Button variant="outline" disabled={!completedBatch.length || batchRunning} onClick={() => exportBatch("json")}>Download batch JSON</Button><Button variant="outline" disabled={!completedBatch.length || batchRunning} onClick={() => exportBatch("csv")}>Download batch CSV</Button><Button variant="outline" disabled={batchRunning} onClick={clearBatch}>Clear batch</Button></div></div>
          </> : <div className="batch-empty"><strong>No images queued</strong><p>Add PNG, JPEG, or WebP images. Processing stays in this browser; files are not uploaded to a server.</p><Button onClick={() => batchInputRef.current?.click()}>Choose images</Button></div>}
        </TabsContent>
        <TabsContent value="spec" className="spec-workspace">
          <div className="spec-heading">
            <div><p className="breadcrumb">Specification intake</p><h2>Turn a quality PDF into reviewable rules</h2><p>Upload a searchable PDF. Its text is extracted in the browser, the configured LLM proposes structured rules, AJV validates them, and a person must approve the candidate before it can affect inspection decisions.</p></div>
            <div className="spec-actions">
              <input ref={specInputRef} type="file" className="sr-only" aria-label="Choose quality specification PDF" accept="application/pdf,.pdf"
                onChange={event => { void extractSpecRules(event.target.files?.[0]); event.target.value = ""; }} />
              <Button variant="outline" onClick={() => void loadExampleSpec()} disabled={specBusy}>{specBusy ? specStatus : "Run example PDF"}</Button>
              <Button onClick={() => specInputRef.current?.click()} disabled={specBusy}>{specBusy ? "Processing…" : "Upload quality PDF"}</Button>
            </div>
          </div>
          <div className="spec-flow" aria-label="Specification processing steps">
            <div className={specDocument ? "complete" : "active"}><span>01</span><strong>Read PDF</strong><small>Searchable text only</small></div>
            <div className={ruleCandidate ? "complete" : specDocument ? "active" : ""}><span>02</span><strong>Extract rules</strong><small>Strict model JSON</small></div>
            <div className={ruleCandidate ? "complete" : ""}><span>03</span><strong>Validate</strong><small>Schema + evidence</small></div>
            <div className={candidateApproved ? "complete" : ruleCandidate ? "active" : ""}><span>04</span><strong>Human approval</strong><small>Never automatic</small></div>
          </div>
          {specError && <div className="spec-alert error" role="alert"><strong>Candidate not activated</strong><p>{specError}</p></div>}
          {specStatus && <div className="spec-alert" role="status"><strong>Processing document</strong><p>{specStatus}</p></div>}
          <div className="spec-grid">
            <section className="spec-document-panel">
              <div className="panel-heading"><div><span>SOURCE DOCUMENT</span><h3>{specDocument?.fileName ?? "No PDF loaded"}</h3></div>{specDocument && <span>{specDocument.pages.length} page{specDocument.pages.length === 1 ? "" : "s"}</span>}</div>
              {specDocument ? <>
                <dl className="properties spec-properties"><div><dt>Document fingerprint</dt><dd title={specDocument.documentId}>{specDocument.documentId.slice(0, 18)}…</dd></div><div><dt>Selectable text</dt><dd>{number(specDocument.pages.reduce((total, page) => total + page.text.length, 0))} characters</dd></div><div><dt>Detector vocabulary</dt><dd>{specDocument.supportedClasses.length} labels supplied</dd></div></dl>
                <p className="spec-privacy">The PDF is parsed locally. Only extracted, page-labelled text is sent through this application&apos;s server to the configured OpenAI model. Images are not sent with the specification.</p>
              </> : <div className="spec-empty"><strong>Searchable PDFs only</strong><p>Scanned-image PDFs, password-protected files, and documents over 25 pages are rejected in this first version.</p></div>}
            </section>
            <section className="spec-candidate-panel">
              <div className="panel-heading"><div><span>RULE CANDIDATE</span><h3>{ruleCandidate?.candidate.name ?? "Waiting for extraction"}</h3></div>{ruleCandidate && <span>{ruleCandidate.candidate.rules.length} rules</span>}</div>
              {ruleCandidate ? <>
                <div className="validation-row"><span className="validation-badge valid">AJV contract valid</span><span className="validation-badge valid">Evidence verified</span><span className={`validation-badge ${candidateApproved ? "active" : "pending"}`}>{candidateApproved ? "Approved and active" : "Approval required"}</span></div>
                <dl className="properties spec-properties"><div><dt>Model</dt><dd>{ruleCandidate.provider.model}</dd></div><div><dt>Extraction latency</dt><dd>{number(ruleCandidate.provider.latencyMs)} ms</dd></div><div><dt>Token usage</dt><dd>{ruleCandidate.provider.usage.totalTokens ?? "Not reported"}</dd></div></dl>
              </> : <div className="spec-empty"><strong>No generated policy is active</strong><p>Loading or uploading a PDF creates a candidate only. The current hand-written policy remains unchanged until approval.</p></div>}
            </section>
          </div>
          {ruleCandidate && <section className="candidate-review-panel">
            <div className="panel-heading"><div><span>HUMAN REVIEW GATE</span><h3>Verify each requirement against its source</h3></div><span>{candidateApproved ? "Policy active" : "Not active"}</span></div>
            <ol className="candidate-rules">{ruleCandidate.candidate.rules.map(rule => <li key={rule.id}>
              <div className="candidate-rule-heading"><div><span className="mono">{rule.id}</span><strong>{rule.description}</strong></div><span className={`decision-badge ${configuredOutcome(rule).toLowerCase()}`}>{configuredOutcome(rule)}</span></div>
              <div className="candidate-rule-meta"><span>{rule.type}</span><span>{rule.severity} severity</span><span>Page {rule.source.page}</span></div>
              <blockquote>{rule.source.evidence}</blockquote>
              {rule.type === "unsupported" && <p className="unsupported-reason"><strong>Requires review:</strong> {rule.reason}</p>}
            </li>)}</ol>
            <div className="candidate-actions">
              <p>{candidateApproved ? "This approved policy now controls deterministic PASS / FAIL / REVIEW outcomes. The LLM is no longer involved." : "Approval copies this validated candidate into the deterministic engine. It does not rerun the model or make an image decision."}</p>
              <div>
                <Button variant="outline" onClick={() => downloadFile(JSON.stringify(ruleCandidate.candidate, null, 2), `${ruleCandidate.candidate.id}.json`, "application/json")}>Download candidate JSON</Button>
                {!candidateApproved && <Button variant="outline" onClick={() => { setRuleCandidate(null); setSpecDocument(null); setSpecError(""); }}>Discard candidate</Button>}
                {candidateApproved ? <Button variant="outline" onClick={restoreDefaultPolicy}>Restore default policy</Button> : <Button onClick={approveCandidate}>Approve &amp; activate policy</Button>}
              </div>
            </div>
          </section>}
        </TabsContent>
        <TabsContent value="decision" className="decision-workspace">
          <div className="decision-heading"><div><p className="breadcrumb">Deterministic inspection logic</p><h2>Rules & decision trace</h2><p>Detector findings are qualified, evaluated, and resolved with the same validated policy on every run. Display filters and the LLM never make the final inspection decision.</p></div><span className="policy-version">Schema v{activeRuleSet.schemaVersion} · Policy {activeRuleSet.version}</span></div>
          <div className="decision-grid">
            <section className="policy-panel"><div className="panel-heading"><div><span>ACTIVE {activePolicyOrigin.toUpperCase()}</span><h3>{activeRuleSet.name}</h3></div><div className="policy-panel-actions"><span>{activeRuleSet.rules.length} rules</span>{activePolicyOrigin === "Approved PDF policy" && <Button variant="outline" size="sm" onClick={restoreDefaultPolicy}>Restore default</Button>}</div></div><p className="policy-note">{activeRuleSet.description}</p>
              <ol className="policy-rules">{activeRuleSet.rules.map(rule => <li key={rule.id}><div><strong>{rule.description}</strong><span className="mono">{rule.id}</span></div><div><span className={`decision-badge ${configuredOutcome(rule).toLowerCase()}`}>{configuredOutcome(rule)}</span><small>{rule.type} · {rule.severity}</small></div></li>)}</ol>
            </section>
            <section className="live-decision-panel"><div className="panel-heading"><div><span>CURRENT IMAGE</span><h3>Inspection disposition</h3></div></div>
              {inspectionDecision ? <><div className={`large-decision ${inspectionDecision.outcome.toLowerCase()}`}><span>{inspectionDecision.outcome}</span><small>{inspectionDecision.severity} severity</small></div><p>{inspectionDecision.summary}</p><dl className="properties decision-properties"><div><dt>Actionable findings</dt><dd>{inspectionDecision.evidence.actionableDetectionIds.length}</dd></div><div><dt>Waiting for review</dt><dd>{inspectionDecision.evidence.reviewDetectionIds.length}</dd></div><div><dt>Excluded findings</dt><dd>{inspectionDecision.evidence.excludedDetectionIds.length}</dd></div><div><dt>Precedence</dt><dd>FAIL › REVIEW › PASS</dd></div></dl></> : <div className="decision-empty"><strong>No decision yet</strong><p>Run detection to evaluate the current image against this policy.</p></div>}
            </section>
          </div>
          {inspectionDecision && <section className="trace-panel"><div className="panel-heading"><div><span>ORDERED AUDIT TRAIL</span><h3>Why this image is {inspectionDecision.outcome.toLowerCase()}</h3></div><span>{inspectionDecision.trace.length} steps</span></div>
            <ol className="decision-trace">{inspectionDecision.trace.map(entry => <li key={entry.step} className={entry.status}><span className="trace-step">{String(entry.step).padStart(2, "0")}</span><div><div className="trace-title"><strong>{entry.code.replaceAll("_", " ")}</strong><span className={`decision-badge ${entry.outcome.toLowerCase()}`}>{entry.outcome}</span><span className="severity-label">{entry.severity}</span></div><p>{entry.message}</p><small>{entry.ruleId ? `Rule ${entry.ruleId}` : "Engine decision"}{entry.detectionIds.length ? ` · Findings ${entry.detectionIds.map(id => "#" + id).join(", ")}` : ""}</small></div></li>)}</ol>
          </section>}
        </TabsContent>
        <TabsContent value="evaluation" className="evaluation">
          <div className="evaluation-heading"><p className="breadcrumb">Operational evidence</p><h2>Model & performance</h2><p>Live runtime statistics are separated from validation metrics so a client can see what is measured and what is not.</p></div>
          <div className="evaluation-grid"><section><h3>Current browser run</h3><dl className="properties">
            <div><dt>Model</dt><dd>{mode === "general" ? MODEL.name + " / " + MODEL.version : "Not configured"}</dd></div>
            <div><dt>Input resolution</dt><dd>416 × 416</dd></div>
            <div><dt>Inference</dt><dd>{mode === "general" && run ? number(run.inferenceMs) + " ms" : "Not run"}</dd></div>
            <div><dt>Total processing</dt><dd>{mode === "general" && run ? number(run.totalMs) + " ms" : "Not run"}</dd></div>
            <div><dt>Completed</dt><dd>{mode === "general" && run ? new Date(run.completedAt).toLocaleString() : "Not run"}</dd></div>
            <div><dt>Review decisions</dt><dd>{mode === "general" ? accepted + " accepted / " + dismissed + " dismissed" : "Not available"}</dd></div>
            <div><dt>Rule decision</dt><dd>{mode === "general" && inspectionDecision ? inspectionDecision.outcome + " / " + inspectionDecision.severity : "Not run"}</dd></div>
          </dl><p className="secondary-copy">Total processing includes model loading on the first run. Images remain local to this device.</p></section>
          <section><h3>PCB detector validation</h3><div className="metric-grid"><div><span>Precision</span><strong>69.9%</strong></div><div><span>Recall</span><strong>66.2%</strong></div><div><span>F1</span><strong>68.0%</strong></div><div><span>mAP@0.5</span><strong>69.4%</strong></div></div>
            <p className="secondary-copy">YOLOX-Nano trained on 7,357 DsPCBSD+ training images and measured on 851 validation images. The frozen test split remains sealed.</p>
            <h3 className="model-scope-title">Precision-first profile</h3><p>Class-specific thresholds raise validation precision to 77.0% and F1 to 70.2%, with recall at 64.5%. This profile is available for stricter QA triage; it is not applied to the general COCO demo above.</p>
          </section>
          <section><h3>Client model integration</h3><p>The review console is intentionally separated from the detector. A client-specific ONNX detector can replace the model while keeping upload, boxes, zoom, confidence controls, review decisions, batch processing, and exports.</p><a className="text-control" href="https://github.com/ibrohimgets/visual-inspection-studio#adapt-it-to-a-client-dataset" target="_blank" rel="noreferrer">See the detector integration workflow</a></section>
          <section><h3>Known limits</h3><p>The hosted model recognizes 80 everyday COCO categories, not PCB defects. The trained PCB checkpoint is evaluated offline and is not presented as browser inference until its export is verified. Prior Terra routing is retained as a negative baseline and adds no accuracy claim.</p><a className="text-control" href={MODEL.source} target="_blank" rel="noreferrer">YOLOX model documentation</a></section></div>
        </TabsContent>
      </Tabs>
      <footer className="app-footer"><span>Image inference stays on-device. PDF text is sent to the configured LLM only when you request rule extraction.</span><span>YOLOX-Nano · PDF.js · AJV</span></footer>
    </main>
  );
}
