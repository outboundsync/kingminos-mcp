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

export function apiBaseUrl(): string {
  const raw = process.env[API_BASE_URL_ENV]?.trim();
  return (raw && raw.length > 0 ? raw : DEFAULT_API_BASE_URL).replace(/\/$/, "");
}

export function listenPort(): number {
  const raw = process.env[PORT_ENV];
  if (raw && /^\d+$/.test(raw)) {
    return Number(raw);
  }
  return DEFAULT_PORT;
}

export function tenantBearerFromEnv(): string | undefined {
  const value = process.env[TENANT_BEARER_ENV]?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function allowedHosts(): string[] {
  const raw = process.env[ALLOWED_HOSTS_ENV]?.trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
}

export function publicMcpUrl(): string {
  const raw = process.env[PUBLIC_URL_ENV]?.trim();
  if (raw && raw.length > 0) {
    return raw.replace(/\/$/, "");
  }
  return `http://127.0.0.1:${listenPort()}/mcp`;
}
