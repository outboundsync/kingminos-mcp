import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LIVE_RESOURCE_ROUTES, type ToolName } from "./catalog.js";
import { handleFetch } from "./fetch.js";
import {
  DecideCompanyIconInput,
  DecideCompanyXAccountInput,
  EmailVerifyInput,
  PersonEmailInput,
  stripMeta,
} from "./schemas.js";
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
  get_recipes: {},
  get_balance: {},
  get_balance_ledger: {},
  get_balance_history: {},
  get_balance_forecast: {},
  get_balance_health: {},
  get_usage: {},
  company_resolve: { domain: "acme.com" },
  company_domain: { domain: "acme.com" },
  company_hierarchy: { domain: "acme.com" },
  company_b2b_social: { domain: "acme.com" },
  company_x_account: { domain: "acme.com" },
  company_icon: { domain: "acme.com" },
  company_description: { domain: "acme.com" },
  person_verify_employment: { email: "a@b.com" },
  person_language: { email: "a@b.com" },
  person_phone: { email: "a@b.com" },
  person_title: { email: "a@b.com" },
  person_b2b_social: { email: "a@b.com" },
  person_name: { email: "a@b.com" },
  person_email: {
    first_name: "Anna",
    last_name: "Example",
    company_domain: "example.com",
  },
  email_verify: { email: "a@b.com" },
  get_run: { id: "run_1" },
  list_credentials: {},
  put_credentials: { provider: "leadmagic", apiKey: "vendor-key" },
  delete_credentials: { provider: "leadmagic" },
  delete_subject: { subject_key: "email:a@b.com" },
  list_webhooks: {},
  create_webhook: { url: "https://hooks.example.test/os" },
  get_webhook: { id: "kmwhk_1" },
  patch_webhook: { id: "kmwhk_1", is_active: true },
  delete_webhook: { id: "kmwhk_1" },
  rotate_webhook_secret: { id: "kmwhk_1" },
  test_webhook: { id: "kmwhk_1" },
  list_webhook_deliveries: { id: "kmwhk_1" },
  replay_webhook_delivery: { id: "kmwhk_1", delivery_id: "kmwhd_1" },
  list_events: {},
  submit_feedback: {
    category: "product_idea",
    summary: "Working a list and the usual way does not work",
    details: "Filed from the server.test catalog-driven handler pass.",
    source: "agent",
  },
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
      const args = TOOL_ARGS[route.tool] as Record<string, unknown>;
      const params: Record<string, string> = {};
      for (const [key, value] of Object.entries(args)) {
        if (typeof value === "string") params[key] = value;
      }
      const expectedPath = encodePath(route.path, params);
      assert.equal(url.pathname, expectedPath, route.tool);
      assert.equal(call.authorization, `Bearer ${BEARER}`);
    }
  });

  it("forwards balance and usage query filters on the GET tools", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      const ledger = await client.callTool({
        name: "get_balance_ledger",
        arguments: {
          since: "2026-10-01T00:00:00.000Z",
          kind: "run",
          limit: 25,
        },
      });
      const history = await client.callTool({
        name: "get_balance_history",
        arguments: { interval: "hour", since: "2026-10-20T00:00:00.000Z" },
      });
      const health = await client.callTool({
        name: "get_balance_health",
        arguments: { capability: "company.resolve" },
      });
      const usage = await client.callTool({
        name: "get_usage",
        arguments: { group_by: "capability", capability: "person.phone" },
      });
      for (const result of [ledger, history, health, usage]) {
        assert.equal(result.isError, undefined);
      }
    });
    assert.equal(calls.length, 4);
    assert.equal(new URL(calls[0]?.url ?? "").searchParams.get("kind"), "run");
    assert.equal(new URL(calls[0]?.url ?? "").searchParams.get("limit"), "25");
    assert.equal(
      new URL(calls[1]?.url ?? "").searchParams.get("interval"),
      "hour",
    );
    assert.equal(
      new URL(calls[2]?.url ?? "").searchParams.get("capability"),
      "company.resolve",
    );
    assert.equal(
      new URL(calls[3]?.url ?? "").searchParams.get("group_by"),
      "capability",
    );
  });

  it("rejects a submit_feedback call missing required fields before calling the API", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "submit_feedback",
        arguments: {
          category: "mcp",
          details: "no summary here",
          source: "agent",
        },
      });
      assert.equal(result.isError, true);
      const text = toolText(result);
      assert.match(text, /summary/);
    });
    assert.equal(calls.length, 0, "zod validation happens client-side");
  });

  it("accepts person.name capability on submit_feedback before calling the API", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "submit_feedback",
        arguments: {
          category: "data_quality",
          summary: "Returned wrong name for the contact",
          details: "Full name did not match CRM for this email.",
          source: "agent",
          capability: "person.name",
          run_id: "kmrun_test",
        },
      });
      assert.equal(result.isError, undefined);
    });
    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0]?.body ?? "{}");
    assert.equal(body.capability, "person.name");
  });

  it("accepts person.b2b_social capability on submit_feedback before calling the API", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "submit_feedback",
        arguments: {
          category: "data_quality",
          summary: "LinkedIn URL did not match the profile",
          details: "Returned slug disagreed with the known profile.",
          source: "agent",
          capability: "person.b2b_social",
          run_id: "kmrun_test",
        },
      });
      assert.equal(result.isError, undefined);
    });
    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0]?.body ?? "{}");
    assert.equal(body.capability, "person.b2b_social");
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

  it("routes company_description cache_bypass to X-Router-Cache and not the body", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      await client.callTool({
        name: "company_description",
        arguments: {
          domain: "acme.com",
          path: "balance",
          cache_bypass: true,
        },
      });
    });
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call);
    assert.equal(call.headers["x-router-cache"], "bypass");
    const body = JSON.parse(call.body ?? "{}") as Record<string, unknown>;
    assert.equal(body.domain, "acme.com");
    assert.equal(body.path, "balance");
    assert.equal(body.cache_bypass, undefined);
  });

  it("sends person_language to POST /v1/person/language with routing.path and cache bypass", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      await client.callTool({
        name: "person_language",
        arguments: {
          linkedin_url: "https://www.linkedin.com/in/example",
          first_name: "Anna",
          routing: { path: "speed" },
          skip_cache: true,
        },
      });
    });
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call);
    assert.match(call.url, /\/v1\/person\/language$/);
    assert.equal(call.headers["x-router-cache"], "bypass");
    const body = JSON.parse(call.body ?? "{}") as Record<string, unknown>;
    assert.deepEqual(body.routing, { path: "speed" });
    assert.equal(body.skip_cache, true);
    assert.equal(body.first_name, "Anna");
  });

  it("rejects routing.path coverage on person_language before calling the API", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "person_language",
        arguments: { email: "a@b.com", routing: { path: "coverage" } },
      });
      assert.equal(result.isError, true);
    });
    assert.equal(calls.length, 0);
  });

  it("documents the person.language contract on person_language", async () => {
    await withClient(async (client) => {
      const listed = await client.listTools();
      const tool = listed.tools.find((t) => t.name === "person_language");
      const description = tool?.description ?? "";
      assert.match(description, /POST \/v1\/person\/language/);
      assert.match(description, /speed \(cap 1/);
      assert.match(description, /balance \(default, cap 3/);
      assert.match(description, /accuracy \(cap 4/);
      assert.match(description, /coverage.*400 invalid_routing/);
      assert.match(description, /match-only/i);
    });
  });

  it("sends person_phone to POST /v1/person/phone with filter, routing.only, and cache bypass", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      await client.callTool({
        name: "person_phone",
        arguments: {
          linkedin_url: "https://www.linkedin.com/in/example",
          first_name: "Anna",
          phone_types: ["mobile"],
          max_results: 3,
          format: "national",
          routing: { only: ["wiza"] },
          cache_bypass: true,
        },
      });
    });
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call);
    assert.equal(call.method, "POST");
    assert.match(call.url, /\/v1\/person\/phone$/);
    assert.equal(call.headers["x-router-cache"], "bypass");
    const body = JSON.parse(call.body ?? "{}") as Record<string, unknown>;
    assert.deepEqual(body.phone_types, ["mobile"]);
    assert.equal(body.max_results, 3);
    assert.equal(body.format, "national");
    assert.deepEqual(body.routing, { only: ["wiza"] });
    assert.equal(body.first_name, "Anna");
    assert.equal(body.cache_bypass, undefined);
  });

  it("rejects invalid phone_types and max_results on person_phone before calling the API", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      const badType = await client.callTool({
        name: "person_phone",
        arguments: { email: "a@b.com", phone_types: ["fax"] },
      });
      assert.equal(badType.isError, true);
      const badMax = await client.callTool({
        name: "person_phone",
        arguments: { email: "a@b.com", max_results: 11 },
      });
      assert.equal(badMax.isError, true);
      const badFormat = await client.callTool({
        name: "person_phone",
        arguments: { email: "a@b.com", format: "dots" },
      });
      assert.equal(badFormat.isError, true);
    });
    assert.equal(calls.length, 0);
  });

  it("documents the person.phone contract on person_phone", async () => {
    await withClient(async (client) => {
      const listed = await client.listTools();
      const tool = listed.tools.find((t) => t.name === "person_phone");
      const description = tool?.description ?? "";
      assert.match(description, /POST \/v1\/person\/phone/);
      assert.match(description, /work email or LinkedIn URL/);
      assert.match(description, /38 credits on a hit, 0 on a miss/);
      assert.match(description, /match-only/i);
      assert.match(description, /conflicting_numbers/);
    });
  });

  it("sends person_title to POST /v1/person/title with fields, path, and cache bypass", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      await client.callTool({
        name: "person_title",
        arguments: {
          email: "anna@example.com",
          company_domain: "example.com",
          fields: ["seniority", "function"],
          routing: { path: "accuracy", ignore: ["wiza"] },
          cache_bypass: true,
        },
      });
    });
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call);
    assert.equal(call.method, "POST");
    assert.match(call.url, /\/v1\/person\/title$/);
    assert.equal(call.headers["x-router-cache"], "bypass");
    const body = JSON.parse(call.body ?? "{}") as Record<string, unknown>;
    assert.deepEqual(body.fields, ["seniority", "function"]);
    assert.deepEqual(body.routing, { path: "accuracy", ignore: ["wiza"] });
    assert.equal(body.company_domain, "example.com");
    assert.equal(body.cache_bypass, undefined);
  });

  it("rejects invalid fields and paths on person_title before calling the API", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      const badField = await client.callTool({
        name: "person_title",
        arguments: { email: "a@b.com", fields: ["salary"] },
      });
      assert.equal(badField.isError, true);
      const badPath = await client.callTool({
        name: "person_title",
        arguments: { email: "a@b.com", routing: { path: "turbo" } },
      });
      assert.equal(badPath.isError, true);
    });
    assert.equal(calls.length, 0);
  });

  it("documents the person.title contract on person_title", async () => {
    await withClient(async (client) => {
      const listed = await client.listTools();
      const tool = listed.tools.find((t) => t.name === "person_title");
      const description = tool?.description ?? "";
      assert.match(description, /POST \/v1\/person\/title/);
      assert.match(description, /1 \/ 2 \/ 3 \/ 5 credits on a hit/);
      assert.match(description, /fields_incomplete/);
      assert.match(description, /match-only/i);
      assert.match(description, /employer_mismatch/);
    });
  });

  it("sends person_b2b_social to POST /v1/person/b2b-social with match-only names, path, and cache bypass", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      await client.callTool({
        name: "person_b2b_social",
        arguments: {
          email: "anna@example.com",
          first_name: "Anna",
          last_name: "Example",
          min_confidence: "medium",
          routing: { path: "accuracy", ignore: ["wiza"] },
          cache_bypass: true,
        },
      });
    });
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call);
    assert.equal(call.method, "POST");
    assert.match(call.url, /\/v1\/person\/b2b-social$/);
    assert.equal(call.headers["x-router-cache"], "bypass");
    const body = JSON.parse(call.body ?? "{}") as Record<string, unknown>;
    assert.equal(body.email, "anna@example.com");
    assert.equal(body.first_name, "Anna");
    assert.equal(body.min_confidence, "medium");
    assert.deepEqual(body.routing, { path: "accuracy", ignore: ["wiza"] });
    assert.equal(body.cache_bypass, undefined);
  });

  it("rejects coverage and invalid min_confidence on person_b2b_social before calling the API", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      const coverage = await client.callTool({
        name: "person_b2b_social",
        arguments: { email: "a@b.com", routing: { path: "coverage" } },
      });
      assert.equal(coverage.isError, true);
      const badFloor = await client.callTool({
        name: "person_b2b_social",
        arguments: { email: "a@b.com", min_confidence: "certain" },
      });
      assert.equal(badFloor.isError, true);
    });
    assert.equal(calls.length, 0);
  });

  it("documents the person.b2b_social contract on person_b2b_social", async () => {
    await withClient(async (client) => {
      const listed = await client.listTools();
      const tool = listed.tools.find((t) => t.name === "person_b2b_social");
      const description = tool?.description ?? "";
      assert.match(description, /POST \/v1\/person\/b2b-social/);
      assert.match(description, /2 \/ 3 \/ 5 credits on a hit/);
      assert.match(description, /email is required/);
      assert.match(description, /match-only/i);
      assert.match(description, /No coverage tier/);
      assert.match(description, /no safe_to_write/);
    });
  });

  it("sends person_name to POST /v1/person/name with min_confidence, path, and cache bypass", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      await client.callTool({
        name: "person_name",
        arguments: {
          linkedin_url: "https://www.linkedin.com/in/example",
          min_confidence: "high",
          routing: { path: "accuracy", ignore: ["wiza"] },
          cache_bypass: true,
        },
      });
    });
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call);
    assert.equal(call.method, "POST");
    assert.match(call.url, /\/v1\/person\/name$/);
    assert.equal(call.headers["x-router-cache"], "bypass");
    const body = JSON.parse(call.body ?? "{}") as Record<string, unknown>;
    assert.equal(body.linkedin_url, "https://www.linkedin.com/in/example");
    assert.equal(body.min_confidence, "high");
    assert.deepEqual(body.routing, { path: "accuracy", ignore: ["wiza"] });
    assert.equal(body.cache_bypass, undefined);
  });

  it("rejects invalid min_confidence and paths on person_name before calling the API", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      const badFloor = await client.callTool({
        name: "person_name",
        arguments: { email: "a@b.com", min_confidence: "certain" },
      });
      assert.equal(badFloor.isError, true);
      const badPath = await client.callTool({
        name: "person_name",
        arguments: { email: "a@b.com", routing: { path: "turbo" } },
      });
      assert.equal(badPath.isError, true);
    });
    assert.equal(calls.length, 0);
  });

  it("documents the person.name contract on person_name", async () => {
    await withClient(async (client) => {
      const listed = await client.listTools();
      const tool = listed.tools.find((t) => t.name === "person_name");
      const description = tool?.description ?? "";
      assert.match(description, /POST \/v1\/person\/name/);
      assert.match(description, /1 \/ 2 \/ 3 \/ 5 credits on a hit/);
      assert.match(description, /answer\.confidence only/);
      assert.match(description, /no safe_to_write/);
      assert.match(description, /role_address/);
    });
  });

  it("sends person_email to POST /v1/person/email with both routes, path, and skip_cache", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      await client.callTool({
        name: "person_email",
        arguments: {
          first_name: "Anna",
          last_name: "Example",
          company_domain: "example.com",
          linkedin_url: "https://www.linkedin.com/in/example",
          min_confidence: "high",
          routing: { path: "coverage" },
          skip_cache: true,
          external_ref: "row-7",
          compliance: { soc2: true },
        },
      });
    });
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call);
    assert.equal(call.method, "POST");
    assert.match(call.url, /\/v1\/person\/email$/);
    const body = JSON.parse(call.body ?? "{}") as Record<string, unknown>;
    assert.equal(body.first_name, "Anna");
    assert.equal(body.last_name, "Example");
    assert.equal(body.company_domain, "example.com");
    assert.equal(body.linkedin_url, "https://www.linkedin.com/in/example");
    assert.equal(body.min_confidence, "high");
    assert.deepEqual(body.routing, { path: "coverage" });
    assert.equal(body.skip_cache, true);
    assert.equal(body.external_ref, "row-7");
    assert.deepEqual(body.compliance, { soc2: true });
  });

  it("sends email_verify to POST /v1/email/verify with path and dry_run", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      await client.callTool({
        name: "email_verify",
        arguments: {
          email: "anna@example.com",
          min_confidence: "medium",
          routing: { path: "accuracy" },
          dry_run: true,
          external_ref: "row-8",
        },
      });
    });
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call);
    assert.equal(call.method, "POST");
    assert.match(call.url, /\/v1\/email\/verify$/);
    const body = JSON.parse(call.body ?? "{}") as Record<string, unknown>;
    assert.equal(body.email, "anna@example.com");
    assert.equal(body.min_confidence, "medium");
    assert.deepEqual(body.routing, { path: "accuracy" });
    assert.equal(body.dry_run, true);
    assert.equal(body.external_ref, "row-8");
  });

  it("rejects a missing email, legacy paths and invalid min_confidence on email_verify / person_email before calling the API", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      const noEmail = await client.callTool({
        name: "email_verify",
        arguments: {},
      });
      assert.equal(noEmail.isError, true);
      const tooLong = await client.callTool({
        name: "email_verify",
        arguments: { email: `${"a".repeat(316)}@b.co` },
      });
      assert.equal(tooLong.isError, true);
      for (const name of ["email_verify", "person_email"]) {
        const legacy = await client.callTool({
          name,
          arguments: { email: "a@b.com", routing: { path: "value" } },
        });
        assert.equal(legacy.isError, true, name);
        const badFloor = await client.callTool({
          name,
          arguments: { email: "a@b.com", min_confidence: "certain" },
        });
        assert.equal(badFloor.isError, true, name);
      }
    });
    assert.equal(calls.length, 0);
  });

  it("documents email_verify and person_email without vendor names, lookup order or exact prices", async () => {
    await withClient(async (client) => {
      const listed = await client.listTools();
      const verify =
        listed.tools.find((t) => t.name === "email_verify")?.description ?? "";
      const find =
        listed.tools.find((t) => t.name === "person_email")?.description ?? "";
      assert.match(verify, /POST \/v1\/email\/verify/);
      assert.match(verify, /is this mailbox deliverable\?/);
      assert.match(verify, /0\.5–1\.5 credits/);
      assert.match(find, /POST \/v1\/person\/email/);
      assert.match(find, /this person's work email\?/);
      assert.match(find, /1\.5–5 credits/);
      for (const description of [verify, find]) {
        assert.match(
          description,
          /only a delivered answer is billed; misses, catch-alls and conflicts are not/,
        );
        for (const path of ["speed", "balance", "accuracy", "coverage"]) {
          assert.match(description, new RegExp(`\\b${path} \\(`));
        }
        assert.doesNotMatch(
          description,
          /leadmagic|findymail|wiza|zoominfo|ai ark|\d+(\.\d+)?\s?%/i,
        );
      }
    });
  });

  it("email_verify and person_email input schemas match the request contracts", () => {
    const verifyKeys = new Set(Object.keys(EmailVerifyInput));
    for (const key of [
      "email",
      "min_confidence",
      "routing",
      "dry_run",
      "external_ref",
      "compliance",
    ]) {
      assert.ok(verifyKeys.has(key), key);
    }
    assert.equal(verifyKeys.has("skip_cache"), false);
    const findKeys = new Set(Object.keys(PersonEmailInput));
    for (const key of [
      "first_name",
      "last_name",
      "company_domain",
      "linkedin_url",
      "person",
      "min_confidence",
      "routing",
      "skip_cache",
      "dry_run",
      "external_ref",
      "compliance",
    ]) {
      assert.ok(findKeys.has(key), key);
    }
    assert.equal(findKeys.has("email"), false);
  });

  it("accepts email.verify and person.email capabilities on submit_feedback", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      for (const capability of ["email.verify", "person.email"]) {
        const result = await client.callTool({
          name: "submit_feedback",
          arguments: {
            category: "data_quality",
            summary: "Mailbox status disagreed with a later bounce",
            details: "The address bounced after a valid answer.",
            source: "agent",
            capability,
          },
        });
        assert.equal(result.isError, undefined, capability);
      }
    });
    assert.equal(calls.length, 2);
    assert.equal(JSON.parse(calls[1]?.body ?? "{}").capability, "person.email");
  });

  it("sends company_x_account to POST /v1/company/x-account with min_confidence and path", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      await client.callTool({
        name: "company_x_account",
        arguments: {
          name: "Stripe",
          x_url: "https://x.com/stripe",
          min_confidence: "high",
          routing: { path: "accuracy", ignore: ["wiza"] },
          dry_run: true,
        },
      });
    });
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call);
    assert.equal(call.method, "POST");
    assert.match(call.url, /\/v1\/company\/x-account$/);
    const body = JSON.parse(call.body ?? "{}") as Record<string, unknown>;
    assert.equal(body.name, "Stripe");
    assert.equal(body.x_url, "https://x.com/stripe");
    assert.equal(body.min_confidence, "high");
    assert.deepEqual(body.routing, { path: "accuracy", ignore: ["wiza"] });
    assert.equal(body.dry_run, true);
  });

  it("rejects invalid min_confidence and paths on company_x_account before calling the API", async () => {
    const { calls } = captureFetch();
    await withClient(async (client) => {
      const badFloor = await client.callTool({
        name: "company_x_account",
        arguments: { domain: "acme.com", min_confidence: "certain" },
      });
      assert.equal(badFloor.isError, true);
      const badPath = await client.callTool({
        name: "company_x_account",
        arguments: { domain: "acme.com", routing: { path: "turbo" } },
      });
      assert.equal(badPath.isError, true);
    });
    assert.equal(calls.length, 0);
  });

  it("documents the company.x_account contract on company_x_account", async () => {
    await withClient(async (client) => {
      const listed = await client.listTools();
      const tool = listed.tools.find((t) => t.name === "company_x_account");
      const description = tool?.description ?? "";
      assert.match(description, /POST \/v1\/company\/x-account/);
      assert.match(
        description,
        /speed 1 \/ balance 1\.3 \/ accuracy 1\.6 \/ coverage 1\.7/,
      );
      assert.match(
        description,
        /Confidence is the only write signal \(no safe_to_write\)/,
      );
      assert.match(description, /never twitter\.com/);
    });
  });

  it("company_x_account input schema matches CompanyXAccountRequest", () => {
    const keys = new Set(Object.keys(DecideCompanyXAccountInput));
    for (const key of [
      "name",
      "domain",
      "website",
      "email",
      "country",
      "hint",
      "x_url",
      "min_confidence",
      "routing",
      "path",
      "preset",
      "dry_run",
      "external_ref",
      "compliance",
    ]) {
      assert.ok(keys.has(key), key);
    }
    assert.equal(keys.has("linkedin_url"), false);
    assert.equal(keys.has("skip_cache"), false);
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
      await client.callTool({
        name: "put_credentials",
        arguments: {
          provider: "snovio",
          clientId: "snov-id",
          clientSecret: "snov-sec",
        },
      });
    });
    assert.equal(calls.length, 3);
    assert.deepEqual(JSON.parse(calls[0]?.body ?? "{}"), {
      clientId: "id",
      clientSecret: "sec",
    });
    assert.deepEqual(JSON.parse(calls[1]?.body ?? "{}"), { apiKey: "fm-key" });
    assert.deepEqual(JSON.parse(calls[2]?.body ?? "{}"), {
      clientId: "snov-id",
      clientSecret: "snov-sec",
    });
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
      const snovKey = await client.callTool({
        name: "put_credentials",
        arguments: { provider: "snovio", apiKey: "nope" },
      });
      const other = await client.callTool({
        name: "put_credentials",
        arguments: { provider: "wiza" },
      });
      for (const result of [zoom, zoomKey, snovKey, other]) {
        assert.equal(result.isError, true);
        const text = toolText(result);
        assert.match(text, /bad_request/);
        assert.doesNotMatch(text, new RegExp(BEARER));
      }
      assert.match(toolText(zoom), /clientId and clientSecret/);
      assert.match(toolText(zoomKey), /does not accept apiKey/);
      assert.match(toolText(snovKey), /does not accept apiKey/);
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

  it("documents kingminos-application PR #181 company.description contract on company_description", async () => {
    await withClient(async (client) => {
      const listed = await client.listTools();
      const tool = listed.tools.find((t) => t.name === "company_description");
      const description = tool?.description ?? "";
      assert.match(description, /POST \/v1\/company\/description/);
      assert.match(description, /not aliases/i);
      assert.match(description, /speed.*balance.*accuracy.*coverage/i);
      assert.match(description, /Always pass path explicitly/i);
      assert.match(description, /omit runs balance at cap 6/i);
      assert.match(description, /path balance is cap 2/i);
      assert.match(description, /AI Ark/i);
      assert.match(description, /same_as_speed/);
      assert.match(description, /hype.*first_person.*tagline.*grammar/i);
      assert.match(description, /grammar is informational only/i);
      assert.match(description, /do not reject unknown/i);
      assert.match(description, /usage\.hops/);
      assert.match(description, /by_provider/);
      assert.match(description, /not company\.description vendors/i);
      assert.doesNotMatch(description, /speed = LeadMagic/i);
      assert.doesNotMatch(description, /Wiza \/ Findymail/i);
      assert.doesNotMatch(description, /same house stack/i);
      assert.match(description, /ZoomInfo is BYOK-only/i);
      assert.match(description, /truncated/);
      assert.match(description, /cta/);
      assert.match(description, /safe_to_write\.description/);
      assert.match(description, /answer\.identity/);
      assert.match(description, /low is never safe to write/i);
      assert.match(description, /skip_cache true or cache_bypass true/i);
      assert.match(description, /Idempotency-Key replay/i);
      assert.match(description, /company\.resolve ignores bypass inputs/i);
      assert.match(
        description,
        /Cache-Control no-cache or no-store is API-only/i,
      );
      assert.doesNotMatch(description, /40–2000/);
    });
  });

  it("documents kingminos-application PR #186 company.icon hosted URL contract on company_icon", async () => {
    await withClient(async (client) => {
      const listed = await client.listTools();
      const tool = listed.tools.find((t) => t.name === "company_icon");
      const description = tool?.description ?? "";
      assert.match(description, /POST \/v1\/company\/icon/);
      assert.match(description, /logos\.kingminos\.com\/i\/<sha256>\.png/);
      assert.match(description, /256×256 PNG in R2/);
      assert.match(description, /result\.icon_source_url/);
      assert.match(description, /never a third-party/i);
      assert.match(description, /Fetch or store failure is a miss/i);
      assert.match(description, /icon_url null/);
      assert.match(description, /wrong-company, junk, and empty only/i);
      assert.match(description, /under 64px/i);
      assert.match(description, /flags\.low_res true/i);
      assert.match(description, /answer\.confidence low/i);
      assert.match(description, /safe_to_write\.icon_url true/i);
      assert.match(description, /including low-res/i);
      assert.match(
        description,
        /routing, path, and preset are not part of the contract/i,
      );
      assert.match(description, /One implementation ladder/i);
      assert.doesNotMatch(description, /Omit = balance/);
      assert.doesNotMatch(description, /Live HTTPS/);
    });
  });

  it("company_icon input schema matches CompanyIconRequest (domain, optional name, run options)", () => {
    const keys = new Set(Object.keys(DecideCompanyIconInput));
    assert.ok(keys.has("domain"));
    assert.ok(keys.has("name"));
    assert.ok(keys.has("dry_run"));
    assert.ok(keys.has("external_ref"));
    assert.equal(keys.has("routing"), false);
    assert.equal(keys.has("path"), false);
    assert.equal(keys.has("preset"), false);
    assert.equal(keys.has("website"), false);
    assert.equal(keys.has("email"), false);
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
    assert.deepEqual(
      credentialPutBody({
        provider: "snovio",
        clientId: "a",
        clientSecret: "b",
      }),
      { clientId: "a", clientSecret: "b" },
    );
    assert.throws(
      () => credentialPutBody({ provider: "snovio", apiKey: "x" }),
      /does not accept apiKey/,
    );
  });
});
