export type OwnerAccessOptions = {
  ownerId?: string;
  environment?: string;
};

export function hasOwnerAccess(request: Request, options: OwnerAccessOptions = {}) {
  const ownerId = (options.ownerId ?? process.env.OWNER_ACCOUNT_USER_ID ?? "").trim();
  const environment = options.environment ?? process.env.NODE_ENV ?? "production";
  if (!ownerId) return environment === "development";
  const visitorId = request.headers.get("oai-authenticated-user-id")?.trim() ?? "";
  return visitorId.length > 0 && visitorId === ownerId;
}

export function ownerAccessMode(request: Request, options: OwnerAccessOptions = {}) {
  return hasOwnerAccess(request, options) ? "owner" as const : "public" as const;
}
