import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LIVE_RESOURCE_ROUTES } from "./catalog.js";
import { checkSurfaces, formatCheckResult } from "./check-surfaces.js";
import { TENANT_BEARER_ENV, apiBaseUrl } from "./config.js";
import { createApp } from "./http.js";

async function listToolsOverHttp(
  baseUrl: string,
  bearer: string,
): Promise<string[]> {
  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl}/mcp`),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${bearer}`,
        },
      },
    },
  );
  const client = new Client({ name: "kingminos-mcp-smoke", version: "0.0.0" });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    return listed.tools.map((tool) => tool.name).sort();
  } finally {
    await client.close();
  }
}

async function listen(
  app: ReturnType<typeof createApp>,
): Promise<{ server: Server; baseUrl: string }> {
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
  const expectedNames = LIVE_RESOURCE_ROUTES.map((route) => route.tool).sort();
  const surfaces = await checkSurfaces();
  if (!surfaces.ok) {
    throw new Error(formatCheckResult(surfaces));
  }

  const { server, baseUrl } = await listen(
    createApp(undefined, { listenHost: "127.0.0.1" }),
  );

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
    if (listed.join(",") !== surfaces.expected.join(",")) {
      throw new Error(
        `HTTP tools/list drifted from OpenAPI inventory (${surfaces.source}).\ngot: ${listed.join(", ")}\nexpected: ${surfaces.expected.join(", ")}`,
      );
    }

    process.stdout.write(
      [
        "KingMinos MCP smoke passed.",
        `API: ${apiBaseUrl()}`,
        `Inventory: ${surfaces.source}`,
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
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
