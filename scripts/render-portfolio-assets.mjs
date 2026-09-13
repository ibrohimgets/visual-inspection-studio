import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const portfolio = resolve(root, "docs/portfolio");
await mkdir(portfolio, { recursive: true });
await sharp(resolve(portfolio, "architecture.svg")).png().toFile(resolve(portfolio, "04-architecture.png"));
const cover = await sharp(resolve(portfolio, "cover.png")).resize({ width: 1600 }).png().toBuffer();
const coverMetadata = await sharp(cover).metadata();
const verticalPadding = Math.max(0, 1200 - (coverMetadata.height ?? 0));
await sharp(cover).extend({
  top: Math.floor(verticalPadding / 2),
  bottom: Math.ceil(verticalPadding / 2),
  left: 0,
  right: 0,
  background: "#070d16",
}).png().toFile(resolve(portfolio, "upwork-cover-1600x1200.png"));

const demo = JSON.parse(await readFile(resolve(root, "public/examples/pcb-demo/demo.json"), "utf8"));
const outcomeColor = { PASS: "#3e8b68", REVIEW: "#b17923", FAIL: "#b54c43" };
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
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

console.log(JSON.stringify({ outputs: ["04-architecture.png", "upwork-cover-1600x1200.png", "05-input-output-cases.png"].map(name => resolve(portfolio, name)) }, null, 2));
