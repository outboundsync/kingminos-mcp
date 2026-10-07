import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { envString, processRuntimeEnv, type RuntimeEnv } from "./env.js";
import { isLoopbackHost, normalizeHostname } from "./hosts.js";

export const SERVICE_NAME = "kingminos-mcp";
export const PRODUCT_NAME = "KingMinos by OutboundSync";
export const VERSION = "2026.10.03.0";
export const MCP_PROTOCOL = LATEST_PROTOCOL_VERSION;

export const DEFAULT_API_BASE_URL = "https://api.kingminos.com";
export const DEFAULT_PORT = 8080;
export const DEFAULT_LISTEN_HOST = "127.0.0.1";
export const UPSTREAM_TIMEOUT_MS = 30_000;
export const RETRY_DELAY_MS = 1_000;
export const MAX_RATE_LIMIT_WAIT_MS = 5_000;
export const MAX_REQUEST_BODY_BYTES = 1_048_576;
export const OPENAPI_FETCH_TIMEOUT_MS = 10_000;

/** Tenant Bearer for the KingMinos API. Name only — never log or print the value. */
export const TENANT_BEARER_ENV = "KINGMINOS_API_KEY";

export const API_BASE_URL_ENV = "KINGMINOS_API_URL";
export const PORT_ENV = "PORT";
export const HOST_ENV = "HOST";
export const ALLOWED_HOSTS_ENV = "KINGMINOS_MCP_ALLOWED_HOSTS";
export const ALLOWED_ORIGINS_ENV = "KINGMINOS_MCP_ALLOWED_ORIGINS";
export const PUBLIC_URL_ENV = "KINGMINOS_MCP_PUBLIC_URL";
export const ALLOW_ENV_BEARER_ENV = "KINGMINOS_MCP_ALLOW_ENV_BEARER";

/** Documented public MCP URL (custom domain attached in Cloudflare / wrangler.jsonc). */
export const DOCUMENTED_PUBLIC_MCP_URL = "https://mcp.kingminos.com/mcp";

const DEFAULT_ORIGIN_HOSTS = [
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "mcp.kingminos.com",
] as const;

const DEFAULT_NODE_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"] as const;

export function apiBaseUrl(env: RuntimeEnv = processRuntimeEnv()): string {
  const raw = envString(env, API_BASE_URL_ENV);
  return (raw && raw.length > 0 ? raw : DEFAULT_API_BASE_URL).replace(
    /\/$/,
    "",
  );
}

export function listenPort(env: RuntimeEnv = processRuntimeEnv()): number {
  const raw = envString(env, PORT_ENV);
  if (raw && /^\d+$/.test(raw)) {
    return Number(raw);
  }
  return DEFAULT_PORT;
}

export function listenHost(env: RuntimeEnv = processRuntimeEnv()): string {
  return envString(env, HOST_ENV) ?? DEFAULT_LISTEN_HOST;
}

export function tenantBearerFromEnv(
  env: RuntimeEnv = processRuntimeEnv(),
): string | undefined {
  return envString(env, TENANT_BEARER_ENV);
}

export function allowEnvBearerOptIn(
  env: RuntimeEnv = processRuntimeEnv(),
): boolean {
  return envString(env, ALLOW_ENV_BEARER_ENV) === "1";
}

function parseHostList(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => normalizeHostname(part))
    .filter((part) => part.length > 0);
}

export function allowedHosts(
  env: RuntimeEnv = processRuntimeEnv(),
  mode: "worker" | "node" = "worker",
): string[] {
  const raw = envString(env, ALLOWED_HOSTS_ENV);
  if (raw) {
    return parseHostList(raw);
  }
  if (mode === "node") {
    return DEFAULT_NODE_HOSTS.map((host) => normalizeHostname(host));
  }
  return [];
}

export function allowedOriginHosts(
  env: RuntimeEnv = processRuntimeEnv(),
): string[] {
  const raw = envString(env, ALLOWED_ORIGINS_ENV);
  const extras = raw
    ? raw.split(",").flatMap((part) => {
        const trimmed = part.trim();
        if (!trimmed) {
          return [];
        }
        if (trimmed.includes("://")) {
          try {
            return [normalizeHostname(new URL(trimmed).hostname)];
          } catch {
            return [];
          }
        }
        return [normalizeHostname(trimmed)];
      })
    : [];
  return [
    ...new Set([
      ...DEFAULT_ORIGIN_HOSTS.map((host) => normalizeHostname(host)),
      ...extras,
    ]),
  ];
}

export function publicMcpUrl(env: RuntimeEnv = processRuntimeEnv()): string {
  const raw = envString(env, PUBLIC_URL_ENV);
  if (raw && raw.length > 0) {
    return raw.replace(/\/$/, "");
  }
  return `http://127.0.0.1:${listenPort(env)}/mcp`;
}

export { isLoopbackHost };
