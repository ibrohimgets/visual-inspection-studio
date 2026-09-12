import { open } from "node:fs/promises";

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const url = argument("url");
const output = argument("output");
const size = Number(argument("bytes"));
const concurrency = Math.max(1, Math.min(32, Number(argument("concurrency", "12"))));
if (!url || !output || !Number.isSafeInteger(size) || size <= 0) {
  throw new Error("Usage: node scripts/download-model-file.mjs --url URL --output FILE --bytes SIZE [--concurrency 12]");
}

const redirect = await fetch(url, { redirect: "manual" });
if (redirect.status < 300 || redirect.status >= 400 || !redirect.headers.get("location")) {
  throw new Error(`Expected a download redirect, received HTTP ${redirect.status}.`);
}
const downloadUrl = redirect.headers.get("location");
const file = await open(output, "w");
await file.truncate(size);
const chunkSize = 16 * 1024 * 1024;
const ranges = [];
for (let start = 0; start < size; start += chunkSize) ranges.push([start, Math.min(size - 1, start + chunkSize - 1)]);
let completed = 0;
let next = 0;
const worker = async () => {
  while (true) {
    const index = next++;
    if (index >= ranges.length) return;
    const [start, end] = ranges[index];
    let lastError;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const response = await fetch(downloadUrl, { headers: { Range: `bytes=${start}-${end}` } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length !== end - start + 1) throw new Error(`Expected ${end - start + 1} bytes, received ${bytes.length}`);
        await file.write(bytes, 0, bytes.length, start);
        completed++;
        console.log(`Downloaded chunk ${completed}/${ranges.length}`);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, attempt * 1500));
      }
    }
    if (lastError) throw new Error(`Chunk ${start}-${end} failed: ${lastError.message}`);
  }
};
await Promise.all(Array.from({ length: Math.min(concurrency, ranges.length) }, worker));
await file.close();
console.log(`Saved ${size} bytes to ${output}`);
