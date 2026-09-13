import { ownerAccessMode } from "@/lib/owner-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const mode = ownerAccessMode(request);
  return Response.json({ mode, canUseLiveExtraction: mode === "owner" }, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      Vary: "oai-authenticated-user-id",
    },
  });
}
