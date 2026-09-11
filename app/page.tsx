"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Box,
  Check,
  ChevronDown,
  Download,
  Gauge,
  ImagePlus,
  Layers3,
  Play,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Detection = {
  id: number;
  label: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
};

declare global {
  interface Document {
    modelContext?: {
      registerTool: (
        tool: {
          name: string;
          title: string;
          description: string;
          inputSchema: object;
          annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
          execute: (input: unknown) => unknown;
        },
        options?: { signal?: AbortSignal },
      ) => void | Promise<void>;
    };
  }
}

const detections: Detection[] = [
  { id: 1, label: "Scratch", confidence: 0.94, x: 23, y: 29, width: 22, height: 18, color: "#ffb547" },
  { id: 2, label: "Dent", confidence: 0.87, x: 55, y: 61, width: 14, height: 18, color: "#38d9c5" },
  { id: 3, label: "Oxidation", confidence: 0.72, x: 77, y: 42, width: 10, height: 12, color: "#f87171" },
];

const metrics = [
  { label: "Precision", value: "92.4%", note: "validation set" },
  { label: "Recall", value: "89.1%", note: "validation set" },
  { label: "F1 score", value: "90.7%", note: "validation set" },
  { label: "Avg latency", value: "84 ms", note: "p95 · 102 ms" },
];

