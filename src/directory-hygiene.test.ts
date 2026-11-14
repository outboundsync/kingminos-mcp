import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ADMIN_TOOL_NAMES } from "./admin-tools.js";
import { LIVE_RESOURCE_ROUTES, type ToolName } from "./catalog.js";
import { VERSION } from "./config.js";
import { handleFetch } from "./fetch.js";
import { TOOL_SPECS } from "./server.js";

const EXPECTED_TITLES: Record<ToolName, string> = {
  get_providers: "List providers",
  get_capabilities: "Get capability catalog",
  get_recipes: "Get chaining recipes",
  get_balance: "Get credit balance",
  get_balance_ledger: "Get credit ledger",
  get_balance_history: "Get credit history",
  get_balance_forecast: "Forecast credit runout",
  get_balance_health: "Check billing health",
  get_usage: "Get usage totals",
  company_resolve: "Resolve a company",
  company_domain: "Decide company domain",
  company_hierarchy: "Decide company hierarchy",
  company_b2b_social: "Find company LinkedIn page",
  company_x_account: "Find company X account",
  company_icon: "Fetch company icon",
  company_description: "Write company description",
  person_verify_employment: "Verify employment",
  person_language: "Detect a person's language",
  person_phone: "Find a person's phone",
  person_title: "Find a person's title",
  person_b2b_social: "Find a person's LinkedIn",
  person_name: "Normalize a person's name",
  person_email: "Find a person's work email",
  email_verify: "Verify email deliverability",
  get_run: "Get a run",
  list_credentials: "List stored vendor keys",
  put_credentials: "Store a vendor key",
  delete_credentials: "Delete a vendor key",
  delete_subject: "Erase a subject",
  list_webhooks: "List webhooks",
  create_webhook: "Create a webhook",
  get_webhook: "Get a webhook",
  patch_webhook: "Update a webhook",
  delete_webhook: "Delete a webhook",
  rotate_webhook_secret: "Rotate webhook secret",
  test_webhook: "Send a test webhook",
  list_webhook_deliveries: "List webhook deliveries",
  replay_webhook_delivery: "Replay a webhook delivery",
  list_events: "List platform events",
  submit_feedback: "Submit product feedback",
};

const STEERING =
  /trusted extension|Call get_capabilities before|wanted a field or provider we don't have/;
const RECIPE_VENDORS =
  /BuiltWith|Prospeo|Apollo|Company URL Finder|People Data Labs|HG Insights|Enrich-CRM|Lemlist|Cognism|Lusha|Starbridge|Databar|QuickEnrich|GetLeads|BlitzAPI|LeadMagic|Wiza|Findymail|AI Ark/;
const HTTP_PREFIX = /^(GET|POST|PUT|PATCH|DELETE) \/v1\//;

async function withClient<T>(
  bearer: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const transport = new StreamableHTTPClientTransport(
    new URL("http://127.0.0.1/mcp"),
    {
      requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
      fetch: async (input, init) =>
        handleFetch(new Request(input, init), {}, { mode: "worker" }),
    },
  );
  const client = new Client({
    name: "kingminos-mcp-directory-hygiene",
    version: "0.0.0",
  });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

describe("Wave A directory hygiene", () => {
  it("gives every tenant tool a title and complete annotations", () => {
    assert.equal(Object.keys(TOOL_SPECS).length, LIVE_RESOURCE_ROUTES.length);
    for (const route of LIVE_RESOURCE_ROUTES) {
      const spec = TOOL_SPECS[route.tool];
      assert.equal(spec.title, EXPECTED_TITLES[route.tool], route.tool);
      assert.equal(typeof spec.annotations.readOnlyHint, "boolean", route.tool);
      assert.equal(
        typeof spec.annotations.destructiveHint,
        "boolean",
        route.tool,
      );
      assert.equal(
        typeof spec.annotations.openWorldHint,
        "boolean",
        route.tool,
      );
      assert.doesNotMatch(spec.description, HTTP_PREFIX);
      assert.doesNotMatch(spec.description, STEERING);
    }
  });

  it("does not advertise recipe vendor lists or steering in tools/list or instructions", async () => {
    await withClient("km_tenant", async (client) => {
      const listed = await client.listTools();
      assert.equal(listed.tools.length, LIVE_RESOURCE_ROUTES.length);
      for (const tool of listed.tools) {
        const name = tool.name as ToolName;
        assert.equal(typeof tool.title, "string", name);
        assert.equal(tool.title, EXPECTED_TITLES[name], name);
        assert.doesNotMatch(tool.description ?? "", HTTP_PREFIX);
        assert.doesNotMatch(tool.description ?? "", STEERING);
        assert.doesNotMatch(tool.description ?? "", RECIPE_VENDORS);
        const hints = tool.annotations ?? {};
        assert.equal(typeof hints.readOnlyHint, "boolean", name);
        assert.equal(typeof hints.destructiveHint, "boolean", name);
        assert.equal(typeof hints.openWorldHint, "boolean", name);
      }
      const instructions = client.getInstructions() ?? "";
      assert.match(instructions, /data enrichment router/i);
      assert.doesNotMatch(instructions, STEERING);
      assert.doesNotMatch(instructions, RECIPE_VENDORS);
      assert.doesNotMatch(instructions, /Call get_capabilities/);
    });
  });

  it("gives every admin tool a title and complete annotations", async () => {
    const expected: Record<(typeof ADMIN_TOOL_NAMES)[number], string> = {
      abuse_report: "Abuse report",
      partner_report: "Partner report",
      partner_payout: "Partner payout",
      feedback_report: "Feedback report",
      partner_admin: "Partner admin",
    };
    await withClient("kmadm_hygiene", async (client) => {
      const listed = await client.listTools();
      assert.deepEqual(
        listed.tools.map((tool) => tool.name).sort(),
        [...ADMIN_TOOL_NAMES].sort(),
      );
      for (const tool of listed.tools) {
        const name = tool.name as (typeof ADMIN_TOOL_NAMES)[number];
        assert.equal(tool.title, expected[name], name);
        const hints = tool.annotations ?? {};
        assert.equal(typeof hints.readOnlyHint, "boolean", name);
        assert.equal(typeof hints.destructiveHint, "boolean", name);
        assert.equal(typeof hints.openWorldHint, "boolean", name);
        assert.doesNotMatch(tool.description ?? "", HTTP_PREFIX);
      }
    });
  });

  it("keeps server.json version in lockstep with VERSION", () => {
    const manifest = JSON.parse(readFileSync("server.json", "utf8")) as {
      version?: string;
      remotes?: Array<{
        headers?: Array<{
          name?: string;
          isRequired?: boolean;
          isSecret?: boolean;
        }>;
      }>;
      icons?: unknown[];
    };
    assert.equal(manifest.version, VERSION);
    const auth = manifest.remotes?.[0]?.headers?.find(
      (header) => header.name === "Authorization",
    );
    assert.equal(auth?.isRequired, true);
    assert.equal(auth?.isSecret, true);
    assert.ok((manifest.icons?.length ?? 0) >= 1);
  });
});
