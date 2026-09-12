#!/usr/bin/env python3
"""Loopback-only gateway for the local SmolVLM zero-shot experiment.

This is an experiment gateway, not a production service. It accepts the
provider-neutral request emitted by lib/vlm.ts, runs one local image+text
generation, and returns the model's raw text in an ``output`` field. The
TypeScript adapter remains responsible for strict JSON/box/label validation.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import torch
from PIL import Image
from transformers import AutoModelForVision2Seq, AutoProcessor


class VlmGateway:
    def __init__(self, model_name: str, device: str, max_new_tokens: int):
        self.model_name = model_name
        self.device = torch.device(device)
        self.max_new_tokens = max_new_tokens
        if self.device.type == "cpu":
            torch.set_num_threads(max(1, min(8, os.cpu_count() or 1)))
        self.processor = AutoProcessor.from_pretrained(model_name)
        self.model = AutoModelForVision2Seq.from_pretrained(
            model_name,
            torch_dtype=torch.float32 if self.device.type == "cpu" else torch.float16,
        ).to(self.device)
        self.model.eval()

    def inspect(self, request: dict[str, Any]) -> tuple[str, int]:
        image_data = request.get("request", {}).get("image", {})
        prompt = request.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("request prompt is required")
        encoded = image_data.get("base64")
        if not isinstance(encoded, str) or not encoded:
            raise ValueError("request image.base64 is required")
        try:
            image = Image.open(io.BytesIO(base64.b64decode(encoded, validate=True))).convert("RGB")
        except Exception as error:  # noqa: BLE001 - turn malformed input into a 400 response
            raise ValueError("request image.base64 is not a valid image") from error

        messages = [{
            "role": "user",
            "content": [{"type": "image"}, {"type": "text", "text": prompt}],
        }]
        chat_prompt = self.processor.apply_chat_template(messages, add_generation_prompt=True)
        inputs = self.processor(text=chat_prompt, images=[image], return_tensors="pt")
        inputs = {key: value.to(self.device) if hasattr(value, "to") else value for key, value in inputs.items()}
        started = time.perf_counter()
        with torch.inference_mode():
            generated = self.model.generate(**inputs, max_new_tokens=self.max_new_tokens, do_sample=False)
        generated_tokens = generated[:, inputs["input_ids"].shape[-1]:]
        text = self.processor.batch_decode(generated_tokens, skip_special_tokens=True)[0].strip()
        elapsed_ms = round((time.perf_counter() - started) * 1000)
        return text, elapsed_ms


class Handler(BaseHTTPRequestHandler):
    gateway: VlmGateway

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path != "/inspect":
            self._send(404, {"error": "Only POST /inspect is supported."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 30 * 1024 * 1024:
                raise ValueError("request body must be between 1 byte and 30 MB")
            payload = json.loads(self.rfile.read(length))
            output, inference_ms = self.gateway.inspect(payload)
            self._send(200, {"output": output, "serverInferenceMs": inference_ms})
        except ValueError as error:
            self._send(400, {"error": str(error)})
        except Exception as error:  # noqa: BLE001 - keep gateway errors visible to the runner
            self._send(500, {"error": f"local VLM inference failed: {error}"})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[local-vlm] {format % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a loopback-only local SmolVLM gateway.")
    parser.add_argument("--model", default="HuggingFaceTB/SmolVLM-256M-Instruct")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8008)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--max-new-tokens", type=int, default=320)
    args = parser.parse_args()
    Handler.gateway = VlmGateway(args.model, args.device, args.max_new_tokens)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[local-vlm] listening on http://{args.host}:{args.port}/inspect with {args.model}")
    server.serve_forever()


if __name__ == "__main__":
    main()
