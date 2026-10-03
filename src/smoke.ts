import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LIVE_RESOURCE_ROUTES, PUBLIC_NON_TOOL_PATHS, type HttpMethod } from "./catalog.js";
import { apiBaseUrl, TENANT_BEARER_ENV } from "./config.js";
import { createApp } from "./http.js";
import { registeredToolNames } from "./server.js";

interface LiveOp {
  method: HttpMethod;
  path: string;
}

const RESOURCE_METHODS = new Set<string>(["get", "post", "put", "patch", "delete"]);

function normalizePath(path: string): string {
  return path.replace(/\{[^}]+\}/g, "{}");
}

function parseOpenApiOps(yaml: string): LiveOp[] {
  const ops: LiveOp[] = [];
  let currentPath: string | undefined;
  let inPaths = false;
  for (const rawLine of yaml.split(/\r?\n/)) {
    if (rawLine.startsWith("paths:")) {
      inPaths = true;
      continue;
    }
    if (inPaths && rawLine.startsWith("components:")) {
      break;
    }
    if (!inPaths) {
      continue;
    }
    const pathMatch = /^  (\/[^\s:]*):$/.exec(rawLine);
    if (pathMatch?.[1]) {
      currentPath = pathMatch[1];
      continue;
    }
    const methodMatch = /^    (get|post|put|patch|delete):$/.exec(rawLine);
    if (methodMatch?.[1] && currentPath && RESOURCE_METHODS.has(methodMatch[1])) {
      ops.push({
        method: methodMatch[1].toUpperCase() as HttpMethod,
        path: currentPath,
      });
    }
  }
  return ops;
}

function keyOf(method: string, path: string): string {
  return `${method} ${normalizePath(path)}`;
}

async function fetchLiveOps(): Promise<LiveOp[]> {
  const url = `${apiBaseUrl()}/openapi.yaml`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return parseOpenApiOps(await response.text());
}

async function listToolsOverHttp(baseUrl: string, bearer: string): Promise<string[]> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${bearer}`,
      },
    },
  });
  const client = new Client({ name: "kingminos-mcp-smoke", version: "0.0.0" });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    return listed.tools.map((tool) => tool.name).sort();
  } finally {
    await client.close();
  }
}

async function listen(app: ReturnType<typeof createApp>): Promise<{ server: Server; baseUrl: string }> {
  const server = await new Promise<Server>((resolve) => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind smoke server");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function main(): Promise<void> {
  const catalogNames = [...registeredToolNames()].sort();
  const expectedNames = LIVE_RESOURCE_ROUTES.map((route) => route.tool).sort();
  if (catalogNames.join(",") !== expectedNames.join(",")) {
    throw new Error(
      `In-process tool list drifted from catalog.\nserver: ${catalogNames.join(", ")}\ncatalog: ${expectedNames.join(", ")}`,
    );
  }

  const liveOps = await fetchLiveOps();
  const publicSet = new Set<string>(PUBLIC_NON_TOOL_PATHS);
  const liveResource = liveOps.filter((op) => !publicSet.has(op.path));
  const liveKeys = new Set(liveResource.map((op) => keyOf(op.method, op.path)));
  const catalogKeys = new Set(
    LIVE_RESOURCE_ROUTES.map((route) => keyOf(route.method, route.path)),
  );

  const missing = [...liveKeys].filter((key) => !catalogKeys.has(key)).sort();
  const extra = [...catalogKeys].filter((key) => !liveKeys.has(key)).sort();
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      [
        "Tool catalog does not match live KingMinos OpenAPI resource routes.",
        missing.length > 0 ? `missing tools for: ${missing.join(", ")}` : "",
        extra.length > 0 ? `extra tools for: ${extra.join(", ")}` : "",
      ]
        .filter((line) => line.length > 0)
        .join("\n"),
    );
  }

  const { server, baseUrl } = await listen(createApp());

  try {
    const health = await fetch(`${baseUrl}/health`);
    const healthBody = (await health.json()) as { ok?: boolean };
    if (!health.ok || healthBody.ok !== true) {
      throw new Error(`/health failed: ${health.status}`);
    }

    const root = await fetch(baseUrl);
    if (!root.ok) {
      throw new Error(`GET / failed: ${root.status}`);
    }

    const missingAuth = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    if (missingAuth.status !== 401) {
      throw new Error(`Expected 401 without Bearer, got ${missingAuth.status}`);
    }

    const listed = await listToolsOverHttp(baseUrl, "smoke-list-only");
    if (listed.join(",") !== expectedNames.join(",")) {
      throw new Error(
        `HTTP tools/list mismatch.\ngot: ${listed.join(", ")}\nexpected: ${expectedNames.join(", ")}`,
      );
    }

    process.stdout.write(
      [
        "KingMinos MCP smoke passed.",
        `API: ${apiBaseUrl()}`,
        `Tools (${listed.length}): ${listed.join(", ")}`,
        `Tenant Bearer env: ${TENANT_BEARER_ENV}`,
        "",
      ].join("\n"),
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
