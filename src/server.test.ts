import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LIVE_RESOURCE_ROUTES, type ToolName } from "./catalog.js";
import { handleFetch } from "./fetch.js";
import { stripMeta } from "./schemas.js";
import { credentialPutBody, encodePath, rawSubjectKey } from "./server.js";

const originalFetch = globalThis.fetch;
const BEARER = "secret-bearer-token-xyz";

afterEach(() => {
  globalThis.fetch = originalFetch;
});

interface Captured {
  method: string;
  url: string;
  authorization: string | null;
  headers: Record<string, string>;
  body: string | null;
}

function toolText(result: unknown): string {
  if (typeof result !== "object" || result === null) {
    return String(result);
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return JSON.stringify(result);
  }
  const first = content[0] as { text?: string } | undefined;
  return first?.text ?? JSON.stringify(result);
}

function captureFetch(handler?: (captured: Captured) => Response): {
  calls: Captured[];
} {
  const calls: Captured[] = [];
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const captured: Captured = {
      method: request.method,
      url: request.url,
      authorization: request.headers.get("authorization"),
      headers: Object.fromEntries(request.headers.entries()),
      body: init?.body !== undefined ? String(init.body) : null,
    };
    calls.push(captured);
    if (handler) {
      return handler(captured);
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls };
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StreamableHTTPClientTransport(
    new URL("http://127.0.0.1/mcp"),
    {
      requestInit: { headers: { Authorization: `Bearer ${BEARER}` } },
      fetch: async (input, init) =>
        handleFetch(new Request(input, init), {}, { mode: "worker" }),
    },
  );
  const client = new Client({
    name: "kingminos-mcp-tool-test",
    version: "0.0.0",
  });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

const TOOL_ARGS: Record<ToolName, Record<string, unknown>> = {
  get_providers: {},
  get_capabilities: {},
  company_resolve: { domain: "acme.com" },
  company_domain: { domain: "acme.com" },
  company_hierarchy: { domain: "acme.com" },
  person_verify_employment: { email: "a@b.com" },
  get_run: { id: "run_1" },
  list_credentials: {},
  put_credentials: { provider: "leadmagic", apiKey: "vendor-key" },
  delete_credentials: { provider: "leadmagic" },
  delete_subject: { subject_key: "email:a@b.com" },
};

describe("catalog-driven handlers", () => {
  it("calls the catalog method and path for every tool", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      for (const route of LIVE_RESOURCE_ROUTES) {
        const result = await client.callTool({
          name: route.tool,
          arguments: TOOL_ARGS[route.tool],
        });
        assert.equal(result.isError, undefined, route.tool);
        const text = JSON.stringify(result);
        assert.doesNotMatch(text, new RegExp(BEARER));
      }
    });
    assert.equal(calls.length, LIVE_RESOURCE_ROUTES.length);
    for (const [index, route] of LIVE_RESOURCE_ROUTES.entries()) {
      const call = calls[index];
      assert.ok(call, route.tool);
      assert.equal(call.method, route.method, route.tool);
      const url = new URL(call.url);
      const expectedPath = encodePath(route.path, {
        id: "run_1",
        provider: "leadmagic",
        subject_key: "email:a@b.com",
      });
      assert.equal(url.pathname, expectedPath, route.tool);
      assert.equal(call.authorization, `Bearer ${BEARER}`);
    }
  });

  it("encodes delete_subject as /v1/subjects/email%3Aa%40b.com", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "delete_subject",
        arguments: { subject_key: "email:a@b.com" },
      });
      assert.equal(result.isError, undefined);
    });
    assert.equal(calls.length, 1);
    assert.equal(
      new URL(calls[0]?.url ?? "").pathname,
      "/v1/subjects/email%3Aa%40b.com",
    );
  });

  it("rejects a percent-encoded subject_key before calling upstream", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "delete_subject",
        arguments: { subject_key: "email%3Aa%40b.com" },
      });
      assert.equal(result.isError, true);
      const text = toolText(result);
      assert.match(text, /bad_request/);
      assert.match(text, /raw unencoded/);
    });
    assert.equal(calls.length, 0);
  });

  it("routes stripMeta fields to headers, query, and body", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      await client.callTool({
        name: "company_domain",
        arguments: {
          domain: "acme.com",
          explain: "full",
          schema_version: "2",
          idempotency_key: "idem-9",
          cache_bypass: true,
          skip_cache: true,
        },
      });
    });
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call);
    const url = new URL(call.url);
    assert.equal(url.searchParams.get("explain"), "full");
    assert.equal(url.searchParams.get("schema"), "2");
    assert.equal(call.headers["x-router-explain"], "full");
    assert.equal(call.headers["x-router-schema"], "2");
    assert.equal(call.headers["idempotency-key"], "idem-9");
    assert.equal(call.headers["x-router-cache"], "bypass");
    const body = JSON.parse(call.body ?? "{}") as Record<string, unknown>;
    assert.equal(body.domain, "acme.com");
    assert.equal(body.schema_version, "2");
    assert.equal(body.skip_cache, true);
    assert.equal(body.explain, undefined);
    assert.equal(body.idempotency_key, undefined);
    assert.equal(body.cache_bypass, undefined);
  });

  it("shapes put_credentials bodies and aliases api_key", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      await client.callTool({
        name: "put_credentials",
        arguments: {
          provider: "zoominfo",
          clientId: "id",
          clientSecret: "sec",
        },
      });
      await client.callTool({
        name: "put_credentials",
        arguments: { provider: "findymail", api_key: "fm-key" },
      });
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(JSON.parse(calls[0]?.body ?? "{}"), {
      clientId: "id",
      clientSecret: "sec",
    });
    assert.deepEqual(JSON.parse(calls[1]?.body ?? "{}"), { apiKey: "fm-key" });
  });

  it("fails put_credentials locally when required fields are missing", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      const zoom = await client.callTool({
        name: "put_credentials",
        arguments: { provider: "zoominfo" },
      });
      const zoomKey = await client.callTool({
        name: "put_credentials",
        arguments: { provider: "zoominfo", apiKey: "nope" },
      });
      const other = await client.callTool({
        name: "put_credentials",
        arguments: { provider: "wiza" },
      });
      for (const result of [zoom, zoomKey, other]) {
        assert.equal(result.isError, true);
        const text = toolText(result);
        assert.match(text, /bad_request/);
        assert.doesNotMatch(text, new RegExp(BEARER));
      }
      assert.match(toolText(zoom), /clientId and clientSecret/);
      assert.match(toolText(zoomKey), /does not accept apiKey/);
      assert.match(toolText(other), /missing apiKey/);
    });
    assert.equal(calls.length, 0);
  });

  it("never echoes the tenant Bearer in a tool error", async () => {
    captureFetch(
      () =>
        new Response(
          JSON.stringify({ error: "unauthorized", detail: "mismatch" }),
          {
            status: 401,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "get_providers",
        arguments: {},
      });
      assert.equal(result.isError, true);
      const text = JSON.stringify(result);
      assert.doesNotMatch(text, new RegExp(BEARER));
      assert.match(text, /unauthorized|mismatch/);
    });
  });

  it("warns that put_credentials secrets are visible in the conversation", async () => {
    await withClient(async (client) => {
      const listed = await client.listTools();
      const put = listed.tools.find((tool) => tool.name === "put_credentials");
      assert.match(put?.description ?? "", /visible in this conversation/);
      assert.match(put?.description ?? "", /app\.kingminos\.com\/app\/keys/);
      const list = listed.tools.find(
        (tool) => tool.name === "list_credentials",
      );
      assert.match(list?.description ?? "", /Never returns raw keys/i);
    });
  });
});

