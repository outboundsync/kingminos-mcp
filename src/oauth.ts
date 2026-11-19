/**
 * MCP OAuth resource-server side (kingminos-application docs/mcp-oauth-design.md §2.1, §14).
 *
 * - RFC 9728 protected-resource metadata at the path-insert URL and the domain root
 *   (HubSpot looks at the root).
 * - The API's RFC 8414 metadata mirrored at this host's root (HubSpot reads it from
 *   the MCP domain).
 * - 401 + `WWW-Authenticate: Bearer … resource_metadata=…` so clients start sign-in.
 * - OAuth access tokens are validated over the `AUTH_SERVER` service binding
 *   (entrypoint `KingMinosGateway`); tool traffic for them goes over the same
 *   binding. API keys (`km_`, `osr_`, `kmadm_`) keep today's public path.
 *
 * Off unless `OAUTH_ENABLED=on` and the binding is present.
 */
import type { RuntimeEnv } from "./env.js";
import { envString } from "./env.js";

export const OAUTH_SCOPE_BASELINE = "capability:*";
const DEFAULT_ISSUER = "https://api.kingminos.com";
const DEFAULT_RESOURCE = "https://mcp.kingminos.com/mcp";
export const PRM_PATH_INSERT = "/.well-known/oauth-protected-resource/mcp";
export const PRM_ROOT = "/.well-known/oauth-protected-resource";
export const AS_METADATA_PATH = "/.well-known/oauth-authorization-server";
const AS_METADATA_TTL_MS = 5 * 60 * 1000;

/** What `KingMinosGateway.validateToken` returns (library `ValidatedAccessToken`). */
export interface ValidatedToken {
  props: {
    userId?: string;
    workspaceId?: string;
    platform?: string;
    level?: string;
  };
  audience: string;
  /** Unix seconds. */
  expiresAt?: number;
  scope?: string[];
  userId?: string;
  clientId?: string;
}

/** Service binding to kingminos-api `KingMinosGateway`. */
export interface AuthServerBinding {
  validateToken(
    resource: string,
    token: string,
  ): Promise<ValidatedToken | null>;
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

export interface OAuthSettings {
  binding: AuthServerBinding;
  issuer: string;
  resource: string;
  metadataUrl: string;
}

/** Null when OAuth is off: no PRM, no challenge, today's bearer-only `/mcp`. */
export function oauthSettings(
  env: RuntimeEnv,
  binding: AuthServerBinding | undefined,
): OAuthSettings | null {
  if (envString(env, "OAUTH_ENABLED") !== "on" || !binding) {
    return null;
  }
  const resource =
    envString(env, "KINGMINOS_MCP_PUBLIC_URL") ?? DEFAULT_RESOURCE;
  const origin = new URL(resource).origin;
  return {
    binding,
    issuer: envString(env, "OAUTH_ISSUER") ?? DEFAULT_ISSUER,
    resource,
    metadataUrl: `${origin}${PRM_PATH_INSERT}`,
  };
}

/** Library token shape `{userId}:{grantId}:{secret}` — never a `km_`, `osr_` or `kmadm_` key. */
export function looksLikeOAuthToken(token: string): boolean {
  const parts = token.split(":");
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

export function protectedResourceMetadata(
  settings: OAuthSettings,
): Record<string, unknown> {
  return {
    resource: settings.resource,
    authorization_servers: [settings.issuer],
    scopes_supported: [OAUTH_SCOPE_BASELINE],
    bearer_methods_supported: ["header"],
    resource_name: "KingMinos",
    resource_documentation: "https://kingminos.com/docs/mcp/",
  };
}

export function bearerChallenge(
  settings: OAuthSettings,
  error?: "invalid_token",
): string {
  const parts = [
    'realm="KingMinos"',
    `resource_metadata="${settings.metadataUrl}"`,
    `scope="${OAUTH_SCOPE_BASELINE}"`,
  ];
  if (error) {
    parts.push(`error="${error}"`);
  }
  return `Bearer ${parts.join(", ")}`;
}

/**
 * Validate an OAuth access token over the binding. The binding already applies
 * live policy (membership, level, platform block); here we hold it to this
 * resource's audience and expiry. A binding failure is a 503, never a pass.
 */
export async function validateOAuthToken(
  settings: OAuthSettings,
  token: string,
  nowSeconds: number = Date.now() / 1000,
): Promise<ValidatedToken | null> {
  const validated = await settings.binding.validateToken(
    settings.resource,
    token,
  );
  if (!validated) {
    return null;
  }
  if (validated.audience !== settings.resource) {
    return null;
  }
  if (
    typeof validated.expiresAt === "number" &&
    validated.expiresAt <= nowSeconds
  ) {
    return null;
  }
  return validated;
}

/** `(url, init)` fetch that sends tool traffic to the API over the binding. */
export function bindingFetch(
  binding: AuthServerBinding,
): (url: string, init: RequestInit) => Promise<Response> {
  return (url, init) => binding.fetch(new Request(url, init));
}

let asMetadataCache: { issuer: string; body: string; at: number } | null = null;

/** Mirror of the issuer's RFC 8414 document at this host's root (HubSpot reads it here). */
export async function authorizationServerMetadata(
  settings: OAuthSettings,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<Response> {
  const cached = asMetadataCache;
  if (
    cached &&
    cached.issuer === settings.issuer &&
    now - cached.at < AS_METADATA_TTL_MS
  ) {
    return metadataResponse(cached.body);
  }
  const upstream = await fetchImpl(`${settings.issuer}${AS_METADATA_PATH}`, {
    headers: { accept: "application/json" },
  });
  if (!upstream.ok) {
    return new Response(
      JSON.stringify({ error: "authorization_server_unavailable" }),
      {
        status: 502,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }
  const body = await upstream.text();
  asMetadataCache = { issuer: settings.issuer, body, at: now };
  return metadataResponse(body);
}

export function resetAuthorizationServerMetadataCache(): void {
  asMetadataCache = null;
}

function metadataResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}

/**
 * Tools an OAuth caller may see — the API refuses everything else for OAuth
 * tokens (403 `oauth_route_denied`): lookups, catalog reads, run reads,
 * balance reads, feedback. Mirrors kingminos-application `oauthRouteAllowed`.
 */
const OAUTH_GET_PATHS = new Set([
  "/v1/providers",
  "/v1/capabilities",
  "/v1/recipes",
  "/v1/balance",
  "/v1/balance/health",
]);

export function oauthToolAllowed(route: {
  method: string;
  path: string;
}): boolean {
  if (route.method === "POST") {
    return (
      route.path === "/v1/feedback" ||
      /^\/v1\/(company|person|email)\/[a-z0-9-]+$/.test(route.path)
    );
  }
  if (route.method === "GET") {
    return (
      OAUTH_GET_PATHS.has(route.path) ||
      /^\/v1\/runs\/\{[^}]+\}$/.test(route.path)
    );
  }
  return false;
}
