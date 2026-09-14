import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const BASE_URL = process.argv[2] ?? "http://localhost:5173/";
const OUTPUT_ROOT = resolve(ROOT, process.argv[3] ?? "docs/portfolio");
const PORT = 9339;
const candidates = process.platform === "win32" ? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
] : process.platform === "darwin" ? [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
] : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge"];
const browserPath = process.env.PORTFOLIO_BROWSER || candidates.find(existsSync);
if (!browserPath) throw new Error("Set PORTFOLIO_BROWSER to a Chromium-based browser executable.");

const profile = await mkdtemp(join(tmpdir(), "visual-inspection-capture-"));
await mkdir(OUTPUT_ROOT, { recursive: true });
const browser = spawn(browserPath, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--window-size=1440,1000",
  BASE_URL,
], { stdio: "ignore" });

const wait = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));

async function poll(operation, description, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${description}.${lastError ? ` ${lastError.message}` : ""}`);
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolvePromise, reject) => {
      this.socket.addEventListener("open", resolvePromise, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve: resolvePromise, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolvePromise(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

let client;
try {
  const target = await poll(async () => {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const targets = await response.json();
    return targets.find(item => item.type === "page" && item.url.startsWith(BASE_URL));
  }, "the headless browser target");
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await poll(async () => {
    const result = await client.send("Runtime.evaluate", { expression: "document.readyState === 'complete' && !!document.querySelector('.premium-hero')", returnByValue: true });
    return result.result.value;
  }, "the overview page");

  async function evaluate(expression) {
    const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "Browser evaluation failed.");
    return result.result.value;
  }

  async function waitForText(text) {
    return poll(() => evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`), JSON.stringify(text));
  }

  async function capture(name) {
    await wait(250);
    const result = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
    const output = resolve(OUTPUT_ROOT, name);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, Buffer.from(result.data, "base64"));
    return output;
  }

  await evaluate("document.fonts.ready");
  await client.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await wait(1_000);
  await evaluate("window.scrollTo(0, 0)");
  const outputs = [await capture("site-home.png")];
  await evaluate("[...document.querySelectorAll('.premium-button')].find(button => button.textContent.includes('Try Demo')).click()");
  await waitForText("Approve & activate policy");
  await evaluate("window.scrollTo(0, document.querySelector('.workspace-tabs').offsetTop - 12)");
  outputs.push(await capture("01-spec-to-rules.png"));
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('Approve & activate policy')).click()");
  await waitForText("Open inspection cases");
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('Open inspection cases')).click()");
  await waitForText("Open review workspace");
  await evaluate("document.querySelector('.preview-review-action').click()");
  await waitForText("Recorded specialized-detector evidence");
  await evaluate("window.scrollTo(0, document.querySelector('.workspace-tabs').offsetTop - 12)");
  outputs.push(await capture("02-inspection-review.png"));
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('View decision trace')).click()");
  await waitForText("ORDERED AUDIT TRAIL");
  await evaluate("window.scrollTo(0, document.querySelector('.workspace-tabs').offsetTop - 12)");
  outputs.push(await capture("03-decision-trace.png"));
  await client.send("Page.navigate", { url: BASE_URL });
  await waitForText("AI-powered");
  await poll(() => evaluate("document.querySelector('.access-badge')?.textContent.includes('Safe public demo') || !!document.querySelector('.access-switch')"), "client hydration");
  const outcomes = [];
  for (let index = 0; index < 3; index += 1) {
    await evaluate(`document.querySelectorAll('.preview-case-picker button')[${index}].click()`);
    await wait(100);
    outcomes.push(await evaluate("document.querySelector('.preview-decision > strong').childNodes[0].textContent"));
  }
  if (outcomes.join(',') !== 'PASS,REVIEW,FAIL') throw new Error(`Unexpected preview outcomes: ${outcomes}`);
  await evaluate("document.querySelector('.preview-segment button').click()");
  if (await evaluate("document.querySelectorAll('.preview-image .pcb-region').length") !== 0) throw new Error("Original view still shows boxes.");
  await evaluate("document.querySelectorAll('.preview-segment button')[1].click()");
  if (await evaluate("document.querySelectorAll('.preview-image .pcb-region').length") !== 1) throw new Error("Detection view is missing its box.");
  await evaluate("document.querySelector('#product-preview').scrollIntoView()");
  outputs.push(await capture("06-interactive-preview.png"));
  await evaluate("document.querySelector('#performance').scrollIntoView()");
  outputs.push(await capture("08-performance.png"));
  await evaluate("document.querySelector('.defect-detail-section').scrollIntoView()");
  outputs.push(await capture("09-defect-detail.png"));
  await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate("window.scrollTo(0,0)");
  await wait(300);
  const mobile = await evaluate("({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, heroWidth: document.querySelector('.premium-hero').getBoundingClientRect().width })");
  if (mobile.documentWidth > mobile.width) throw new Error(`Mobile overflow: ${JSON.stringify(mobile)}`);
  outputs.push(await capture("07-mobile-home.png"));
  await client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate("window.scrollTo(0,0)");
  console.log(JSON.stringify({ baseUrl: BASE_URL, outputs }, null, 2));
} finally {
  client?.close();
  browser.kill();
  await Promise.race([
    new Promise(resolvePromise => browser.once("exit", resolvePromise)),
    wait(2_000),
  ]);
  const resolvedProfile = resolve(profile);
  if (resolvedProfile.startsWith(resolve(tmpdir()))) {
    try { await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }); }
    catch (error) { console.warn(`Temporary browser profile could not be removed: ${error.code ?? "unknown error"}`); }
  }
}