describe("stripMeta", () => {
  it("sends explain/schema/idempotency/cache to headers and query, keeps body fields", () => {
    const meta = stripMeta({
      domain: "acme.com",
      explain: "full",
      schema_version: "2",
      idempotency_key: "idem-9",
      cache_bypass: true,
      skip_cache: true,
    });
    assert.equal(meta.explain, "full");
    assert.equal(meta.schema, "2");
    assert.equal(meta.idempotencyKey, "idem-9");
    assert.equal(meta.cacheBypass, true);
    assert.equal(meta.body.domain, "acme.com");
    assert.equal(meta.body.schema_version, "2");
    assert.equal(meta.body.skip_cache, true);
    assert.equal(meta.body.explain, undefined);
    assert.equal(meta.body.idempotency_key, undefined);
    assert.equal(meta.body.cache_bypass, undefined);
  });
});

describe("local validators", () => {
  it("rejects percent-encoded subject keys", () => {
    assert.equal(rawSubjectKey("email:a@b.com"), "email:a@b.com");
    assert.throws(() => rawSubjectKey("email%3Aa%40b.com"), /raw unencoded/);
  });

  it("names missing put_credentials fields", () => {
    assert.deepEqual(
      credentialPutBody({
        provider: "zoominfo",
        clientId: "a",
        clientSecret: "b",
      }),
      { clientId: "a", clientSecret: "b" },
    );
    assert.throws(
      () => credentialPutBody({ provider: "zoominfo", apiKey: "x" }),
      /does not accept apiKey/,
    );
    assert.throws(
      () => credentialPutBody({ provider: "leadmagic" }),
      /missing apiKey/,
    );
  });
});
