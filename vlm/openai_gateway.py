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


def image_content(image: dict[str, Any], field: str) -> dict[str, str]:
    encoded = image.get("base64")
    mime_type = image.get("mimeType")
    if not isinstance(encoded, str) or not encoded or not isinstance(mime_type, str) or not mime_type.startswith("image/"):
        raise ValueError(f"{field} must contain base64 data and an image MIME type")
    try:
        base64.b64decode(encoded, validate=True)
    except Exception as error:  # noqa: BLE001 - normalize malformed input
        raise ValueError(f"{field}.base64 is invalid") from error
    return {"type": "input_image", "image_url": f"data:{mime_type};base64,{encoded}", "detail": "high"}


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
                                "reasons": {"type": "array", "minItems": 1, "items": {"type": "string", "minLength": 1}},
                            },
                        },
                    },
                },
            },
        },
    }


def proposal_verification_schema(labels: list[str], candidate_ids: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["decisions"],
        "properties": {
            "decisions": {
                "type": "array",
                "minItems": len(candidate_ids),
                "maxItems": len(candidate_ids),
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["candidateId", "verdict", "label", "modelScore", "evidence", "uncertainty"],
                    "properties": {
                        "candidateId": {"type": "string", "enum": candidate_ids},
                        "verdict": {"type": "string", "enum": ["confirm", "relabel", "reject", "uncertain"]},
                        "label": {"type": "string", "enum": labels},
                        "modelScore": {"type": "number", "minimum": 0, "maximum": 1},
                        "evidence": {"type": "string", "minLength": 1},
                        "uncertainty": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["level", "reasons"],
                            "properties": {
                                "level": {"type": "string", "enum": ["low", "medium", "high"]},
                                "reasons": {"type": "array", "minItems": 1, "items": {"type": "string", "minLength": 1}},
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
    def __init__(self, model: str, reasoning_effort: str, timeout_seconds: int, max_output_tokens: int):
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        self.api_key = api_key
        self.model = model
        self.reasoning_effort = reasoning_effort
        self.timeout_seconds = timeout_seconds
        self.max_output_tokens = max_output_tokens

    def _request(self, body: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        client_request_id = str(uuid.uuid4())
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
        return payload, {
            "provider": "openai",
            "model": payload.get("model", self.model),
            "responseId": payload.get("id"),
            "requestId": response.headers.get("x-request-id"),
            "clientRequestId": client_request_id,
            "providerLatencyMs": elapsed_ms,
            "usage": payload.get("usage"),
            "serviceTier": payload.get("service_tier"),
            "stored": False,
        }

    def inspect(self, envelope: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        request = envelope.get("request", {})
        image = request.get("image", {})
        task = request.get("task", {})
        prompt = envelope.get("prompt")
        if envelope.get("model") != self.model:
            raise ValueError(f"gateway is configured for {self.model}")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("request prompt is required")
        query_image = image_content(image, "request image")
        labels = [item.get("label") for item in task.get("classes", []) if isinstance(item, dict) and isinstance(item.get("label"), str)]
        if not labels:
            raise ValueError("request task.classes must contain labels")

        content: list[dict[str, str]] = [{"type": "input_text", "text": prompt}]
        support_examples = request.get("supportExamples", [])
        if not isinstance(support_examples, list):
            raise ValueError("request supportExamples must be an array")
        for index, example in enumerate(support_examples):
            if not isinstance(example, dict) or not isinstance(example.get("image"), dict):
                raise ValueError(f"support example {index} must contain an image")
            annotations = example.get("annotations", [])
            annotation_text = "; ".join(
                f"{item.get('label')} at x={item.get('x')}, y={item.get('y')}, width={item.get('width')}, height={item.get('height')}"
                for item in annotations if isinstance(item, dict)
            )
            content.append({
                "type": "input_text",
                "text": f"Approved training support image {index + 1} ({example.get('id', 'unknown')}): {annotation_text or example.get('label', 'label unavailable')}",
            })
            content.append(image_content(example["image"], f"support example {index} image"))
        content.extend([
            {"type": "input_text", "text": "Query image: inspect this image and return findings only for this query, not for the support examples."},
            query_image,
        ])

        body = {
            "model": self.model,
            "store": False,
            "reasoning": {"effort": self.reasoning_effort},
            "max_output_tokens": self.max_output_tokens,
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
                "content": content,
            }],
        }
        payload, metadata = self._request(body)
        return output_text(payload), metadata

    def verify_proposals(self, envelope: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        if envelope.get("model") != self.model:
            raise ValueError(f"gateway is configured for {self.model}")
        image = envelope.get("image", {})
        candidates = envelope.get("candidates", [])
        labels = envelope.get("labels", [])
        if not isinstance(candidates, list) or not 1 <= len(candidates) <= 8:
            raise ValueError("candidates must contain between 1 and 8 proposals")
        if not isinstance(labels, list) or not labels or not all(isinstance(label, str) and label for label in labels):
            raise ValueError("labels must be a non-empty string array")
        candidate_ids = [candidate.get("candidateId") for candidate in candidates if isinstance(candidate, dict)]
        if len(candidate_ids) != len(candidates) or not all(isinstance(candidate_id, str) and candidate_id for candidate_id in candidate_ids) or len(set(candidate_ids)) != len(candidate_ids):
            raise ValueError("every candidate needs a unique candidateId")
        rows = []
        for candidate in candidates:
            detector_label = candidate.get("detectorLabel")
            detector_score = candidate.get("detectorScore")
            if detector_label not in labels or not isinstance(detector_score, (float, int)):
                raise ValueError("every candidate needs a valid detectorLabel and detectorScore")
            rows.append(f"{candidate['candidateId']}: detector hypothesis {detector_label}, detector score {detector_score:.4f}")
        prompt = "\n".join([
            "You are verifying uncertain PCB defect proposals, not searching the full board.",
            "The image is a contact sheet. Each panel has a candidate ID and a cyan rectangle marking the detector proposal.",
            "Inspect every panel independently and return exactly one decision for every candidate ID.",
            "confirm means the marked region contains the proposed defect class; relabel means a visible defect exists but another allowed class is better; reject means the marked feature is normal material or an artifact; uncertain means the crop cannot support a reliable decision.",
            "Do not trust the detector hypothesis automatically. modelScore is an uncalibrated confidence in your verdict, not a probability.",
            "For reject or uncertain, repeat the detector hypothesis in label because the schema requires an allowed label.",
            "Candidates:",
            *rows,
        ])
        body = {
            "model": self.model,
            "store": False,
            "reasoning": {"effort": self.reasoning_effort},
            "max_output_tokens": self.max_output_tokens,
            "text": {
                "verbosity": "low",
                "format": {
                    "type": "json_schema",
                    "name": "pcb_proposal_verification",
                    "strict": True,
                    "schema": proposal_verification_schema(labels, candidate_ids),
                },
            },
            "input": [{
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    image_content(image, "proposal contact sheet"),
                ],
            }],
        }
        payload, metadata = self._request(body)
        return output_text(payload), metadata


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
        if self.path not in {"/inspect", "/verify-proposals"}:
            self._send(404, {"error": "Only POST /inspect and POST /verify-proposals are supported."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 30 * 1024 * 1024:
                raise ValueError("request body must be between 1 byte and 30 MB")
            envelope = json.loads(self.rfile.read(length))
            output, metadata = self.gateway.inspect(envelope) if self.path == "/inspect" else self.gateway.verify_proposals(envelope)
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
    parser.add_argument("--max-output-tokens", type=int, default=2400)
    args = parser.parse_args()
    if args.max_output_tokens < 256:
        parser.error("--max-output-tokens must be at least 256")
    Handler.gateway = OpenAIGateway(args.model, args.reasoning_effort, args.timeout, args.max_output_tokens)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[openai-vlm] listening on http://{args.host}:{args.port}/inspect with {args.model}")
    server.serve_forever()


if __name__ == "__main__":
    main()
