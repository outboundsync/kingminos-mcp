import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LIVE_RESOURCE_ROUTES } from "./catalog.js";
import { DIRECTORY_HIDDEN_TOOLS } from "./directory-tools.js";
import { type RuntimeEnv, workerRuntimeEnv } from "./env.js";
import { handleFetch } from "./fetch.js";
import { type AuthServerBinding, oauthToolAllowed } from "./oauth.js";
import {
  RESULT_CARD_FIELDS,
  RESULT_CARD_HTML,
  RESULT_CARD_MIME_TYPE,
  RESULT_CARD_URI,
  resultCardContent,
} from "./result-card.js";
import { CAPABILITY_TOOL_NAMES } from "./server.js";

const RESOURCE = "https://mcp.kingminos.com/mcp";
const OAUTH_ON = { OAUTH_ENABLED: "on", KINGMINOS_MCP_PUBLIC_URL: RESOURCE };
const CARDS_ON = { ...OAUTH_ON, MCP_RESULT_CARDS: "on" };
const OAUTH_TOKEN = "usr_1:grant_1:secret";
const API_KEY = "km_live_example";

/** Words a directory reviewer would flag (kept in step with directory-tools.test.ts). */
const FORBIDDEN =
  /zoominfo|leadmagic|findymail|wiza|ai ?ark|apollo|serper|\bxai\b|typesafe|\bjev\b|clay\b|lusha|cognism|brandfetch|credit|price|pricing|\bcost|est_credits|\$\d|sfdc|upgrade|buy now|subscribe/i;

const RESOLVE_PAYLOAD = {
  ok: true,
  run_id: "run_123",
  capability: "company.resolve",
  es_decision: "hit",
  answer: {
    outcome: "resolved",
    es_decision: "hit",
    confidence: "high",
    reason_code: "resolved",
    summary: "ZoomInfo answered on path balance",
  },
  result: {
    company_name: "Acme Corp",
    company_domain: "acme.com",
    website: "https://www.acme.com/",
    linkedin_url: "https://www.linkedin.com/company/acme",
    zoominfo_company_id: "12345",
    identifiers: [{ type: "zoominfo", value: "12345" }],
  },
  usage: { credits: { total: 3 } },
  next_steps: [{ endpoint: "/v1/company/domain", est_credits: 2 }],
};

