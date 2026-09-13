"use client";

import { useState } from "react";
import { ArrowDown, ArrowRight, Check, CheckCheck, ChevronRight, ClipboardCheck, Cpu, FileDown, FileText, GitBranch, Layers3, ScanLine, ShieldCheck, SlidersHorizontal, UserCheck } from "lucide-react";
import type { PublicDemoSample } from "@/lib/public-demo";
import { PUBLIC_DEMO } from "@/lib/public-demo";

export const REPOSITORY_URL = "https://github.com/ibrohimgets/visual-inspection-studio";

type Props = {
  onDemo: () => void;
  onInspect: (sample: PublicDemoSample) => void;
  onEvidence: () => void;
  approved: boolean;
};

export function PcbFrame({ sample, boxes = true }: { sample: PublicDemoSample; boxes?: boolean }) {
  return <div className={`pcb-frame outcome-${sample.expectedOutcome.toLowerCase()}`}>
    {/* Exact dataset pixels and recorded detector coordinates are kept together. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={sample.imagePath} width={sample.width} height={sample.height} alt={`${sample.title}: real PCB inspection input`} />
    {boxes && sample.run.detections.map(detection => <span key={detection.id} className="pcb-region" style={{
      left: `${detection.x / sample.width * 100}%`, top: `${detection.y / sample.height * 100}%`,
      width: `${detection.width / sample.width * 100}%`, height: `${detection.height / sample.height * 100}%`,
    }}><span>{detection.label} · {(detection.confidence * 100).toFixed(1)}%</span></span>)}
  </div>;
}

export default function PortfolioHome({ onDemo, onInspect, onEvidence, approved }: Props) {
  const [previewId, setPreviewId] = useState(PUBLIC_DEMO.samples[2].id);
  const [showBoxes, setShowBoxes] = useState(true);
  const preview = PUBLIC_DEMO.samples.find(sample => sample.id === previewId) ?? PUBLIC_DEMO.samples[2];
  const previewFinding = preview.run.detections[0];
  const hero = PUBLIC_DEMO.samples[2];
  const finding = hero.run.detections[0];
  const cropSize = 65;
  const cropX = Math.max(0, Math.min(hero.width - cropSize, finding.x + finding.width / 2 - cropSize / 2));
  const cropHeight = cropSize / 1.45;
  const cropY = Math.max(0, Math.min(hero.height - cropHeight, finding.y + finding.height / 2 - cropHeight / 2));
  const features = [
    { icon: ScanLine, title: "AI defect detection", text: "Locate findings with a specialized vision model. Inspect the box, class, and confidence together.", detail: "MODEL-AGNOSTIC DETECTOR" },
    { icon: FileText, title: "PDF rule extraction", text: "Turn searchable quality specs into structured rules, each linked to the exact source page.", detail: "EVIDENCE BEFORE APPROVAL" },
    { icon: GitBranch, title: "Deterministic decisions", text: "Apply approved acceptance criteria with consistent precedence and an ordered decision trace.", detail: "PASS / FAIL / REVIEW" },
    { icon: UserCheck, title: "Human review workflow", text: "Accept or dismiss findings, add context, and route uncertainty to a quality engineer.", detail: "KEEP PEOPLE IN CONTROL" },
    { icon: Layers3, title: "Batch inspection", text: "Queue images, track each inspection, and review findings in one workspace.", detail: "PER-IMAGE STATUS & TIMING" },
    { icon: FileDown, title: "Exportable reports", text: "Deliver findings, corrections, policy outcomes, and model details in JSON or CSV.", detail: "EVIDENCE THAT TRAVELS" },
  ];
  return <div className="premium-home">
    <section className="premium-hero" aria-labelledby="hero-title">
      <div className="hero-ambient" aria-hidden="true" />
      <div className="hero-copy">
        <p className="premium-eyebrow"><span /> INTELLIGENCE FOR INDUSTRIAL QUALITY</p>
        <h1 id="hero-title">AI-powered<br />visual inspection.<br /><em>Quality, explained.</em></h1>
        <p className="hero-description">AI-powered visual inspection for smarter manufacturing. Turn PDF quality specs into approved rules, detect defects, and explain every PASS, FAIL, or REVIEW.</p>
        <div className="premium-actions">
          <button className="premium-button primary" onClick={onDemo}>Try Demo <ArrowRight size={18} aria-hidden="true" /></button>
          <a className="premium-button secondary" href={REPOSITORY_URL} target="_blank" rel="noreferrer"><GitBranch size={17} aria-hidden="true" /> View GitHub</a>
        </div>
        <p className="hero-assurance"><ShieldCheck size={15} aria-hidden="true" /> No sign-up. Sample data. Zero paid calls.</p>
      </div>
      <div className="inspection-scene" aria-label="Real recorded PCB open-circuit detection with a FAIL policy outcome">
        <div className="scene-grid" aria-hidden="true" />
        <div className="inspection-plate">
          <div className="plate-toolbar"><span><ScanLine size={16} aria-hidden="true" /> PCB INSPECTION</span><span>CAM 01 / 256 PX</span></div>
          <PcbFrame sample={hero} />
          <div className="plate-footer"><span>YOLOX-Nano PCB</span><span>Recorded validation</span></div>
        </div>
        <div className="floating-card spec-float"><span className="float-icon"><FileText size={21} aria-hidden="true" /></span><div><small>QUALITY SPEC</small><strong>QSP-PCB-017</strong><span><Check size={12} aria-hidden="true" /> Evidence-linked rules</span></div></div>
        <div className="floating-card defect-float"><span className="float-kicker">DEFECT LOCALIZED</span><strong>Open circuit <span>OP</span></strong><div className="confidence-meter"><span style={{ width: `${finding.confidence * 100}%` }} /></div><div className="float-value"><span>Detector confidence</span><b>{(finding.confidence * 100).toFixed(1)}%</b></div></div>
        <div className="floating-card decision-float"><div><span className="fail-dot" /><small>POLICY OUTCOME</small></div><strong>FAIL <span>Critical defect</span></strong><p>Open-circuit findings must be rejected.</p></div>
        <span className="scene-caption">REAL PCB INPUT · RECORDED MODEL OUTPUT</span>
      </div>
      <a className="hero-scroll" href="#how-it-works">Explore the inspection flow <ArrowDown size={15} aria-hidden="true" /></a>
    </section>
    <div className="premium-proof" aria-label="Product principles"><span>Built around the quality decision</span><strong><ScanLine size={18} aria-hidden="true" /> Real vision models</strong><strong><FileText size={18} aria-hidden="true" /> Source-linked rules</strong><strong><ShieldCheck size={18} aria-hidden="true" /> Human approval</strong><strong><GitBranch size={18} aria-hidden="true" /> Auditable results</strong></div>
    <section className="premium-section" id="how-it-works">
      <div className="premium-section-heading"><div><p className="premium-eyebrow">01 / FROM SPECIFICATION TO DECISION</p><h2>One connected inspection flow.</h2></div><p>Your quality criteria become the logic behind every inspection. A person approves the rules before they can be used.</p></div>
      <ol className="inspection-pipeline">
        {[
          { icon: FileText, title: "PDF Spec", caption: "Your acceptance criteria", code: ".PDF" },
          { icon: Cpu, title: "LLM Rule Extraction", caption: "Structured, cited, approved", code: "JSON" },
          { icon: ScanLine, title: "Vision Detection", caption: "Defect boxes + confidence", code: "YOLOX" },
          { icon: GitBranch, title: "Rule Engine", caption: "Deterministic evaluation", code: "POLICY" },
          { icon: ClipboardCheck, title: "Inspection Decision", caption: "PASS / FAIL / REVIEW", code: "REPORT" },
        ].map((step, index) => <li key={step.title}><div className="pipeline-top"><step.icon size={25} strokeWidth={1.5} aria-hidden="true" /><span>0{index + 1}</span></div><strong>{step.title}</strong><p>{step.caption}</p><small>{step.code}</small>{index < 4 && <ChevronRight className="pipeline-arrow" size={17} aria-hidden="true" />}</li>)}
      </ol>
      <p className="pipeline-note"><ShieldCheck size={15} aria-hidden="true" /> The LLM proposes rules. Your approved policy controls the decision.</p>
    </section>
    <section className="premium-section preview-section" id="product-preview">
      <div className="premium-section-heading"><div><p className="premium-eyebrow">02 / EXPLORE THE PRODUCT</p><h2>Evidence you can inspect.</h2></div><p>Switch between real PCB cases. See how the same demonstration policy produces three different outcomes.</p></div>
      <div className="interactive-preview">
        <div className="preview-topbar"><span><ScanLine size={18} aria-hidden="true" /> Inspection workspace</span><span className="recorded-chip">Recorded validation</span></div>
        <div className="preview-case-picker" aria-label="Choose an inspection example">{PUBLIC_DEMO.samples.map(sample => <button key={sample.id} aria-pressed={previewId === sample.id} onClick={() => setPreviewId(sample.id)}><span className={`mini-outcome ${sample.expectedOutcome.toLowerCase()}`}>{sample.expectedOutcome}</span>{sample.title}</button>)}</div>
        <div className="preview-content">
          <div className="preview-image-area"><div className="preview-image-toolbar"><span>{preview.imageId.split(":")[1]}</span><div className="preview-segment" aria-label="Image view"><button aria-pressed={!showBoxes} onClick={() => setShowBoxes(false)}>Original</button><button aria-pressed={showBoxes} onClick={() => setShowBoxes(true)}>Detection</button></div></div><div className="preview-image"><PcbFrame sample={preview} boxes={showBoxes} /></div><div className="preview-image-footer"><span>{preview.width} × {preview.height} px</span><span>Original-pixel coordinates</span></div></div>
          <div className="preview-inspector" aria-live="polite"><div className="inspector-label"><SlidersHorizontal size={15} aria-hidden="true" /> FINDING INSPECTOR</div><h3>{preview.title}</h3><p className="preview-class">CLASS {previewFinding.label} <span>YOLOX-Nano PCB</span></p><div className="preview-confidence"><span>Detector confidence</span><strong>{(previewFinding.confidence * 100).toFixed(1)}<small>%</small></strong><div className="confidence-meter"><span style={{width: `${previewFinding.confidence * 100}%`}} /></div></div><div className={`preview-decision ${preview.expectedOutcome.toLowerCase()}`}><span>DEMONSTRATION POLICY</span><strong>{preview.expectedOutcome}<small>{preview.expectedSeverity} severity</small></strong><p>{preview.clientSummary}</p></div><div className="preview-rule"><CheckCheck size={17} aria-hidden="true" /><p>Linked to QSP-PCB-017<span>Source evidence → approved rule → trace</span></p></div><button className="premium-button primary preview-review-action" onClick={() => onInspect(preview)}>{approved ? "Open review workspace" : "Review policy & inspect"}<ArrowRight size={16} aria-hidden="true" /></button></div>
        </div>
        <div className="preview-disclosure"><ShieldCheck size={14} aria-hidden="true" /><p>Recorded PCB predictions · Recorded rule extraction · Zero paid calls. Live general-object uploads and owner PDF extraction are available in the workspace.</p></div>
      </div>
    </section>
    <section className="premium-section" id="capabilities"><div className="premium-section-heading"><div><p className="premium-eyebrow">03 / DESIGNED FOR THE WHOLE WORKFLOW</p><h2>From model output<br />to a useful quality tool.</h2></div><p>The engineering around the model makes inspection results reviewable, repeatable, and ready to hand off.</p></div><div className="premium-feature-grid">{features.map(feature => <article className="premium-feature" key={feature.title}><div className="feature-icon"><feature.icon size={25} strokeWidth={1.45} aria-hidden="true" /></div><h3>{feature.title}</h3><p>{feature.text}</p><span>{feature.detail}</span></article>)}</div></section>
    <section className="premium-section performance-section" id="performance"><div className="premium-section-heading"><div><p className="premium-eyebrow">04 / MEASURED MODEL PERFORMANCE</p><h2>Transparent numbers.<br />Clear tradeoffs.</h2></div><p>YOLOX-Nano PCB, measured on 851 internal validation images. Choose the operating threshold that fits the inspection task.</p></div><div className="performance-layout"><div className="performance-chart"><div className="chart-heading"><h3>Validation performance</h3><span>IoU 0.5</span></div><div className="chart-legend"><span><i />Baseline</span><span><i />Precision-first</span></div>{[{name:"Precision",base:69.86,tuned:76.97},{name:"Recall",base:66.19,tuned:64.53},{name:"F1",base:67.98,tuned:70.20}].map(metric => <div className="metric-bars" key={metric.name}><span>{metric.name}</span><div className="metric-bar base"><div style={{width:`${metric.base}%`}} /><b>{metric.base.toFixed(2)}%</b></div><div className="metric-bar tuned"><div style={{width:`${metric.tuned}%`}} /><b>{metric.tuned.toFixed(2)}%</b></div></div>)}<p>Stricter thresholds increase precision and reduce recall. Ranked mAP remains unchanged.</p></div><div className="performance-stats"><div><span>Ranked mAP@0.5</span><strong>69.41<small>%</small></strong><p>Internal validation</p></div><div><span>CPU wall latency</span><strong>23.32<small>ms</small></strong><p>Per image on the benchmark machine</p></div><div><span>Defect classes</span><strong>9</strong><p>PCB surface and circuit defects</p></div><div><span>Input resolution</span><strong>256<small>px</small></strong><p>7.22 MiB checkpoint</p></div></div></div><div className="performance-footnote"><p>Validation evidence, not a production guarantee. Frozen test partition remains sealed.</p><button onClick={onEvidence}>View model evidence <ArrowRight size={15} aria-hidden="true" /></button></div></section>
    <section className="premium-section defect-detail-section"><div className="defect-detail-visual"><div className="zoom-toolbar"><span><ScanLine size={16} aria-hidden="true" /> OPEN CIRCUIT / OP</span><span>REGION DETAIL</span></div><div className="defect-zoom"><div style={{width:`${hero.width / cropSize * 100}%`,height:`${hero.height / cropHeight * 100}%`,left:`${-cropX / cropSize * 100}%`,top:`${-cropY / cropHeight * 100}%`}}><PcbFrame sample={hero} /></div></div><div className="zoom-footer"><span>65 × 45 px source region</span><span>78.9% confidence</span></div></div><div className="defect-detail-copy"><p className="premium-eyebrow">05 / THE DETAIL BEHIND THE DECISION</p><h2>Small defect.<br />Traceable consequence.</h2><p>A break in a conductor is easy to miss at full scale. A focused region view connects the visible finding to the rule that makes it critical.</p><blockquote><FileText size={18} aria-hidden="true" /><div>“Any open-circuit (OP) or short-circuit (SH) finding is critical and must result in FAIL.”<cite>QSP-PCB-017 · Page 1</cite></div></blockquote><button className="premium-text-link case-link" onClick={() => onInspect(hero)}>Inspect this example <ArrowRight size={17} aria-hidden="true" /></button></div></section>
    <section className="premium-final-cta"><div className="cta-glow" aria-hidden="true" /><p className="premium-eyebrow">YOUR PRODUCT. YOUR CRITERIA. YOUR WORKFLOW.</p><h2>Bring your quality requirements<br />into the inspection loop.</h2><p>Explore the working demo, then see how the detector and policy layers can be adapted to a client’s images and acceptance criteria.</p><div className="premium-actions"><button className="premium-button primary" onClick={onDemo}>Try Demo <ArrowRight size={18} aria-hidden="true" /></button><a className="premium-button secondary" href={`${REPOSITORY_URL}#adapt-it-to-a-client-dataset`} target="_blank" rel="noreferrer">Explore the engineering <GitBranch size={17} aria-hidden="true" /></a></div></section>
    <p className="premium-attribution">PCB examples: <a href={PUBLIC_DEMO.dataset.source} target="_blank" rel="noreferrer">DsPCBSD+</a> by Shengping Lv · CC BY 4.0 · Internal validation samples. Portfolio demonstration.</p>
  </div>;
}
