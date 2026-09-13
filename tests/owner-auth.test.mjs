import assert from "node:assert/strict";
import test from "node:test";
import { hasOwnerAccess, ownerAccessMode } from "../lib/owner-auth.ts";

const request = visitorId => new Request("https://example.test/api/session", {
  headers: visitorId ? { "oai-authenticated-user-id": visitorId } : {},
});

test("production access fails closed when no owner is configured", () => {
  assert.equal(hasOwnerAccess(request("owner-1"), { ownerId: "", environment: "production" }), false);
  assert.equal(ownerAccessMode(request(), { ownerId: "", environment: "production" }), "public");
});

test("only the configured authenticated user receives owner access", () => {
  const options = { ownerId: "owner-1", environment: "production" };
  assert.equal(hasOwnerAccess(request(), options), false);
  assert.equal(hasOwnerAccess(request("someone-else"), options), false);
  assert.equal(hasOwnerAccess(request("owner-1"), options), true);
  assert.equal(ownerAccessMode(request("owner-1"), options), "owner");
});

test("local development can exercise owner mode without a committed identifier", () => {
  assert.equal(hasOwnerAccess(request(), { ownerId: "", environment: "development" }), true);
});