function binding(payload: unknown = RESOLVE_PAYLOAD): AuthServerBinding {
  return {
    async validateToken() {
      return {
        props: { userId: "usr_1", workspaceId: "ws_1", platform: "chatgpt" },
        audience: RESOURCE,
        expiresAt: Date.now() / 1000 + 3600,
        scope: ["capability:*"],
      };
    },
    async fetch() {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
}

async function connect(
  env: RuntimeEnv,
  token: string,
  payload: unknown = RESOLVE_PAYLOAD,
): Promise<Client> {
  const authServer = binding(payload);
  const originalFetch = globalThis.fetch;
  const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (input, init) => {
      // API-key callers go over global fetch; answer them with the same payload.
      globalThis.fetch = async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      try {
        return await handleFetch(new Request(input, init), env, {
          mode: "worker",
          authServer,
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  });
  const client = new Client({ name: "result-card-test", version: "0" });
  await client.connect(transport);
  return client;
}

async function withClient<T>(
  env: RuntimeEnv,
  token: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await connect(env, token);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function cardUris(client: Client): Promise<string[]> {
  if (!client.getServerCapabilities()?.resources) {
    return [];
  }
  return (await client.listResources()).resources.map((r) => r.uri);
}

const CARD_TOOLS = Object.keys(RESULT_CARD_FIELDS);

describe("result card resource", () => {
  it("is listed and served only for OAuth callers with MCP_RESULT_CARDS=on", async () => {
    await withClient(CARDS_ON, OAUTH_TOKEN, async (client) => {
      const listed = (await client.listResources()).resources;
      assert.deepEqual(
        listed.map((r) => [r.uri, r.mimeType]),
        [[RESULT_CARD_URI, RESULT_CARD_MIME_TYPE]],
      );
      const read = await client.readResource({ uri: RESULT_CARD_URI });
      const [content] = read.contents;
      assert.equal(content?.mimeType, "text/html;profile=mcp-app");
      assert.equal((content as { text?: string }).text, RESULT_CARD_HTML);
      assert.deepEqual(content?._meta, {
        ui: {
          csp: {
            connectDomains: [],
            resourceDomains: ["https://logos.kingminos.com"],
          },
          prefersBorder: true,
        },
      });
    });
    await withClient(OAUTH_ON, OAUTH_TOKEN, async (client) => {
      assert.deepEqual(await cardUris(client), [], "switch off");
    });
    await withClient(CARDS_ON, API_KEY, async (client) => {
      assert.deepEqual(await cardUris(client), [], "API key");
    });
  });

  it("is a ui:// URI with a version so hosts drop cached copies on change", () => {
    assert.match(RESULT_CARD_URI, /^ui:\/\/kingminos\/result-card-v\d+\.html$/);
  });
});

describe("result card tool metadata", () => {
  it("covers only lookup tools a connected app can call", () => {
    const visible = new Set(
      LIVE_RESOURCE_ROUTES.filter(
        (route) =>
          oauthToolAllowed(route) && !DIRECTORY_HIDDEN_TOOLS.has(route.tool),
      ).map((route) => route.tool as string),
    );
    for (const tool of CARD_TOOLS) {
      assert.ok(
        (CAPABILITY_TOOL_NAMES as readonly string[]).includes(tool),
        `${tool} is not a lookup`,
      );
      assert.ok(visible.has(tool), `${tool} is hidden from connected apps`);
    }
  });

  it("puts the card on lookup tools only when OAuth and the switch are on", async () => {
    await withClient(CARDS_ON, OAUTH_TOKEN, async (client) => {
      const tools = (await client.listTools()).tools;
      for (const tool of tools) {
        const meta = tool._meta as Record<string, unknown> | undefined;
        if (CARD_TOOLS.includes(tool.name)) {
          assert.deepEqual(
            meta?.ui,
            { resourceUri: RESULT_CARD_URI },
            tool.name,
          );
          assert.equal(meta?.["openai/outputTemplate"], RESULT_CARD_URI);
          assert.ok(
            meta?.securitySchemes,
            `${tool.name} keeps securitySchemes`,
          );
        } else {
          assert.equal(meta?.ui, undefined, tool.name);
          assert.equal(meta?.["openai/outputTemplate"], undefined, tool.name);
        }
      }
      assert.ok(tools.some((tool) => tool.name === "company_resolve"));
    });
    for (const [env, token] of [
      [OAUTH_ON, OAUTH_TOKEN],
      [CARDS_ON, API_KEY],
    ] as const) {
      await withClient(env, token, async (client) => {
        for (const tool of (await client.listTools()).tools) {
          const meta = tool._meta as Record<string, unknown> | undefined;
          assert.equal(meta?.ui, undefined, `${token} ${tool.name}`);
          assert.equal(meta?.["openai/outputTemplate"], undefined);
        }
      });
    }
  });
});

describe("result card structuredContent", () => {
  it("returns the trimmed answer for OAuth lookups and keeps the text content", async () => {
    await withClient(CARDS_ON, OAUTH_TOKEN, async (client) => {
      const result = await client.callTool({
        name: "company_resolve",
        arguments: { domain: "acme.com" },
      });
      assert.deepEqual(result.structuredContent, {
        capability: "company.resolve",
        answer: {
          outcome: "resolved",
          es_decision: "hit",
          confidence: "high",
          reason_code: "resolved",
        },
        result: {
          company_name: "Acme Corp",
          company_domain: "acme.com",
          website: "https://www.acme.com/",
          linkedin_url: "https://www.linkedin.com/company/acme",
        },
        fields: [...(RESULT_CARD_FIELDS.company_resolve ?? [])],
      });
      assert.doesNotMatch(JSON.stringify(result.structuredContent), FORBIDDEN);
      const [text] = result.content as Array<{ type: string; text: string }>;
      assert.deepEqual(JSON.parse(text?.text ?? ""), RESOLVE_PAYLOAD);
    });
  });

  it("is absent for API keys, with the switch off, and on non-lookup tools", async () => {
    for (const [env, token] of [
      [CARDS_ON, API_KEY],
      [OAUTH_ON, OAUTH_TOKEN],
    ] as const) {
      await withClient(env, token, async (client) => {
        const result = await client.callTool({
          name: "company_resolve",
          arguments: { domain: "acme.com" },
        });
        assert.equal(result.structuredContent, undefined, token);
        assert.deepEqual(Object.keys(result).sort(), ["content"]);
      });
    }
    await withClient(CARDS_ON, OAUTH_TOKEN, async (client) => {
      const result = await client.callTool({
        name: "get_capabilities",
        arguments: {},
      });
      assert.equal(result.structuredContent, undefined);
    });
  });

  it("keeps nested person fields and drops nulls", () => {
    const content = resultCardContent("person_phone", {
      capability: "person.phone",
      answer: { outcome: "hit", es_decision: "hit", confidence: "medium" },
      result: {
        person: {
          first_name: "Ada",
          last_name: "Lovelace",
          linkedin_url: null,
          email: "ada@acme.com",
        },
        best_phone: { e164: "+14155550100", type: "mobile", source: "vendor" },
        phones: [{ e164: "+14155550100" }],
      },
    });
    assert.deepEqual(content, {
      capability: "person.phone",
      answer: { outcome: "hit", es_decision: "hit", confidence: "medium" },
      result: {
        person: { first_name: "Ada", last_name: "Lovelace" },
        best_phone: { e164: "+14155550100", type: "mobile" },
      },
      fields: [...(RESULT_CARD_FIELDS.person_phone ?? [])],
    });
  });

  it("returns a miss with an empty result, and nothing for non-envelopes", () => {
    assert.deepEqual(
      resultCardContent("email_verify", {
        capability: "email.verify",
        answer: { outcome: "zero_hits", es_decision: "miss", confidence: null },
        result: { email: null, status: "unknown" },
      }),
      {
        capability: "email.verify",
        answer: { outcome: "zero_hits", es_decision: "miss" },
        result: { status: "unknown" },
        fields: ["email", "status"],
      },
    );
    assert.equal(resultCardContent("company_resolve", { ok: true }), undefined);
    assert.equal(resultCardContent("company_resolve", "text"), undefined);
    assert.equal(resultCardContent("get_balance", RESOLVE_PAYLOAD), undefined);
  });

  it("titles a description card with the company name when one comes back", () => {
    const content = resultCardContent("company_description", {
      capability: "company.description",
      answer: { outcome: "hit", es_decision: "hit" },
      result: {
        company_name: "Acme Corp",
        company_domain: "acme.com",
        description: "Acme Corp makes anvils.",
      },
    });
    assert.equal(content?.result.company_name, "Acme Corp");
  });

  it("sends each tool's own row order (company_domain: CRM primary before the live domain)", () => {
    const content = resultCardContent("company_domain", {
      capability: "company.domain",
      answer: { outcome: "hit", es_decision: "hit" },
      result: { company_domain: "acme.io", account_primary_domain: "acme.com" },
    });
    const fields = content?.fields ?? [];
    assert.ok(
      fields.indexOf("account_primary_domain") <
        fields.indexOf("company_domain"),
    );
  });
});

describe("result card HTML", () => {
  it("loads no external scripts, styles, fonts or frames and makes no requests", () => {
    assert.doesNotMatch(RESULT_CARD_HTML, /<script[^>]*\bsrc=/i);
    assert.doesNotMatch(RESULT_CARD_HTML, /<link\b/i);
    assert.doesNotMatch(
      RESULT_CARD_HTML,
      /<iframe\b|@import|\burl\(\s*["']?(https?:|\/\/)/i,
    );
    assert.doesNotMatch(
      RESULT_CARD_HTML,
      /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|document\.cookie|\beval\(|new Function/,
    );
    const urls = RESULT_CARD_HTML.match(/https?:\/\/[^\s"'<>)]+/g) ?? [];
    assert.deepEqual(urls, [], "no literal URLs in the view");
  });

  it("names no vendors, credits, prices or upsell", () => {
    assert.doesNotMatch(RESULT_CARD_HTML, FORBIDDEN);
  });

  it("only shows icons from the declared logo host", () => {
    assert.match(RESULT_CARD_HTML, /logos\\\.kingminos\\\.com/);
  });

  it("has light and dark themes and a quiet miss state", () => {
    assert.match(RESULT_CARD_HTML, /prefers-color-scheme: dark/);
    assert.match(RESULT_CARD_HTML, /data-theme="dark"/);
    assert.match(RESULT_CARD_HTML, /No confident answer/);
  });

  it("speaks the MCP Apps bridge with ChatGPT's globals as fallback", () => {
    for (const method of [
      "ui/initialize",
      "ui/notifications/initialized",
      "ui/notifications/tool-result",
      "ui/notifications/host-context-changed",
      "ui/notifications/size-changed",
      "ui/open-link",
    ]) {
      assert.ok(RESULT_CARD_HTML.includes(`"${method}"`), method);
    }
    assert.match(RESULT_CARD_HTML, /openai:set_globals/);
  });
});

describe("MCP_RESULT_CARDS env", () => {
  it("is copied from Worker bindings and defaults off", () => {
    assert.equal(
      workerRuntimeEnv({ MCP_RESULT_CARDS: "on" }).MCP_RESULT_CARDS,
      "on",
    );
    assert.equal(workerRuntimeEnv({}).MCP_RESULT_CARDS, undefined);
  });
});
