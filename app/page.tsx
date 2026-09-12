"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { INPUT_SIZE, MODEL, createReport, reportCsv, rgbaToBgr, validateImageFile, visibleDetections } from "@/lib/detection";
import type { Detection, ImageInfo, Review, Run } from "@/lib/detection";

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
const modeLabel: Record<WorkspaceMode, string> = {
  general: "General Object Detection",
  "surface-defect": "Surface Defect Inspection",
};
const percent = (value: number) => (value * 100).toFixed(1) + "%";
const number = (value: number) => Math.round(value).toLocaleString();

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
  const inputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const blobRef = useRef<string | null>(null);
  const revision = useRef(0);
  const uploadRevision = useRef(0);
  const pending = useRef<{ reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const busy = phase !== "";
  const items = useMemo(() => run?.detections ?? [], [run]);
  const visible = useMemo(() => visibleDetections(items, threshold, hiddenClasses, reviewFilter), [items, threshold, hiddenClasses, reviewFilter]);
  const selected = visible.find(item => item.id === selectedId) ?? null;
  const classes = Array.from(new Set(items.map(item => item.label))).sort();
  const accepted = items.filter(item => item.review === "accepted").length;
  const dismissed = items.filter(item => item.review === "dismissed").length;
  const reviewed = accepted + dismissed;

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
  }, []);

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
  }

  const runDetection = useCallback(async () => {
    if (mode !== "general") throw new Error("Surface defect inspection is not configured yet. Train and export a domain-specific model before running it.");
    if (pending.current) throw new Error("An inspection is already running.");
    const element = imageRef.current;
    if (!ready || opening || !element?.naturalWidth) throw new Error("Wait for the image to finish loading.");
    const ticket = ++revision.current;
    const started = performance.now();
    setError(""); setNotice(""); setPhase("Preparing image…");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = INPUT_SIZE; canvas.height = INPUT_SIZE;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Image processing is unavailable in this browser.");
      const ratio = Math.min(INPUT_SIZE / element.naturalWidth, INPUT_SIZE / element.naturalHeight);
      context.fillStyle = "rgb(114,114,114)"; context.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
      context.drawImage(element, 0, 0, Math.floor(element.naturalWidth * ratio), Math.floor(element.naturalHeight * ratio));
      const data = rgbaToBgr(context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data);
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
          if (event.data.type === "status") { setPhase(event.data.message); return; }
          finish();
          if (event.data.type === "error") {
            worker.terminate(); workerRef.current = null; reject(new Error(event.data.message));
          } else resolve(event.data);
        };
        worker.postMessage({ data, width: element.naturalWidth, height: element.naturalHeight }, [data.buffer]);
      });
      if (ticket !== revision.current) throw new Error("Detection cancelled.");
      const completed: Run = { ...result, totalMs: Math.round(performance.now() - started), completedAt: new Date().toISOString() };
      setRun(completed); setHiddenClasses([]); setReviewFilter("all");
      setSelectedId(result.detections.find(item => item.confidence * 100 >= threshold)?.id ?? null);
      setDirty(false); setPhase("");
      return completed;
    } catch (cause) {
      if (ticket === revision.current) { setError(cause instanceof Error ? cause.message : "Detection failed."); setPhase(""); }
      throw cause;
    }
  }, [mode, ready, opening, threshold]);

  const actionRef = useRef(runDetection);
  useEffect(() => { actionRef.current = runDetection; }, [runDetection]);
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);
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
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        return { status: "complete", mode: "general-object", model: MODEL.name, candidates: result.detections.length, inferenceMs: result.inferenceMs };
      },
    };
    try { void Promise.resolve(document.modelContext.registerTool(tool, { signal: controller.signal })).catch(() => undefined); }
    catch { /* Unsupported experimental browser registry. */ }
    return () => controller.abort();
  }, []);

  function updateItem(id: number, values: Partial<Pick<Detection, "review" | "note">>) {
    setRun(current => current ? { ...current, detections: current.detections.map(item => item.id === id ? { ...item, ...values } : item) } : null);
    setDirty(true); setNotice("");
  }
  function exportResults(format: "json" | "csv") {
    if (!run) return;
    const report = createReport(image, run, scope === "all" ? items : visible, { minimumConfidence: threshold / 100, hiddenClasses, review: reviewFilter }, scope, mode === "general" ? "general-object" : "surface-defect");
    const url = URL.createObjectURL(new Blob([format === "json" ? JSON.stringify(report, null, 2) : reportCsv(report)], {
      type: format === "json" ? "application/json" : "text/csv;charset=utf-8",
    }));
    const anchor = document.createElement("a"); anchor.href = url;
    anchor.download = image.name.replace(/\.[^.]+$/, "") + "-inspection." + format;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    if (scope === "all") setDirty(false);
    setNotice((scope === "all" ? items.length : visible.length) + " results exported as " + format.toUpperCase() + ".");
  }

  return (
    <main className="studio">
      <header className="app-header">
        <div className="wordmark">Visual Inspection <span>Studio</span></div>
        <div className="header-meta">Computer vision workspace <span className="version">v0.2</span></div>
      </header>
      <div className="page-heading">
        <div><p className="breadcrumb">Workspace / {modeLabel[mode]}</p><h1>Inspection review</h1></div>
        <div className="heading-actions">
          <label className="mode-picker"><span>Inspection mode</span><select aria-label="Inspection mode" value={mode} onChange={event => changeMode(event.target.value as WorkspaceMode)}><option value="general">General Object Detection</option><option value="surface-defect">Surface Defect Inspection</option></select></label>
          <Button variant="outline" onClick={loadSample} disabled={opening}>Load sample</Button>
          <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={opening}>{opening ? "Opening image…" : "Open image"}</Button>
          <Button onClick={() => { if (canReplace()) void runDetection().catch(() => undefined); }} disabled={mode !== "general" || !ready || busy || opening}>{mode !== "general" ? "Model required" : busy ? phase : "Run detection"}</Button>
          {busy && <Button variant="outline" onClick={() => { cancel(); setNotice("Detection cancelled. Previous results retained."); }}>Cancel</Button>}
        </div>
        <input ref={inputRef} type="file" className="sr-only" aria-label="Choose inspection image" accept="image/png,image/jpeg,image/webp"
          onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
      </div>
      {error && <div className="message error" role="alert"><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
      <div className="sr-only" role="status" aria-live="polite">{phase || notice}</div>
      <Tabs defaultValue="review" className="workspace-tabs">
        <div className="tab-bar">
          <TabsList variant="line"><TabsTrigger value="review">Review</TabsTrigger><TabsTrigger value="evaluation">Evaluation</TabsTrigger></TabsList>
          <span className="tab-description">{mode === "general" ? <>{MODEL.name} <span className="divider">/</span> Browser inference <span className="divider">/</span> 80 classes</> : <>Domain model required <span className="divider">/</span> No results generated</>}</span>
        </div>
        {mode === "surface-defect" && <div className="mode-banner" role="status"><div><strong>Surface Defect Inspection is not configured</strong><p>This workspace is ready for a trained defect model, but it will not invent scratches, dents, cracks, or rust results. Use General Object Detection for the working YOLOX demo.</p></div><a href="https://github.com/open-edge-platform/anomalib" target="_blank" rel="noreferrer">Review recommended model path</a></div>}
        <TabsContent value="review">
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
                <dl className="properties"><div><dt>Source</dt><dd>{MODEL.name}</dd></div><div><dt>Position</dt><dd className="mono">{Math.round(selected.x)}, {Math.round(selected.y)} px</dd></div><div><dt>Dimensions</dt><dd className="mono">{Math.round(selected.width)} × {Math.round(selected.height)} px</dd></div></dl>
                <label className="field-label" htmlFor="review-note">Review note</label>
                <textarea id="review-note" placeholder="Record an observation…" value={selected.note} maxLength={1000} disabled={busy} onChange={event => updateItem(selected.id, { note: event.target.value })} />
                <div className="review-actions">{(["accepted", "dismissed"] as Review[]).map(value => <Button key={value} variant={selected.review === value ? "default" : "outline"} aria-pressed={selected.review === value} disabled={busy} onClick={() => updateItem(selected.id, { review: value })}>{value === "accepted" ? "Accept" : "Dismiss"}</Button>)}</div>
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
                <div className="review-actions"><Button variant="outline" disabled={mode !== "general" || !run || busy} onClick={() => exportResults("json")}>Export JSON</Button><Button variant="outline" disabled={mode !== "general" || !run || busy} onClick={() => exportResults("csv")}>Export CSV</Button></div>
                <p className="export-note">{notice || (dirty ? "Review changes have not been exported." : "Includes image metadata, coordinates and review decisions.")}</p>
              </section>
            </aside>
          </div>
        </TabsContent>
        <TabsContent value="evaluation" className="evaluation">
          <div className="evaluation-heading"><p className="breadcrumb">Model & run details</p><h2>Measured results</h2><p>{mode === "general" ? "Inference timing and review counts come from the current image." : "The defect mode reports setup status until a real domain model is connected."}</p></div>
          <div className="evaluation-grid"><section><h3>Current run</h3><dl className="properties">
            <div><dt>Model</dt><dd>{mode === "general" ? MODEL.name + " / " + MODEL.version : "Not configured"}</dd></div>
            <div><dt>Input resolution</dt><dd>416 × 416</dd></div>
            <div><dt>Inference</dt><dd>{mode === "general" && run ? number(run.inferenceMs) + " ms" : "Not run"}</dd></div>
            <div><dt>Total processing</dt><dd>{mode === "general" && run ? number(run.totalMs) + " ms" : "Not run"}</dd></div>
            <div><dt>Completed</dt><dd>{mode === "general" && run ? new Date(run.completedAt).toLocaleString() : "Not run"}</dd></div>
            <div><dt>Review decisions</dt><dd>{mode === "general" ? accepted + " accepted / " + dismissed + " dismissed" : "Not available"}</dd></div>
          </dl><p className="secondary-copy">Total processing includes initial model loading when needed. Review decisions are observations, not measured model accuracy.</p></section>
          <section><h3>Accuracy evaluation</h3><p>No project validation dataset has been evaluated yet. Precision, recall and mAP will remain unreported until there are labelled ground-truth images and a reproducible evaluation.</p>
            <h3 className="model-scope-title">{mode === "general" ? "Model scope" : "Defect model plan"}</h3><p>{mode === "general" ? "The pretrained COCO model detects 80 everyday object categories. It does not detect scratches, dents or manufacturing defects. Those tasks require domain-specific training." : "Recommended next step: train Anomalib PatchCore or PaDiM on approved normal images, validate anomaly localization on labelled defects, then export a browser-compatible model. No defect result is generated before that step."}</p>
            <a className="text-control" href={mode === "general" ? MODEL.source : "https://github.com/open-edge-platform/anomalib"} target="_blank" rel="noreferrer">{mode === "general" ? "YOLOX source and model documentation" : "Anomalib model documentation"}</a>
          </section></div>
        </TabsContent>
      </Tabs>
      <footer className="app-footer"><span>Images are processed on this device. Export your results before leaving.</span><span>YOLOX-Nano · Apache-2.0</span></footer>
    </main>
  );
}
