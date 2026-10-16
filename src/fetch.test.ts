import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { LIVE_RESOURCE_ROUTES } from "./catalog.js";
import {
  DOCUMENTED_PUBLIC_MCP_URL,
  MCP_PROTOCOL,
  SERVICE_NAME,
  VERSION,
} from "./config.js";
import {
  handleFetch,
  healthCard,
  MCP_ALLOW_METHODS,
  readTenantBearer,
  serviceCard,
} from "./fetch.js";

const WORKER_NAME = "kingminos-mcp-prod";
const PACKAGE = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

describe("handleFetch public routes", () => {
  it("serves GET /health", async () => {
    const response = await handleFetch(new Request("http://127.0.0.1/health"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), healthCard());
  });

  it("reports git_sha on /health from the GIT_SHA var", async () => {
    const unset = await handleFetch(new Request("http://127.0.0.1/health"));
    assert.equal(((await unset.json()) as { git_sha: unknown }).git_sha, null);
    const response = await handleFetch(
      new Request("http://127.0.0.1/health"),
      { GIT_SHA: "abc1234" },
      { mode: "worker" },
    );
    assert.equal(
      ((await response.json()) as { git_sha: unknown }).git_sha,
      "abc1234",
    );
  });

  it("serves GET /", async () => {
    const response = await handleFetch(new Request("http://127.0.0.1/"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), serviceCard());
    assert.equal(serviceCard().protocol, LATEST_PROTOCOL_VERSION);
    assert.equal(MCP_PROTOCOL, LATEST_PROTOCOL_VERSION);
  });

  it("serves GET /.well-known/mcp/server-card.json from config, not the client Host", async () => {
    const response = await handleFetch(
      new Request("http://evil.example/.well-known/mcp/server-card.json", {
        headers: { host: "evil.example" },
      }),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { endpoint?: string };
    assert.equal(body.endpoint, "http://127.0.0.1:8080/mcp");
    assert.doesNotMatch(body.endpoint ?? "", /evil\.example/);
  });

  it("advertises the documented public MCP URL when configured", async () => {
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

  it("parses IPv6 Host headers for the allowlist", async () => {
    const response = await handleFetch(
      new Request("http://[::1]:8080/mcp", {
        method: "POST",
        headers: {
          host: "[::1]:8080",
          authorization: "Bearer smoke-list-only",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }),
      { KINGMINOS_MCP_ALLOWED_HOSTS: "[::1]" },
    );
    assert.notEqual(response.status, 403);
  });

  it("rejects a present Origin that is not allowlisted", async () => {
    const response = await handleFetch(
      new Request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          authorization: "Bearer smoke-list-only",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }),
    );
    assert.equal(response.status, 403);
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, "Forbidden origin");
  });

  it("admits production MCP clients that send no Origin", async () => {
    const response = await handleFetch(
      new Request("https://mcp.kingminos.com/mcp", {
        method: "POST",
        headers: {
          host: "mcp.kingminos.com",
          authorization: "Bearer smoke-list-only",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }),
      {},
      { mode: "worker" },
    );
    assert.notEqual(response.status, 403);
  });

  it("returns 405 with Allow: POST, OPTIONS for GET and DELETE /mcp", async () => {
    for (const method of ["GET", "DELETE"] as const) {
      const response = await handleFetch(
        new Request("http://127.0.0.1/mcp", { method }),
      );
      assert.equal(response.status, 405, method);
      assert.equal(response.headers.get("allow"), MCP_ALLOW_METHODS);
    }
    const options = await handleFetch(
      new Request("http://127.0.0.1/mcp", { method: "OPTIONS" }),
    );
    assert.equal(options.status, 204);
    assert.equal(options.headers.get("allow"), MCP_ALLOW_METHODS);
  });
});

describe("Worker-mode env bearer", () => {
  it("does not use KINGMINOS_API_KEY from process.env when Authorization is absent", async () => {
    const previous = process.env.KINGMINOS_API_KEY;
    process.env.KINGMINOS_API_KEY = "leaked-worker-secret";
    try {
      const response = await handleFetch(
        new Request("http://127.0.0.1/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
        }),
        { KINGMINOS_API_URL: "https://api.kingminos.com" },
        { mode: "worker" },
      );
      assert.equal(response.status, 401);
      const text = await response.text();
      assert.match(text, /Missing Authorization header/);
      assert.doesNotMatch(text, /leaked-worker-secret/);
    } finally {
      if (previous === undefined) {
        process.env.KINGMINOS_API_KEY = undefined;
      } else {
        process.env.KINGMINOS_API_KEY = previous;
      }
    }
  });

  it("strips a bearer passed on the Worker env object", async () => {
    const response = await handleFetch(
      new Request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }),
      { KINGMINOS_API_KEY: "should-not-count" },
      { mode: "worker" },
    );
    assert.equal(response.status, 401);
    const text = await response.text();
    assert.doesNotMatch(text, /should-not-count/);
  });
});

describe("Node-mode env bearer", () => {
  it("does not fall back to env without the opt-in flag", async () => {
    const response = await handleFetch(
      new Request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }),
      { KINGMINOS_API_KEY: "local-secret" },
      { mode: "node", loopbackBound: true, allowEnvBearer: false },
    );
    assert.equal(response.status, 401);
  });

  it("does not fall back to env when not bound to loopback", async () => {
    const response = await handleFetch(
      new Request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }),
      { KINGMINOS_API_KEY: "local-secret" },
      { mode: "node", loopbackBound: false, allowEnvBearer: true },
    );
    assert.equal(response.status, 401);
  });
});

describe("Worker fetch MCP surface", () => {
  it("lists the same tools as the OpenAPI catalog over streamable HTTP", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL("http://127.0.0.1/mcp"),
      {
        requestInit: {
          headers: {
            Authorization: "Bearer smoke-list-only",
          },
        },
        fetch: async (input, init) =>
          handleFetch(new Request(input, init), {}, { mode: "worker" }),
      },
    );
    const client = new Client({
      name: "kingminos-mcp-worker-test",
      version: "0.0.0",
    });
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

describe("version source", () => {
  it("matches package.json", () => {
    assert.equal(VERSION, PACKAGE.version);
  });
});

describe("wrangler production host", () => {
  it("deploys Worker kingminos-mcp-prod without router bindings or secrets", () => {
    const raw = readFileSync("wrangler.jsonc", "utf8");
    const parsed = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "")) as {
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
    assert.equal(
      parsed.vars?.KINGMINOS_MCP_PUBLIC_URL,
      DOCUMENTED_PUBLIC_MCP_URL,
    );
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
