#!/usr/bin/env python3
"""Loopback gateway from the project VLM contract to OpenAI Responses API.

The API key is read only from OPENAI_API_KEY. It is never accepted in an HTTP
request, written to disk, or returned to the caller. The public browser app
must not call this gateway unless it is running on the same trusted machine.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import requests


def inspection_schema(labels: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["status", "summary", "findings"],
        "properties": {
            "status": {"type": "string", "enum": ["normal", "suspected_defect", "uncertain"]},
            "summary": {"type": "string"},
            "findings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["label", "box", "modelScore", "evidence", "uncertainty"],
                    "properties": {
                        "label": {"type": "string", "enum": labels},
                        "box": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["x", "y", "width", "height"],
                            "properties": {
                                "x": {"type": "number"},
                                "y": {"type": "number"},
                                "width": {"type": "number"},
                                "height": {"type": "number"},
                            },
                        },
                        "modelScore": {"type": "number"},
                        "evidence": {"type": "string"},
                        "uncertainty": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["level", "reasons"],
                            "properties": {
                                "level": {"type": "string", "enum": ["low", "medium", "high"]},
                                "reasons": {"type": "array", "items": {"type": "string"}},
                            },
                        },
                    },
                },
            },
        },
    }


def output_text(response: dict[str, Any]) -> str:
    for item in response.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                return content["text"]
    raise RuntimeError("OpenAI response did not contain output_text")


class OpenAIGateway:
    def __init__(self, model: str, reasoning_effort: str, timeout_seconds: int):
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        self.api_key = api_key
        self.model = model
        self.reasoning_effort = reasoning_effort
        self.timeout_seconds = timeout_seconds

    def inspect(self, envelope: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        request = envelope.get("request", {})
        image = request.get("image", {})
        task = request.get("task", {})
        prompt = envelope.get("prompt")
        if envelope.get("model") != self.model:
            raise ValueError(f"gateway is configured for {self.model}")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("request prompt is required")
        encoded = image.get("base64")
        mime_type = image.get("mimeType")
        if not isinstance(encoded, str) or not encoded or not isinstance(mime_type, str) or not mime_type.startswith("image/"):
            raise ValueError("request image must contain base64 data and an image MIME type")
        try:
            base64.b64decode(encoded, validate=True)
        except Exception as error:  # noqa: BLE001 - normalize malformed input
            raise ValueError("request image.base64 is invalid") from error
        labels = [item.get("label") for item in task.get("classes", []) if isinstance(item, dict) and isinstance(item.get("label"), str)]
        if not labels:
            raise ValueError("request task.classes must contain labels")

        client_request_id = str(uuid.uuid4())
        body = {
            "model": self.model,
            "store": False,
            "reasoning": {"effort": self.reasoning_effort},
            "max_output_tokens": 1200,
            "text": {
                "verbosity": "low",
                "format": {
                    "type": "json_schema",
                    "name": "industrial_inspection",
                    "strict": True,
                    "schema": inspection_schema(labels),
                },
            },
            "input": [{
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": f"data:{mime_type};base64,{encoded}", "detail": "high"},
                ],
            }],
        }
        started = time.perf_counter()
        response = requests.post(
            "https://api.openai.com/v1/responses",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "X-Client-Request-Id": client_request_id,
            },
            json=body,
            timeout=self.timeout_seconds,
        )
        elapsed_ms = round((time.perf_counter() - started) * 1000)
        try:
            payload = response.json()
        except ValueError as error:
            raise RuntimeError(f"OpenAI returned HTTP {response.status_code} with a non-JSON body") from error
        if not response.ok:
            message = payload.get("error", {}).get("message", "request failed") if isinstance(payload, dict) else "request failed"
            raise RuntimeError(f"OpenAI returned HTTP {response.status_code}: {message}")
        return output_text(payload), {
            "provider": "openai",
            "model": payload.get("model", self.model),
            "responseId": payload.get("id"),
            "requestId": response.headers.get("x-request-id"),
            "clientRequestId": client_request_id,
            "providerLatencyMs": elapsed_ms,
            "usage": payload.get("usage"),
            "stored": False,
        }


class Handler(BaseHTTPRequestHandler):
    gateway: OpenAIGateway

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
            output, metadata = self.gateway.inspect(json.loads(self.rfile.read(length)))
            self._send(200, {"output": output, "metadata": metadata})
        except ValueError as error:
            self._send(400, {"error": str(error)})
        except Exception as error:  # noqa: BLE001 - return a sanitized provider error
            self._send(502, {"error": str(error)})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[openai-vlm] {format % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the loopback OpenAI VLM gateway.")
    parser.add_argument("--model", default="gpt-5.6-terra")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8010)
    parser.add_argument("--reasoning-effort", choices=["none", "low", "medium", "high", "xhigh", "max"], default="low")
    parser.add_argument("--timeout", type=int, default=300)
    args = parser.parse_args()
    Handler.gateway = OpenAIGateway(args.model, args.reasoning_effort, args.timeout)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[openai-vlm] listening on http://{args.host}:{args.port}/inspect with {args.model}")
    server.serve_forever()


if __name__ == "__main__":
    main()
