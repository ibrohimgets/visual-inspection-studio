import { DEFAULT_RULE_EXTRACTION_MODEL, extractRulesWithOpenAI, SpecExtractionError } from "@/lib/spec-extraction";
import { hasOwnerAccess } from "@/lib/owner-auth";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  if (!hasOwnerAccess(request)) {
    return json({ error: {
      code: "OWNER_ACCESS_REQUIRED",
      message: "Live rule extraction is available only in owner mode. The public walkthrough uses a recorded, zero-cost candidate.",
    } }, 403);
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 1_000_000) {
    return json({ error: { code: "REQUEST_TOO_LARGE", message: "The extracted PDF text request is too large." } }, 413);
  }

  let document: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 1_000_000) {
      return json({ error: { code: "REQUEST_TOO_LARGE", message: "The extracted PDF text request is too large." } }, 413);
    }
    document = JSON.parse(body);
  } catch {
    return json({ error: { code: "INVALID_JSON", message: "The request body must be valid JSON." } }, 400);
  }

  try {
    const result = await extractRulesWithOpenAI({
      apiKey: process.env.OPENAI_API_KEY ?? "",
      model: process.env.OPENAI_RULE_EXTRACTION_MODEL ?? DEFAULT_RULE_EXTRACTION_MODEL,
      document,
    });
    return json(result);
  } catch (error) {
    if (error instanceof SpecExtractionError) {
      return json({ error: { code: error.code, message: error.message } }, error.status);
    }
    return json({ error: { code: "EXTRACTION_FAILED", message: "Rule extraction failed safely. No policy was activated." } }, 500);
  }
}
