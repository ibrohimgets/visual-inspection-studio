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
    const result = await client.send("Runtime.evaluate", { expression: "document.readyState === 'complete' && !!document.querySelector('.overview-proof')", returnByValue: true });
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
  await wait(1_000);
  await evaluate("window.scrollTo(0, 0)");
  const outputs = [await capture("cover.png")];
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('Start 30-second demo')).click()");
  await waitForText("Approve & activate policy");
  await evaluate("window.scrollTo(0, document.querySelector('.workspace-tabs').offsetTop - 12)");
  outputs.push(await capture("01-spec-to-rules.png"));
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('Approve & activate policy')).click()");
  await waitForText("Open inspection cases");
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('Open inspection cases')).click()");
  await waitForText("Open review workspace");
  await evaluate("document.querySelectorAll('.case-link')[2].click()");
  await waitForText("Recorded specialized-detector evidence");
  await evaluate("window.scrollTo(0, document.querySelector('.workspace-tabs').offsetTop - 12)");
  outputs.push(await capture("02-inspection-review.png"));
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('View decision trace')).click()");
  await waitForText("ORDERED AUDIT TRAIL");
  await evaluate("window.scrollTo(0, document.querySelector('.workspace-tabs').offsetTop - 12)");
  outputs.push(await capture("03-decision-trace.png"));
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
