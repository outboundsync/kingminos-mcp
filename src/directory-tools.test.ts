import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LIVE_RESOURCE_ROUTES } from "./catalog.js";
import {
  DIRECTORY_HIDDEN_TOOLS,
  DIRECTORY_INSTRUCTIONS,
  DIRECTORY_TOOL_COPY,
} from "./directory-tools.js";
import { handleFetch } from "./fetch.js";
import { type AuthServerBinding, oauthToolAllowed } from "./oauth.js";
import { TOOL_SPECS } from "./server.js";

const RESOURCE = "https://mcp.kingminos.com/mcp";
const ON = { OAUTH_ENABLED: "on", KINGMINOS_MCP_PUBLIC_URL: RESOURCE };

/** Words a directory reviewer would flag in what a connected app sees. */
const FORBIDDEN =
  /zoominfo|leadmagic|findymail|wiza|ai ?ark|apollo|serper|\bxai\b|typesafe|\bjev\b|clay\b|lusha|cognism|credit|price|pricing|\bcost|est_credits|\$\d|sfdc|auto-?pick|never pick|present every/i;

function binding(): AuthServerBinding & { sent: Request[] } {
  const sent: Request[] = [];
  return {
    sent,
    async validateToken() {
      return {
        props: { userId: "usr_1", workspaceId: "ws_1", platform: "chatgpt" },
        audience: RESOURCE,
        expiresAt: Date.now() / 1000 + 3600,
        scope: ["capability:*"],
      };
    },
    async fetch(input: Request | string, init?: RequestInit) {
      sent.push(typeof input === "string" ? new Request(input, init) : input);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
}

async function connect(token: string, authServer: AuthServerBinding) {
  const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (input, init) =>
      handleFetch(new Request(input, init), ON, { mode: "worker", authServer }),
  });
  const client = new Client({ name: "directory-test", version: "0" });
  await client.connect(transport);
  return client;
}

const directoryTools = LIVE_RESOURCE_ROUTES.filter(
  (route) => oauthToolAllowed(route) && !DIRECTORY_HIDDEN_TOOLS.has(route.tool),
).map((route) => route.tool);

describe("connected-app tool copy", () => {
  it("covers every tool a connected app can see", () => {
    for (const tool of directoryTools) {
      assert.ok(DIRECTORY_TOOL_COPY[tool], `${tool} has no connected-app copy`);
    }
  });

  it("only lists fields that exist in the real input schema", () => {
    for (const [tool, copy] of Object.entries(DIRECTORY_TOOL_COPY)) {
      const full = TOOL_SPECS[tool as keyof typeof TOOL_SPECS].inputSchema;
      for (const field of Object.keys(copy?.fields ?? {})) {
        assert.ok(full[field], `${tool}.${field} is not in TOOL_SPECS`);
      }
    }
  });

  it("never names a vendor, credits, prices or SFDC, and never steers the model", async () => {
    assert.doesNotMatch(DIRECTORY_INSTRUCTIONS, FORBIDDEN);
    const client = await connect("usr_1:grant_1:secret", binding());
    try {
      const tools = (await client.listTools()).tools;
      assert.deepEqual(
        tools.map((tool) => tool.name).sort(),
        [...directoryTools].sort(),
      );
      for (const tool of tools) {
        const visible = JSON.stringify({
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
        assert.doesNotMatch(visible, FORBIDDEN, tool.name);
      }
      const instructions = client.getInstructions() ?? "";
      assert.doesNotMatch(instructions, FORBIDDEN);
    } finally {
      await client.close();
    }
  });

  it("hides get_providers from connected apps but keeps it for API keys", async () => {
    const oauth = await connect("usr_1:grant_1:secret", binding());
    const key = await connect("km_live_example", binding());
    try {
      assert.equal(
        (await oauth.listTools()).tools.some(
          (tool) => tool.name === "get_providers",
        ),
        false,
      );
      assert.equal(
        (await key.listTools()).tools.some(
          (tool) => tool.name === "get_providers",
        ),
        true,
      );
      const keyTool = (await key.listTools()).tools.find(
        (tool) => tool.name === "company_domain",
      );
      assert.ok(
        keyTool?.inputSchema.properties &&
          "routing" in keyTool.inputSchema.properties,
        "keys keep routing knobs",
      );
    } finally {
      await oauth.close();
      await key.close();
    }
  });

  it("still sends the subject fields to the API", async () => {
    const authServer = binding();
    const client = await connect("usr_1:grant_1:secret", authServer);
    try {
      await client.callTool({
        name: "company_domain",
        arguments: { name: "Acme", domain: "acme.com" },
      });
      const sent = authServer.sent.at(-1) as Request;
      assert.equal(new URL(sent.url).pathname, "/v1/company/domain");
      const body = (await sent.json()) as Record<string, unknown>;
      assert.equal(body.domain, "acme.com");
      assert.equal(body.name, "Acme");
    } finally {
      await client.close();
    }
  });
});
