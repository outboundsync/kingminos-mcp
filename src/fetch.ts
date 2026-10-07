import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  allowEnvBearerOptIn,
  allowedHosts,
  allowedOriginHosts,
  apiBaseUrl,
  MCP_PROTOCOL,
  PRODUCT_NAME,
  publicMcpUrl,
  SERVICE_NAME,
  TENANT_BEARER_ENV,
  tenantBearerFromEnv,
  VERSION,
} from "./config.js";
import type { RuntimeEnv } from "./env.js";
import { mergeRuntimeEnv, workerRuntimeEnv } from "./env.js";
import { hostnameFromHostHeader, hostnameFromOrigin } from "./hosts.js";
import { createKingMinosServer } from "./server.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
export const MCP_ALLOW_METHODS = "POST, OPTIONS";

export type FetchMode = "worker" | "node";

export interface HandleFetchOptions {
  mode?: FetchMode;
  loopbackBound?: boolean;
  allowEnvBearer?: boolean;
}

export interface BearerResult {
  ok: true;
  token: string;
}

export interface BearerFailure {
  ok: false;
  status: number;
  body: { error: string; detail: "missing" | "malformed" };
}

export function serviceCard(): {
  name: string;
  product: string;
  version: string;
  docs: string;
  protocol: string;
} {
  return {
    name: SERVICE_NAME,
    product: PRODUCT_NAME,
    version: VERSION,
    docs: "https://api.kingminos.com/openapi.yaml",
    protocol: MCP_PROTOCOL,
  };
}

export function healthCard(): { ok: true; service: string; version: string } {
  return { ok: true, service: SERVICE_NAME, version: VERSION };
}

export function serverCard(env: RuntimeEnv): {
  serverInfo: { name: string; version: string };
  endpoint: string;
  transport: string;
  capabilities: { tools: object; resources: object; prompts: object };
} {
  return {
    serverInfo: { name: PRODUCT_NAME, version: VERSION },
    endpoint: publicMcpUrl(env),
    transport: "streamable-http",
    capabilities: { tools: {}, resources: {}, prompts: {} },
  };
}

export function envBearerAllowed(
  options: HandleFetchOptions,
  env: RuntimeEnv,
): boolean {
  if (options.mode !== "node") {
    return false;
  }
  if (options.loopbackBound !== true) {
    return false;
  }
  return options.allowEnvBearer === true || allowEnvBearerOptIn(env);
}

export function readTenantBearer(
  authorization: string | null | undefined,
  env: RuntimeEnv,
  options: HandleFetchOptions = {},
): BearerResult | BearerFailure {
  if (
    authorization !== undefined &&
    authorization !== null &&
    authorization.length > 0
  ) {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
    if (!match?.[1]) {
      return {
        ok: false,
        status: 401,
        body: { error: "Unauthorized", detail: "malformed" },
      };
    }
    return { ok: true, token: match[1] };
  }
  if (envBearerAllowed(options, env)) {
    const fromEnv = tenantBearerFromEnv(env);
    if (fromEnv) {
      return { ok: true, token: fromEnv };
    }
  }
  return {
    ok: false,
    status: 401,
    body: { error: "Missing Authorization header", detail: "missing" },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function requestHostname(request: Request): string {
  const header = request.headers.get("host");
  if (header && header.trim().length > 0) {
    return hostnameFromHostHeader(header);
  }
  return hostnameFromHostHeader(new URL(request.url).host);
}

export function hostAllowed(
  request: Request,
  env: RuntimeEnv,
  mode: FetchMode,
): boolean {
  const allow = allowedHosts(env, mode);
  if (allow.length === 0) {
    return true;
  }
  return allow.includes(requestHostname(request));
}

export function originAllowed(request: Request, env: RuntimeEnv): boolean {
  const origin = request.headers.get("origin");
  if (origin === null || origin === "") {
    return true;
  }
  const hostname = hostnameFromOrigin(origin);
  if (!hostname) {
    return false;
  }
  return allowedOriginHosts(env).includes(hostname);
}

function requestPath(url: URL): string {
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    return url.pathname.slice(0, -1);
  }
  return url.pathname;
}

function methodNotAllowed(): Response {
  return new Response(null, {
    status: 405,
    headers: { allow: MCP_ALLOW_METHODS },
  });
}

async function handleMcp(
  request: Request,
  env: RuntimeEnv,
  options: HandleFetchOptions,
): Promise<Response> {
  const mode = options.mode ?? "worker";
  if (!hostAllowed(request, env, mode)) {
    return jsonResponse(403, { error: "Forbidden host" });
  }
  if (!originAllowed(request, env)) {
    return jsonResponse(403, { error: "Forbidden origin" });
  }

  const bearer = readTenantBearer(
    request.headers.get("authorization"),
    env,
    options,
  );
  if (!bearer.ok) {
    return jsonResponse(bearer.status, {
      error: bearer.body.error,
      hint:
        bearer.body.detail === "malformed"
          ? "Authorization must be Bearer <token>."
          : envBearerAllowed(options, env)
            ? `Send Authorization: Bearer <token> or set ${TENANT_BEARER_ENV}.`
            : "Send Authorization: Bearer <token>.",
    });
  }

  const server = createKingMinosServer({
    bearer: bearer.token,
    apiBaseUrl: apiBaseUrl(env),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
    await server.close();
  }
}

export async function handleFetch(
  request: Request,
  env?: RuntimeEnv,
  options: HandleFetchOptions = {},
): Promise<Response> {
  const mode = options.mode ?? "worker";
  const runtime =
    mode === "worker" ? workerRuntimeEnv(env) : mergeRuntimeEnv(env);
  const url = new URL(request.url);
  const path = requestPath(url);
  console.log(
    JSON.stringify({
      message: "kingminos-mcp request",
      method: request.method,
      path,
    }),
  );

  if (request.method === "GET" && path === "/") {
    return jsonResponse(200, serviceCard());
  }
  if (request.method === "GET" && path === "/health") {
    return jsonResponse(200, healthCard());
  }
  if (
    request.method === "GET" &&
    path === "/.well-known/mcp/server-card.json"
  ) {
    return jsonResponse(200, serverCard(runtime));
  }
  if (path === "/mcp") {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { allow: MCP_ALLOW_METHODS },
      });
    }
    if (request.method !== "POST") {
      return methodNotAllowed();
    }
    return handleMcp(request, runtime, { ...options, mode });
  }

  return jsonResponse(404, { error: "Not found" });
}
