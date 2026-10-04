import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LIVE_RESOURCE_ROUTES } from "./catalog.js";
import { DOCUMENTED_PUBLIC_MCP_URL, SERVICE_NAME, VERSION } from "./config.js";
import { handleFetch, healthCard, readTenantBearer, serviceCard } from "./fetch.js";

const WORKER_NAME = "kingminos-mcp-prod";

describe("handleFetch public routes", () => {
  it("serves GET /health", async () => {
    const response = await handleFetch(new Request("http://127.0.0.1/health"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), healthCard());
  });

  it("serves GET /", async () => {
    const response = await handleFetch(new Request("http://127.0.0.1/"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), serviceCard());
  });

  it("serves GET /.well-known/mcp/server-card.json", async () => {
    const response = await handleFetch(
      new Request("http://127.0.0.1/.well-known/mcp/server-card.json"),
      { KINGMINOS_MCP_PUBLIC_URL: DOCUMENTED_PUBLIC_MCP_URL },
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { endpoint?: string };
    assert.equal(body.endpoint, DOCUMENTED_PUBLIC_MCP_URL);
  });

  it("returns 401 for POST /mcp without a Bearer and does not echo credentials", async () => {
    const response = await handleFetch(
      new Request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }),
    );
    assert.equal(response.status, 401);
    const text = await response.text();
    assert.match(text, /Missing Authorization header/);
    assert.doesNotMatch(text, /Bearer\s+(?!<token>)(\S+)/);
  });

  it("returns 401 for a malformed Authorization header", async () => {
    const response = await handleFetch(
      new Request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: {
          authorization: "Basic not-a-bearer",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }),
    );
    assert.equal(response.status, 401);
    const text = await response.text();
    assert.match(text, /Unauthorized/);
    assert.doesNotMatch(text, /not-a-bearer/);
  });

  it("rejects a disallowed Host on POST /mcp", async () => {
    const response = await handleFetch(
      new Request("http://evil.example/mcp", {
        method: "POST",
        headers: {
          host: "evil.example",
          authorization: "Bearer smoke-list-only",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }),
      { KINGMINOS_MCP_ALLOWED_HOSTS: "mcp.kingminos.com" },
    );
    assert.equal(response.status, 403);
  });
});

describe("Worker fetch MCP surface", () => {
  it("lists the same tools as the OpenAPI catalog over streamable HTTP", async () => {
    const transport = new StreamableHTTPClientTransport(new URL("http://worker.local/mcp"), {
      requestInit: {
        headers: {
          Authorization: "Bearer smoke-list-only",
        },
      },
      fetch: async (input, init) => handleFetch(new Request(input, init)),
    });
    const client = new Client({ name: "kingminos-mcp-worker-test", version: "0.0.0" });
    await client.connect(transport);
    try {
      const listed = await client.listTools();
      assert.deepEqual(
        listed.tools.map((tool) => tool.name).sort(),
        LIVE_RESOURCE_ROUTES.map((route) => route.tool).sort(),
      );
    } finally {
      await client.close();
    }
  });
});

describe("readTenantBearer", () => {
  it("reads Authorization: Bearer and never requires an env key", () => {
    const result = readTenantBearer("Bearer tenant-token", {});
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.token, "tenant-token");
    }
  });
});

describe("wrangler production host", () => {
  it("deploys Worker kingminos-mcp-prod without router bindings or secrets", () => {
    const raw = readFileSync("wrangler.jsonc", "utf8");
    const parsed = JSON.parse(
      raw.replace(/^\s*\/\/.*$/gm, ""),
    ) as {
      name?: string;
      workers_dev?: boolean;
      vars?: Record<string, string>;
      d1_databases?: unknown;
      r2_buckets?: unknown;
      routes?: Array<{ pattern?: string; custom_domain?: boolean }>;
    };
    assert.equal(parsed.name, WORKER_NAME);
    assert.equal(parsed.workers_dev, false);
    assert.equal(parsed.vars?.KINGMINOS_API_URL, "https://api.kingminos.com");
    assert.equal(parsed.vars?.KINGMINOS_MCP_PUBLIC_URL, DOCUMENTED_PUBLIC_MCP_URL);
    assert.equal(parsed.vars?.KINGMINOS_API_KEY, undefined);
    assert.equal(parsed.d1_databases, undefined);
    assert.equal(parsed.r2_buckets, undefined);
    assert.equal(parsed.routes?.length, 1);
    assert.equal(parsed.routes?.[0]?.pattern, "mcp.kingminos.com");
    assert.equal(parsed.routes?.[0]?.custom_domain, true);
    assert.doesNotMatch(raw, /outboundsync-router/);
    assert.doesNotMatch(raw, /outboundsync-router-raw/);
    assert.equal(SERVICE_NAME, "kingminos-mcp");
    assert.equal(typeof VERSION, "string");
  });
});
