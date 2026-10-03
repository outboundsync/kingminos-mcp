import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  allowedHosts,
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
import { mergeRuntimeEnv } from "./env.js";
import { createKingMinosServer } from "./server.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

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

export function serverCard(
  env: RuntimeEnv,
  requestUrl: URL,
): {
  serverInfo: { name: string; version: string };
  endpoint: string;
  transport: string;
  capabilities: { tools: object; resources: object; prompts: object };
} {
  return {
    serverInfo: { name: PRODUCT_NAME, version: VERSION },
    endpoint: publicMcpUrl(env, requestUrl),
    transport: "streamable-http",
    capabilities: { tools: {}, resources: {}, prompts: {} },
  };
}

export function readTenantBearer(
  authorization: string | null | undefined,
  env: RuntimeEnv,
): BearerResult | BearerFailure {
  if (authorization !== undefined && authorization !== null && authorization.length > 0) {
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
  const fromEnv = tenantBearerFromEnv(env);
  if (fromEnv) {
    return { ok: true, token: fromEnv };
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

function hostAllowed(request: Request, env: RuntimeEnv): boolean {
  const allow = allowedHosts(env);
  if (allow.length === 0) {
    return true;
  }
  const host = (request.headers.get("host") ?? "").split(":")[0]?.toLowerCase() ?? "";
  return allow.includes(host);
}

function requestPath(url: URL): string {
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    return url.pathname.slice(0, -1);
  }
  return url.pathname;
}

async function handleMcp(request: Request, env: RuntimeEnv): Promise<Response> {
  if (!hostAllowed(request, env)) {
    return jsonResponse(403, { error: "Forbidden host" });
  }

  const bearer = readTenantBearer(request.headers.get("authorization"), env);
  if (!bearer.ok) {
    return jsonResponse(bearer.status, {
      error: bearer.body.error,
      hint:
        bearer.body.detail === "malformed"
          ? "Authorization must be Bearer <token>."
          : `Send Authorization: Bearer <token> or set ${TENANT_BEARER_ENV}.`,
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

export async function handleFetch(request: Request, env?: RuntimeEnv): Promise<Response> {
  const runtime = mergeRuntimeEnv(env);
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
  if (request.method === "GET" && path === "/.well-known/mcp/server-card.json") {
    return jsonResponse(200, serverCard(runtime, url));
  }
  if (path === "/mcp") {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { allow: "GET, POST, DELETE, OPTIONS" },
      });
    }
    return handleMcp(request, runtime);
  }

  return jsonResponse(404, { error: "Not found" });
}