export default function Home() {
  const [threshold, setThreshold] = useState([65]);
  const [imageUrl, setImageUrl] = useState("/synthetic-metal-inspection.png");
  const [fileName, setFileName] = useState("synthetic-metal-inspection.png");
  const [running, setRunning] = useState(false);
  const [inspected, setInspected] = useState(true);
  const [selected, setSelected] = useState<number | null>(1);
  const inputRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(
    () => (inspected ? detections.filter((item) => item.confidence * 100 >= threshold[0]) : []),
    [threshold, inspected],
  );

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();

    void Promise.resolve(
      context.registerTool(
        {
          name: "run_demo_inspection",
          title: "Run demo inspection",
          description:
            "Run the representative portfolio inspection and optionally set its confidence threshold.",
          inputSchema: {
            type: "object",
            properties: {
              threshold: {
                type: "number",
                minimum: 40,
                maximum: 95,
                description: "Minimum confidence percentage.",
              },
            },
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute(input) {
            const value =
              typeof input === "object" &&
              input !== null &&
              "threshold" in input &&
              typeof input.threshold === "number"
                ? input.threshold
                : 65;
            if (value < 40 || value > 95) {
              throw new Error("threshold must be between 40 and 95");
            }
            setThreshold([Math.round(value)]);
            setInspected(true);
            setSelected(1);
            return {
              status: "complete",
              mode: "portfolio-demo",
              threshold: Math.round(value),
              findingCount: detections.filter(
                (item) => item.confidence * 100 >= value,
              ).length,
            };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);

    return () => lifecycle.abort();
  }, []);

  function chooseFile(file?: File) {
    if (!file || !file.type.startsWith("image/")) return;
    setImageUrl(URL.createObjectURL(file));
    setFileName(file.name);
    setInspected(false);
    setSelected(null);
  }

  function inspect() {
    setRunning(true);
    window.setTimeout(() => {
      setRunning(false);
      setInspected(true);
      setSelected(1);
    }, 650);
  }

  function resetSample() {
    setImageUrl("/synthetic-metal-inspection.png");
    setFileName("synthetic-metal-inspection.png");
    setThreshold([65]);
    setInspected(true);
    setSelected(1);
  }

  function download(format: "json" | "csv") {
    const payload =
      format === "json"
        ? JSON.stringify({ mode: "portfolio-demo", file: fileName, threshold: threshold[0] / 100, detections: visible }, null, 2)
        : ["label,confidence,x,y,width,height", ...visible.map((d) => [d.label, d.confidence, d.x, d.y, d.width, d.height].join(","))].join("\n");
    const blob = new Blob([payload], { type: format === "json" ? "application/json" : "text/csv" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `inspection-results.${format}`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  return (
    <main className="min-h-screen bg-[#0d1116] text-[#e7edf3]">
      <header className="border-b border-white/10 bg-[#11171e]">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-4 py-3 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="grid size-8 place-items-center rounded-md bg-[#79b8ff] text-[#07111d]">
              <ScanSearch className="size-5" />
            </div>
            <div>
              <p className="text-[15px] font-semibold tracking-tight">Visual Inspection Studio</p>
              <p className="text-xs text-[#8d9aa7]">Surface defect review · Line 01</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-2 border border-[#75d5c5]/25 bg-[#75d5c5]/8 px-2.5 py-1.5 font-mono text-[11px] text-[#9ae3d7] sm:flex">
              <span className="size-1.5 rounded-full bg-[#75d5c5]" />
              OFFLINE DEMO
            </span>
            <Button variant="outline" size="sm" className="border-white/15 bg-transparent text-[#c8d2dc] hover:bg-white/10 hover:text-white" onClick={resetSample}>
              <RotateCcw /> Reset sample
            </Button>
          </div>
        </div>
      </header>

      <div className="technical-rule mx-auto flex max-w-[1500px] items-center justify-between px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#71808d] sm:px-7">
        <span>Run 000184 · Camera C-04</span>
        <span>12 Sep 2026 · 14:32:08 UTC</span>
        <span className="hidden text-[#9ae3d7] sm:inline">System ready</span>
      </div>

      <div className="mx-auto grid max-w-[1500px] gap-3 px-4 py-4 lg:grid-cols-[260px_minmax(0,1fr)_310px] sm:px-7">
        <aside className="panel order-2 p-4 lg:order-1">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="eyebrow">Inspection</p>
              <h2 className="mt-1 text-lg font-semibold">Run settings</h2>
            </div>
            <Gauge className="size-5 text-[#79b8ff]" />
          </div>

          <button
            className="group grid w-full place-items-center rounded-md border border-dashed border-white/20 bg-[#10161c] px-3 py-6 text-center transition hover:border-[#79b8ff]/60 hover:bg-[#79b8ff]/5"
            onClick={() => inputRef.current?.click()}
            onDrop={(event) => { event.preventDefault(); chooseFile(event.dataTransfer.files[0]); }}
            onDragOver={(event) => event.preventDefault()}
          >
              <span className="grid size-10 place-items-center rounded-md bg-white/7 text-[#9aa7b4] group-hover:text-[#79b8ff]">
              <ImagePlus className="size-5" />
            </span>
            <span className="mt-3 text-sm font-medium">Upload inspection image</span>
            <span className="mt-1 text-xs text-[#7f938e]">PNG, JPG or WebP</span>
          </button>
          <input ref={inputRef} className="hidden" type="file" accept="image/*" onChange={(event) => chooseFile(event.target.files?.[0])} />

          <div className="mt-5 space-y-5">
            <label className="block">
              <span className="mb-2 flex items-center justify-between text-sm">
                <span className="text-[#aeb9c3]">Model</span>
                <ChevronDown className="size-4 text-[#72808d]" />
              </span>
              <select className="w-full rounded-md border border-white/12 bg-[#10161c] px-3 py-2.5 text-sm outline-none focus:border-[#79b8ff]/60" defaultValue="surface">
                <option value="surface">Surface Defect v2</option>
                <option value="generic">Generic Detector</option>
              </select>
            </label>

            <div>
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="text-[#aeb9c3]">Confidence threshold</span>
                <span className="font-mono text-[#79b8ff]">{threshold[0]}%</span>
              </div>
              <Slider aria-label="Confidence threshold" min={40} max={95} step={1} value={threshold} onValueChange={(value) => setThreshold(value as number[])} className="[&_[data-slot=slider-range]]:bg-[#79b8ff] [&_[data-slot=slider-thumb]]:border-[#79b8ff]" />
              <div className="mt-2 flex justify-between text-[11px] text-[#6f7d8a]"><span>40%</span><span>95%</span></div>
            </div>

            <div>
              <p className="mb-2 text-sm text-[#aeb9c3]">Defect classes</p>
              <div className="space-y-2">
                {["Scratch", "Dent", "Oxidation"].map((label, index) => (
                  <label key={label} className="flex items-center justify-between rounded-md border border-white/6 bg-[#10161c] px-3 py-2 text-sm">
                    <span className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: detections[index].color }} />{label}</span>
                    <input type="checkbox" defaultChecked className="accent-[#79b8ff]" />
                  </label>
                ))}
              </div>
            </div>
          </div>

          <Button className="mt-6 h-11 w-full rounded-md bg-[#79b8ff] font-semibold text-[#07111d] hover:bg-[#a0ccff]" onClick={inspect} disabled={running}>
            {running ? <Activity className="animate-spin" /> : <Play />}
            {running ? "Inspecting…" : "Run inspection"}
          </Button>
          <p className="mt-3 text-center text-[11px] leading-relaxed text-[#71808d]">Representative demo output. Connect a versioned model before production use.</p>
        </aside>

        <section className="order-1 min-w-0 lg:order-2">
          <div className="panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{fileName}</p>
                <p className="mt-0.5 text-xs text-[#7d8b98]">Synthetic sample · local browser processing</p>
              </div>
              <div className="flex items-center gap-3 font-mono text-[11px]">
                <span className="text-[#aeb9c3]">{visible.length} findings</span>
                <span className="text-[#9ae3d7]">84 ms</span>
              </div>
            </div>

            <div className="relative grid min-h-[430px] place-items-center overflow-hidden bg-[#090d12] p-3 sm:min-h-[620px]">
              <div className="inspection-grid absolute inset-0 opacity-20" />
              <div className="absolute left-4 top-3 z-10 font-mono text-[10px] text-[#6f7d8a]">LIVE FRAME · 1920 × 1080</div>
              <div className="absolute bottom-3 right-4 z-10 font-mono text-[10px] text-[#6f7d8a]">FIT TO VIEW · RGB</div>
              <div className="relative z-10 max-h-[650px] max-w-full overflow-hidden rounded-sm border border-white/15 shadow-2xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="Metal component under visual inspection" className="block max-h-[650px] w-auto max-w-full object-contain" />
                {visible.map((detection) => (
                  <button
                    key={detection.id}
                    aria-label={`${detection.label}, ${Math.round(detection.confidence * 100)} percent confidence`}
                    className="absolute border-2 transition hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-white/70"
                    style={{ left: `${detection.x}%`, top: `${detection.y}%`, width: `${detection.width}%`, height: `${detection.height}%`, borderColor: detection.color }}
                    onClick={() => setSelected(detection.id)}
                  >
                    <span className="absolute -top-7 left-[-2px] whitespace-nowrap rounded-t-md px-2 py-1 text-[11px] font-semibold text-[#07110f]" style={{ background: detection.color }}>
                      {detection.label} {Math.round(detection.confidence * 100)}%
                    </span>
                  </button>
                ))}
              </div>
              {!inspected && (
                <div className="absolute inset-0 z-20 grid place-items-center bg-[#0d1116]/80 backdrop-blur-sm">
                  <div className="text-center"><Upload className="mx-auto size-7 text-[#79b8ff]" /><p className="mt-3 font-medium">Image ready</p><p className="mt-1 text-sm text-[#8d9aa7]">Run inspection to generate demo findings.</p></div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.label} className="panel p-4">
                <p className="text-xs text-[#8795a2]">{metric.label}</p>
                <div className="mt-2 flex items-end justify-between"><strong className="text-2xl tracking-tight">{metric.value}</strong><span className="font-mono text-[10px] text-[#71808d]">{metric.note}</span></div>
              </div>
            ))}
          </div>
        </section>

        <aside className="panel order-3 overflow-hidden">
          <Tabs defaultValue="findings" className="h-full">
            <TabsList variant="line" className="w-full justify-start gap-4 border-b border-white/10 px-4 pt-3">
              <TabsTrigger value="findings" className="px-0 text-[#8d9aa7] data-[state=active]:text-white">Findings</TabsTrigger>
              <TabsTrigger value="evaluation" className="px-0 text-[#8d9aa7] data-[state=active]:text-white">Evaluation</TabsTrigger>
            </TabsList>
            <TabsContent value="findings" className="p-4">
              <div className="flex items-center justify-between">
                <div><p className="eyebrow">Review queue</p><h2 className="mt-1 text-lg font-semibold">{visible.length} findings</h2></div>
                <Layers3 className="size-5 text-[#79b8ff]" />
              </div>
              <div className="mt-4 space-y-2">
                {visible.map((item) => (
                  <button key={item.id} onClick={() => setSelected(item.id)} className={`w-full rounded-md border p-3 text-left transition ${selected === item.id ? "border-[#79b8ff]/55 bg-[#79b8ff]/8" : "border-white/8 bg-[#10161c] hover:bg-white/5"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex gap-3"><span className="mt-0.5 grid size-8 place-items-center rounded-md bg-white/7"><Box className="size-4" style={{ color: item.color }} /></span><div><p className="text-sm font-medium">{item.label}</p><p className="mt-1 text-xs text-[#7d8b98]">Finding #{String(item.id).padStart(2, "0")}</p></div></div>
                      <strong className="font-mono text-sm" style={{ color: item.color }}>{Math.round(item.confidence * 100)}%</strong>
                    </div>
                  </button>
                ))}
                {!visible.length && <div className="rounded-md border border-dashed border-white/12 p-5 text-center text-sm text-[#7c8a97]">No findings above this threshold.</div>}
              </div>

              <div className="mt-5 rounded-md border border-[#f4b75e]/25 bg-[#f4b75e]/7 p-3">
                <div className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#f4b75e]" /><p className="text-xs leading-relaxed text-[#c8b68f]">Low-confidence findings should be reviewed by a person before downstream action.</p></div>
              </div>

              <div className="mt-5">
                <p className="mb-2 text-xs font-medium text-[#95a7a2]">Export results</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" className="rounded-md border-white/12 bg-transparent text-[#c8d2dc] hover:bg-white/8 hover:text-white" onClick={() => download("json")}><Download /> JSON</Button>
                  <Button variant="outline" className="rounded-md border-white/12 bg-transparent text-[#c8d2dc] hover:bg-white/8 hover:text-white" onClick={() => download("csv")}><Download /> CSV</Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="evaluation" className="p-4">
              <p className="eyebrow">Validation split</p>
              <h2 className="mt-1 text-lg font-semibold">Model comparison</h2>
              <div className="mt-5 space-y-4">
                {[["Fine-tuned model", 91, "#79b8ff"], ["Baseline", 79, "#768694"]].map(([label, value, color]) => (
                  <div key={String(label)}>
                    <div className="mb-2 flex justify-between text-sm"><span>{label}</span><strong>{value}%</strong></div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/7"><div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} /></div>
                  </div>
                ))}
              </div>
              <div className="mt-6 grid grid-cols-2 gap-2">
                {[["148", "Images"], ["37", "Defects"], ["3", "Classes"], ["0", "Leakage"]].map(([value, label]) => (
                  <div key={label} className="rounded-md border border-white/6 bg-[#10161c] p-3"><strong className="text-lg">{value}</strong><p className="mt-1 text-xs text-[#74808d]">{label}</p></div>
                ))}
              </div>
              <div className="mt-5 flex gap-2 rounded-md border border-[#79b8ff]/20 bg-[#79b8ff]/6 p-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#79b8ff]" />
                <p className="text-xs leading-relaxed text-[#afc4dc]">Representative portfolio metrics, labeled as demo data until connected to a versioned model evaluation.</p>
              </div>
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      <footer className="mx-auto flex max-w-[1500px] flex-col gap-2 px-7 pb-6 text-xs text-[#71808d] sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-center gap-2"><Sparkles className="size-3.5" /> Synthetic sample image generated for demonstration.</span>
        <span className="flex items-center gap-2"><Check className="size-3.5 text-[#75d5c5]" /> No uploaded image leaves your browser in this demo.</span>
      </footer>
    </main>
  );
}
