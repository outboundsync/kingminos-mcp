import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ADMIN_TOOL_NAMES } from "./admin-tools.js";
import { handleFetch } from "./fetch.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function withClient<T>(
  bearer: string,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  const transport = new StreamableHTTPClientTransport(
    new URL("http://127.0.0.1/mcp"),
    {
      requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
      fetch: async (input, init) =>
        handleFetch(new Request(input, init), {}, { mode: "worker" }),
    },
  );
  const client = new Client({ name: "admin-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

describe("admin tools", () => {
  it("are hidden from normal bearers", async () => {
    await withClient("osr_normal_tenant_key", async (c) => {
      const names = (await c.listTools()).tools.map((t) => t.name);
      for (const n of ADMIN_TOOL_NAMES) {
        assert.ok(!names.includes(n), n);
      }
    });
  });

  it("are the only tools for an admin token and call the admin API", async () => {
    const calls: Array<{
      url: string;
      method: string;
      auth: string | null;
      body: string | null;
    }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      if (req.url.startsWith("http://127.0.0.1/")) {
        return realFetch(input, init);
      }
      calls.push({
        url: req.url,
        method: req.method,
        auth: req.headers.get("authorization"),
        body: init?.body !== undefined ? String(init.body) : null,
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    await withClient("kmadm_testtoken", async (c) => {
      const names = (await c.listTools()).tools.map((t) => t.name).sort();
      assert.deepEqual(names, [...ADMIN_TOOL_NAMES].sort());
      assert.doesNotMatch(
        c.getInstructions() ?? "",
        /get_capabilities|put_credentials/,
      );
      assert.match(c.getInstructions() ?? "", /partner_payout/);
      await c.callTool({
        name: "abuse_report",
        arguments: { date: "2026-10-10" },
      });
      await c.callTool({
        name: "partner_report",
        arguments: { period: "week", format: "csv" },
      });
      await c.callTool({
        name: "partner_payout",
        arguments: {
          id: "po_1",
          partner_id: "p",
          amount_cents: 10_000,
          method: "cash",
          memo: "Oct",
        },
      });
    });
    assert.match(
      calls[0]?.url ?? "",
      /\/v1\/admin\/abuse\/daily\?date=2026-10-10$/,
    );
    assert.match(
      calls[1]?.url ?? "",
      /\/v1\/admin\/partners\/analytics\?period=week&format=csv$/,
    );
    assert.equal(calls[2]?.method, "POST");
    assert.match(calls[2]?.url ?? "", /\/v1\/admin\/partners\/payouts$/);
    assert.match(calls[2]?.body ?? "", /"amount_cents":10000/);
    assert.equal(calls[0]?.auth, "Bearer kmadm_testtoken");
  });

  it("partner_payout approves and lists pending", async () => {
    const calls: Array<{ url: string; method: string; body: string | null }> =
      [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      if (req.url.startsWith("http://127.0.0.1/")) {
        return realFetch(input, init);
      }
      calls.push({
        url: req.url,
        method: req.method,
        body: init?.body !== undefined ? String(init.body) : null,
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    await withClient("kmadm_testtoken", async (c) => {
      await c.callTool({
        name: "partner_payout",
        arguments: { action: "list_pending" },
      });
      await c.callTool({
        name: "partner_payout",
        arguments: {
          action: "approve",
          id: "po_p_acme_2026-10",
          confirm: "2500.00",
        },
      });
      const bad = await c.callTool({
        name: "partner_payout",
        arguments: { action: "approve" },
      });
      assert.equal(bad.isError, true);
    });
    assert.match(
      calls[0]?.url ?? "",
      /\/v1\/admin\/partners\/payouts\?status=pending$/,
    );
    assert.equal(calls[1]?.method, "POST");
    assert.match(calls[1]?.url ?? "", /\/payouts\/po_p_acme_2026-10\/approve$/);
    assert.match(calls[1]?.body ?? "", /"confirm":"2500.00"/);
    assert.equal(calls.length, 2);
  });
});
