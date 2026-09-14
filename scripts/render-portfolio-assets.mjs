import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const portfolio = resolve(root, "docs/portfolio");
await mkdir(portfolio, { recursive: true });
await sharp(resolve(portfolio, "architecture.svg")).png().toFile(resolve(portfolio, "04-architecture.png"));
const demo = JSON.parse(await readFile(resolve(root, "public/examples/pcb-demo/demo.json"), "utf8"));
const outcomeColor = { PASS: "#3e8b68", REVIEW: "#b17923", FAIL: "#b54c43" };
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const [passSample, reviewSample, failSample] = demo.samples;
const coverCards = [
  { sample: passSample, path: passSample.imagePath, x: 838, y: 148, width: 294, height: 294, label: "PCB INPUT", accent: "#7f9ab0" },
  { sample: passSample, path: passSample.annotatedPath, x: 1164, y: 148, width: 294, height: 294, label: "DETECTOR OUTPUT / PASS", accent: "#54c99a" },
  { sample: reviewSample, path: reviewSample.annotatedPath, x: 930, y: 520, width: 238, height: 238, label: "REVIEW / CONDUCTOR SCRATCH", accent: "#e2b65d" },
  { sample: failSample, path: failSample.annotatedPath, x: 1210, y: 520, width: 238, height: 238, label: "FAIL / OPEN CIRCUIT", accent: "#ef756b" },
];
const coverFrames = coverCards.map(card => `<rect x="${card.x - 12}" y="${card.y - 42}" width="${card.width + 24}" height="${card.height + 56}" rx="10" fill="#102031" stroke="#9fcce333"/>
  <circle cx="${card.x + 3}" cy="${card.y - 20}" r="4" fill="${card.accent}"/>
  <text x="${card.x + 14}" y="${card.y - 16}" class="cardLabel">${card.label}</text>`).join("\n");
const coverSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">
  <defs>
    <radialGradient id="halo" cx="74%" cy="42%" r="55%"><stop offset="0" stop-color="#174963" stop-opacity=".42"/><stop offset="1" stop-color="#07111c" stop-opacity="0"/></radialGradient>
    <linearGradient id="headline" x1="0" x2="1"><stop stop-color="#f4f8ff"/><stop offset="1" stop-color="#86dfe8"/></linearGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M 48 0 L 0 0 0 48" fill="none" stroke="#a8d4e7" stroke-opacity=".045"/></pattern>
  </defs>
  <style>.sans{font-family:Segoe UI,Arial,sans-serif}.mono{font-family:Consolas,monospace}.brand{font:600 22px Segoe UI,Arial,sans-serif;fill:#edf7ff}.kicker{font:12px Consolas,monospace;letter-spacing:2px;fill:#91dce5}.headline{font:600 57px Segoe UI,Arial,sans-serif;letter-spacing:-2px;fill:url(#headline)}.body{font:18px Segoe UI,Arial,sans-serif;fill:#a8bbcd}.pill{font:11px Consolas,monospace;letter-spacing:1px;fill:#b8cedf}.cardLabel{font:10px Consolas,monospace;letter-spacing:.8px;fill:#b5c9da}.footer{font:12px Consolas,monospace;letter-spacing:.7px;fill:#7892a7}</style>
  <rect width="1600" height="900" fill="#07111c"/><rect width="1600" height="900" fill="url(#halo)"/><rect width="1600" height="900" fill="url(#grid)"/>
  <rect x="70" y="62" width="30" height="30" rx="7" fill="none" stroke="#7de2e9" stroke-width="2"/><path d="M77 68h7M77 68v7M93 68h-7M93 68v7M77 86h7M77 86v-7M93 86h-7M93 86v-7" stroke="#7de2e9" stroke-width="2"/>
  <text x="116" y="85" class="brand">Visual Inspection Studio</text>
  <circle cx="74" cy="161" r="4" fill="#8ae7ed"/><text x="90" y="166" class="kicker">INDUSTRIAL COMPUTER VISION</text>
  <text x="70" y="244" class="headline">Quality rules in.</text><text x="70" y="310" class="headline">Inspection decisions out.</text>
  <text x="70" y="365" class="body">PDF quality specs → approved rules → defect detection</text><text x="70" y="395" class="body">→ PASS / REVIEW / FAIL with a traceable reason.</text>
  <rect x="70" y="452" width="175" height="38" rx="6" fill="#182b3b" stroke="#8bc7da44"/><text x="88" y="476" class="pill">REAL PCB EVIDENCE</text>
  <rect x="260" y="452" width="194" height="38" rx="6" fill="#182b3b" stroke="#8bc7da44"/><text x="278" y="476" class="pill">DETERMINISTIC RULES</text>
  <rect x="469" y="452" width="165" height="38" rx="6" fill="#182b3b" stroke="#8bc7da44"/><text x="487" y="476" class="pill">HUMAN REVIEW</text>
  <line x1="70" y1="574" x2="684" y2="574" stroke="#acd8e42b"/><text x="70" y="612" class="kicker">INPUT → DETECT → APPLY POLICY → EXPORT</text>
  <text x="70" y="654" class="body">A client-ready inspection workflow built around</text><text x="70" y="682" class="body">the decision—not only the bounding box.</text>
  ${coverFrames}
  <line x1="70" y1="824" x2="1530" y2="824" stroke="#acd8e42b"/><text x="70" y="857" class="footer">YOLOX-NANO PCB · PDF.JS · AJV · REACT · REAL INTERNAL-VALIDATION SAMPLES</text>
  <text x="1530" y="857" text-anchor="end" class="footer">DsPCBSD+ · CC BY 4.0</text>
</svg>`);
const coverComposites = [{ input: coverSvg, top: 0, left: 0 }];
for (const card of coverCards) {
  coverComposites.push({ input: await sharp(resolve(root, `public${card.path}`)).resize(card.width, card.height, { fit: "cover" }).png().toBuffer(), top: card.y, left: card.x });
}
await sharp({ create: { width: 1600, height: 900, channels: 4, background: "#07111c" } })
  .composite(coverComposites).png().toFile(resolve(portfolio, "cover.png"));
await sharp(resolve(portfolio, "cover.png")).extend({ top: 150, bottom: 150, left: 0, right: 0, background: "#07111c" })
  .png().toFile(resolve(portfolio, "upwork-cover-1600x1200.png"));

const cards = demo.samples.map((sample, index) => {
  const x = 40 + index * 520;
  const detection = sample.run.detections[0];
  return `<rect x="${x}" y="164" width="480" height="660" rx="4" fill="#fff" stroke="#cdd8de" stroke-width="2"/>
    <text x="${x + 22}" y="202" class="label">INPUT</text><text x="${x + 252}" y="202" class="label">DETECTOR OUTPUT</text>
    <rect x="${x + 22}" y="474" width="92" height="31" rx="3" fill="${outcomeColor[sample.expectedOutcome]}"/>
    <text x="${x + 68}" y="495" text-anchor="middle" class="badge">${sample.expectedOutcome}</text>
    <text x="${x + 22}" y="548" class="cardTitle">${escape(sample.title)}</text>
    <text x="${x + 22}" y="582" class="body">${escape(sample.clientSummary)}</text>
    <line x1="${x + 22}" y1="620" x2="${x + 458}" y2="620" stroke="#e1e7ea"/>
    <text x="${x + 22}" y="658" class="key">CLASS</text><text x="${x + 458}" y="658" text-anchor="end" class="value">${escape(detection.label)}</text>
    <text x="${x + 22}" y="692" class="key">CONFIDENCE</text><text x="${x + 458}" y="692" text-anchor="end" class="value">${(detection.confidence * 100).toFixed(1)}%</text>
    <text x="${x + 22}" y="726" class="key">INFERENCE</text><text x="${x + 458}" y="726" text-anchor="end" class="value">${Math.round(sample.run.inferenceMs)} ms</text>
    <text x="${x + 22}" y="760" class="key">SOURCE</text><text x="${x + 458}" y="760" text-anchor="end" class="value">internal validation</text>`;
}).join("\n");
const boardSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">
  <style>.sans{font-family:Segoe UI,Arial,sans-serif}.title{font:700 34px Segoe UI,Arial,sans-serif;fill:#142d3f}.subtitle{font:17px Segoe UI,Arial,sans-serif;fill:#637681}.label,.key{font:13px Consolas,monospace;letter-spacing:1px;fill:#617783}.badge{font:700 14px Consolas,monospace;fill:#fff}.cardTitle{font:700 24px Segoe UI,Arial,sans-serif;fill:#203744}.body{font:16px Segoe UI,Arial,sans-serif;fill:#657681}.value{font:16px Consolas,monospace;fill:#263e4b}</style>
  <rect width="1600" height="900" fill="#f3f6f7"/>
  <text x="40" y="58" class="title">Real PCB inputs and detector outputs</text>
  <text x="40" y="91" class="subtitle">Three cached YOLOX-Nano validation cases evaluated by one approved deterministic policy</text>
  <rect x="1306" y="39" width="254" height="43" rx="3" fill="#142d3f"/><text x="1433" y="66" text-anchor="middle" class="badge">PASS · REVIEW · FAIL</text>
  ${cards}
  <text x="40" y="864" class="subtitle">DsPCBSD+ · CC BY 4.0 · internal validation only · frozen test partition untouched</text>
</svg>`);
const composites = [{ input: boardSvg, top: 0, left: 0 }];
for (let index = 0; index < demo.samples.length; index += 1) {
  const sample = demo.samples[index];
  const x = 62 + index * 520;
  composites.push({ input: await sharp(resolve(root, `public${sample.imagePath}`)).resize(206, 240, { fit: "cover" }).png().toBuffer(), top: 216, left: x });
  composites.push({ input: await sharp(resolve(root, `public${sample.annotatedPath}`)).resize(206, 240, { fit: "cover" }).png().toBuffer(), top: 216, left: x + 230 });
}
await sharp({ create: { width: 1600, height: 900, channels: 4, background: "#f3f6f7" } })
  .composite(composites).png().toFile(resolve(portfolio, "05-input-output-cases.png"));

console.log(JSON.stringify({ outputs: ["cover.png", "upwork-cover-1600x1200.png", "04-architecture.png", "05-input-output-cases.png"].map(name => resolve(portfolio, name)) }, null, 2));
