import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import express from "express";
import {
  allowedHosts,
  PRODUCT_NAME,
  publicMcpUrl,
  SERVICE_NAME,
  TENANT_BEARER_ENV,
  tenantBearerFromEnv,
  VERSION,
  MCP_PROTOCOL,
} from "./config.js";
import { createKingMinosServer } from "./server.js";

export interface BearerResult {
  ok: true;
  token: string;
}

export interface BearerFailure {
  ok: false;
  status: number;
  body: { error: string; detail: "missing" | "malformed" };
}

export function readTenantBearer(req: Request): BearerResult | BearerFailure {
  const header = req.header("authorization");
  if (header !== undefined && header.length > 0) {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
    if (!match?.[1]) {
      return {
        ok: false,
        status: 401,
        body: { error: "Unauthorized", detail: "malformed" },
      };
    }
    return { ok: true, token: match[1] };
  }
  const fromEnv = tenantBearerFromEnv();
  if (fromEnv) {
    return { ok: true, token: fromEnv };
  }
  return {
    ok: false,
    status: 401,
    body: { error: "Missing Authorization header", detail: "missing" },
  };
}

function hostAllowed(req: Request): boolean {
  const allow = allowedHosts();
  if (allow.length === 0) {
    return true;
  }
  const host = (req.header("host") ?? "").split(":")[0]?.toLowerCase() ?? "";
  return allow.includes(host);
}

async function handleMcp(req: Request, res: Response): Promise<void> {
  if (!hostAllowed(req)) {
    res.status(403).json({ error: "Forbidden host" });
    return;
  }

  const bearer = readTenantBearer(req);
  if (!bearer.ok) {
    res.status(bearer.status).json({
      error: bearer.body.error,
      hint:
        bearer.body.detail === "malformed"
          ? "Authorization must be Bearer <token>."
          : `Send Authorization: Bearer <token> or set ${TENANT_BEARER_ENV}.`,
    });
    return;
  }

  const server = createKingMinosServer({ bearer: bearer.token });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

export function createApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.json({
      name: SERVICE_NAME,
      product: PRODUCT_NAME,
      version: VERSION,
      docs: "https://api.kingminos.com/openapi.yaml",
      protocol: MCP_PROTOCOL,
    });
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: SERVICE_NAME, version: VERSION });
  });

  app.get("/.well-known/mcp/server-card.json", (_req, res) => {
    res.json({
      serverInfo: { name: PRODUCT_NAME, version: VERSION },
      endpoint: publicMcpUrl(),
      transport: "streamable-http",
      capabilities: { tools: {}, resources: {}, prompts: {} },
    });
  });

  app.post("/mcp", (req, res) => {
    void handleMcp(req, res);
  });

  app.get("/mcp", (req, res) => {
    void handleMcp(req, res);
  });

  app.delete("/mcp", (req, res) => {
    void handleMcp(req, res);
  });

  return app;
}
