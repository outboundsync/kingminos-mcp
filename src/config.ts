import { envString, processRuntimeEnv, type RuntimeEnv } from "./env.js";

export const SERVICE_NAME = "kingminos-mcp";
export const PRODUCT_NAME = "KingMinos by OutboundSync";
export const VERSION = "2026.10.03.0";
export const MCP_PROTOCOL = "2026-07-28";

export const DEFAULT_API_BASE_URL = "https://api.kingminos.com";
export const DEFAULT_PORT = 8080;
export const UPSTREAM_TIMEOUT_MS = 30_000;
export const RETRY_DELAY_MS = 1_000;

/** Tenant Bearer for the KingMinos API. Name only — never log or print the value. */
export const TENANT_BEARER_ENV = "KINGMINOS_API_KEY";

export const API_BASE_URL_ENV = "KINGMINOS_API_URL";
export const PORT_ENV = "PORT";
export const ALLOWED_HOSTS_ENV = "KINGMINOS_MCP_ALLOWED_HOSTS";
export const PUBLIC_URL_ENV = "KINGMINOS_MCP_PUBLIC_URL";

/** Documented public MCP URL. DNS for this host is a separate attach step. */
export const DOCUMENTED_PUBLIC_MCP_URL = "https://mcp.kingminos.com/mcp";

export function apiBaseUrl(env: RuntimeEnv = processRuntimeEnv()): string {
  const raw = envString(env, API_BASE_URL_ENV);
  return (raw && raw.length > 0 ? raw : DEFAULT_API_BASE_URL).replace(/\/$/, "");
}

export function listenPort(env: RuntimeEnv = processRuntimeEnv()): number {
  const raw = envString(env, PORT_ENV);
  if (raw && /^\d+$/.test(raw)) {
    return Number(raw);
  }
  return DEFAULT_PORT;
}

export function tenantBearerFromEnv(env: RuntimeEnv = processRuntimeEnv()): string | undefined {
  return envString(env, TENANT_BEARER_ENV);
}

export function allowedHosts(env: RuntimeEnv = processRuntimeEnv()): string[] {
  const raw = envString(env, ALLOWED_HOSTS_ENV);
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
}

export function publicMcpUrl(
  env: RuntimeEnv = processRuntimeEnv(),
  requestUrl?: URL,
): string {
  const raw = envString(env, PUBLIC_URL_ENV);
  if (raw && raw.length > 0) {
    return raw.replace(/\/$/, "");
  }
  if (requestUrl) {
    return `${requestUrl.origin}/mcp`;
  }
  return `http://127.0.0.1:${listenPort(env)}/mcp`;
}
