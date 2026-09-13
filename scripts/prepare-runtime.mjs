import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const root = new URL("../", import.meta.url);
await mkdir(new URL("public/runtime/", root), { recursive: true });
for (const name of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) {
  await copyFile(new URL(`node_modules/onnxruntime-web/dist/${name}`, root), new URL(`public/runtime/${name}`, root));
}
await copyFile(new URL("public/models/ONNX-Runtime-LICENSE.txt", root), new URL("public/runtime/LICENSE.txt", root));
await copyFile(new URL("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", root), new URL("public/runtime/pdf.worker.min.mjs", root));
await copyFile(new URL("node_modules/pdfjs-dist/LICENSE", root), new URL("public/runtime/PDFJS-LICENSE.txt", root));
// Keep browser-only framework/HMR modules out of the inference worker.
await build({
  entryPoints: [fileURLToPath(new URL("lib/inference.worker.ts", root))],
  outfile: fileURLToPath(new URL("public/runtime/inference.worker.js", root)),
  bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true,
  conditions: ["onnxruntime-web-use-extern-wasm"],
});
console.log("ONNX Runtime assets ready.");
