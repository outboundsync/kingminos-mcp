import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ADMIN_TOOL_NAMES } from "./admin-tools.js";
import { TOOL_NAMES, type ToolName } from "./catalog.js";
import { handleFetch } from "./fetch.js";
import {
  INVENTORY_PATH_ENV,
  inventoryFromOpenApiDocument,
  OPENAPI_JSON_URL_ENV,
  readInventoryFile,
  refreshInventoryFile,
  resolveExpectedInventory,
  serializeInventoryFile,
} from "./openapi-inventory.js";
import { CAPABILITY_PRICING } from "./pricing.generated.js";
import {
  type CapabilityPricing,
  compactPricing,
  creditNumbersIn,
  type PricingMap,
  priceLine,
  renderPricingModule,
} from "./pricing.js";
import { CAPABILITY_TOOL_NAMES } from "./server.js";

/** The vendored inventory CI pins (KINGMINOS_OPENAPI_INVENTORY in CI). */
async function inventoryPricing(): Promise<PricingMap> {
  const { inventory, source } = await resolveExpectedInventory();
  assert.ok(
    inventory.pricing && Object.keys(inventory.pricing).length > 0,
    `${source} has no pricing; run npm run inventory:refresh`,
  );
  return inventory.pricing;
}

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
  const client = new Client({ name: "kingminos-mcp-pricing", version: "0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

/** Every `description` string anywhere in a JSON Schema. */
function schemaDescriptions(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) schemaDescriptions(item, out);
  } else if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === "description" && typeof value === "string") out.push(value);
      else schemaDescriptions(value, out);
    }
  }
  return out;
}

const B2B_SOCIAL: CapabilityPricing = {
  id: "company.b2b_social",
  byokBasis: "per_answer",
  paths: [
    { name: "speed", cap: 1, delivered: 1, byok: 0.1, miss: 0 },
    { name: "balance", cap: 2, delivered: 1.2, byok: 0.1, miss: 0 },
    { name: "accuracy", cap: 3, delivered: 1.4, byok: 0.1, miss: 0 },
    { name: "coverage", cap: 4, delivered: 1.4, byok: 0.1, miss: 0 },
  ],
  optInHops: [{ provider: "wiza", price: 15 }],
};

describe("tool prices come only from the API (inventory pricing)", () => {
  it("src/pricing.generated.ts matches the inventory's pricing", async () => {
    assert.deepEqual(
      CAPABILITY_PRICING,
      await inventoryPricing(),
      "src/pricing.generated.ts drifted from inventory/openapi-surfaces.json pricing; run npm run pricing:generate (never edit either by hand)",
    );
  });

  it("prices exactly the capability tools", async () => {
    const pricing = await inventoryPricing();
    for (const tool of Object.keys(pricing)) {
      assert.ok(
        (TOOL_NAMES as readonly string[]).includes(tool),
        `inventory prices ${tool}, which is not an MCP tool`,
      );
    }
    assert.ok(CAPABILITY_TOOL_NAMES.length > 0);
    assert.deepEqual(
      [...CAPABILITY_TOOL_NAMES].sort(),
      Object.keys(pricing).sort(),
      "every capability tool needs x-kingminos-pricing in the spec, and every priced operation must be a capability tool",
    );
  });

  it("every capability tool shows its price line once; other tools show none", async () => {
    const pricing = await inventoryPricing();
    await withClient("km_pricing", async (client) => {
      const { tools } = await client.listTools();
      assert.equal(tools.length, TOOL_NAMES.length);
      for (const tool of tools) {
        const description = tool.description ?? "";
        const entry = pricing[tool.name];
        if (entry === undefined) {
          assert.doesNotMatch(description, /Credits:/, tool.name);
          continue;
        }
        const line = priceLine(entry);
        assert.equal(
          description.split(line).length - 1,
          1,
          `${tool.name} must show its price line once: ${line}`,
        );
        assert.equal(description.split("Credits:").length - 1, 1, tool.name);
      }
    });
  });

  it("no tool description or input schema states a credit number the inventory did not produce", async () => {
    const pricing = await inventoryPricing();
    const offenders: string[] = [];
    const scan = (where: string, text: string) => {
      for (const hit of creditNumbersIn(text)) {
        offenders.push(`${where}: "${hit}"`);
      }
    };
    await withClient("km_pricing", async (client) => {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        const entry = pricing[tool.name as ToolName];
        const description = tool.description ?? "";
        scan(
          `${tool.name} description`,
          entry ? description.replace(priceLine(entry), "") : description,
        );
        for (const text of schemaDescriptions(tool.inputSchema)) {
          scan(`${tool.name} inputSchema`, text);
        }
      }
      scan("tenant instructions", client.getInstructions() ?? "");
    });
    await withClient("kmadm_pricing", async (client) => {
      const { tools } = await client.listTools();
      assert.equal(tools.length, ADMIN_TOOL_NAMES.length);
      for (const tool of tools) {
        scan(`${tool.name} description`, tool.description ?? "");
        for (const text of schemaDescriptions(tool.inputSchema)) {
          scan(`${tool.name} inputSchema`, text);
        }
      }
    });
    assert.deepEqual(
      offenders,
      [],
      "Prices in tool copy come only from the price line (inventory pricing). Describe what bills in words; never type a credit amount.",
    );
  });

  it("the README tool table states no credit numbers", () => {
    const rows = readFileSync("README.md", "utf8")
      .split("\n")
      .filter((line) => line.startsWith("| `"));
    assert.ok(rows.length >= TOOL_NAMES.length, "README.md has the tool table");
    const offenders = rows.flatMap((row) =>
      creditNumbersIn(row).map((hit) => `${row.slice(0, 30)}…: "${hit}"`),
    );
    assert.deepEqual(offenders, []);
  });
});

describe("priceLine", () => {
  it("renders one delivered price per path, BYOK, the free miss and opt-in hops", () => {
    assert.equal(
      priceLine(B2B_SOCIAL),
      "Credits: speed 1 · balance 1.2 · accuracy 1.4 · coverage 1.4 (BYOK 0.1; a miss is free; opt-in wiza hop 15 instead of the path price when it decides).",
    );
  });

  it("renders a varying price as min–max and a per-hop BYOK fee", () => {
    assert.equal(
      priceLine({
        id: "company.resolve",
        byokBasis: "per_billing_hop",
        paths: [
          {
            name: "speed",
            cap: 2,
            delivered: { min: 0, max: 2 },
            byok: 0.1,
            miss: 0,
          },
          {
            name: "balance",
            cap: 19,
            delivered: { min: 0, max: 19 },
            byok: 0.1,
            miss: 0,
          },
        ],
        optInHops: [],
      }),
      "Credits: speed 0–2 · balance 0–19 (BYOK 0.1 per billed hop; a miss is free).",
    );
  });

  it("names per-path values when BYOK or the miss price differ by path", () => {
    assert.equal(
      priceLine({
        id: "x.y",
        byokBasis: "per_answer",
        paths: [
          { name: "speed", cap: 1, delivered: 1, byok: 0.1, miss: 0 },
          { name: "balance", cap: 2, delivered: 2, byok: 0.2, miss: 0.5 },
        ],
        optInHops: [],
      }),
      "Credits: speed 1 · balance 2 (BYOK speed 0.1 · balance 0.2; a miss is speed 0 · balance 0.5).",
    );
  });
});

describe("compactPricing (x-kingminos-pricing → inventory)", () => {
  it("keeps one number when the code fixes the price and min–max otherwise", () => {
    const compact = compactPricing(
      {
        id: "person.language",
        byok_basis: "per_billing_hop",
        default_path: "balance",
        max_credits_ceiling: 4,
        notes: ["coverage is not a path (400 invalid_routing)."],
        opt_in_hops: [],
        paths: [
          {
            name: "speed",
            cap: 1,
            delivered: { min: 1, max: 1, typical: 1 },
            byok: 0.1,
            miss: 0,
          },
          {
            name: "balance",
            cap: 3,
            delivered: { min: 1, max: 3, typical: null },
            byok: 0.1,
            miss: 0,
          },
        ],
      },
      "spec",
    );
    assert.deepEqual(compact, {
      id: "person.language",
      byokBasis: "per_billing_hop",
      paths: [
        { name: "speed", cap: 1, delivered: 1, byok: 0.1, miss: 0 },
        {
          name: "balance",
          cap: 3,
          delivered: { min: 1, max: 3 },
          byok: 0.1,
          miss: 0,
        },
      ],
      optInHops: [],
    });
    // Idempotent on the compact (inventory) form.
    assert.deepEqual(compactPricing(compact, "inventory"), compact);
  });

  it("rejects a malformed block instead of dropping prices", () => {
    assert.throws(
      () =>
        compactPricing(
          { id: "a.b", byok_basis: "per_answer", paths: [] },
          "spec",
        ),
      /paths/,
    );
    assert.throws(
      () =>
        compactPricing(
          {
            id: "a.b",
            byok_basis: "per_answer",
            paths: [
              { name: "speed", cap: 1, delivered: "2", byok: 0.1, miss: 0 },
            ],
          },
          "spec",
        ),
      /delivered/,
    );
    assert.throws(
      () =>
        compactPricing({ id: "a.b", byok_basis: "flat", paths: [{}] }, "spec"),
      /byok_basis/,
    );
  });

  it("inventoryFromOpenApiDocument keys each priced operation by tool name", () => {
    const doc = {
      openapi: "3.0.3",
      components: {
        securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
      },
      paths: {
        "/v1/company/b2b-social": {
          post: {
            operationId: "companyB2bSocial",
            security: [{ bearer: [] }],
            "x-kingminos-pricing": {
              id: "company.b2b_social",
              byok_basis: "per_answer",
              opt_in_hops: [
                { provider: "wiza", price: 15, note: "off by default" },
              ],
              paths: B2B_SOCIAL.paths,
            },
          },
        },
        "/v1/runs/{id}": {
          get: { operationId: "getRun", security: [{ bearer: [] }] },
        },
      },
    };
    const parsed = inventoryFromOpenApiDocument(doc);
    assert.ok(!("reason" in parsed));
    assert.deepEqual(parsed.pricing, { company_b2b_social: B2B_SOCIAL });
  });
});

describe("creditNumbersIn", () => {
  it("catches the hand-typed price phrases this repo used to carry", () => {
    for (const text of [
      "speed (1 credit on a hit) | balance (default, 2) | accuracy (3) | coverage (5).",
      "Outcome-priced speed 1 / balance 1.3 / accuracy 1.6 / coverage 1.7 credits on a floor-passing hit",
      "BYOK on a delivered hit is 0.1.",
      "One implementation ladder (0–2 paid credits).",
      "capped at 38 credits; 0 on a miss",
      "Cost: 38 credits on a hit, 0 on a miss (ceiling 38).",
      "accuracy / coverage add handle confirmation (caps 3 / 4).",
      "omit runs balance at cap 6",
      "Cost is outcome-priced at 1.5–5 credits depending on the path",
      "1 / 2 / 3 / 5 credits on a hit",
      "speed 0–19 on a hit",
    ]) {
      assert.notDeepEqual(creditNumbersIn(text), [], text);
    }
  });

  it("allows free outcomes and numbers that are not credits", () => {
    for (const text of [
      "role_address, 0 credits",
      "the call is a 0-credit max_credits_reached noop",
      "late vendors are dropped (bill 0)",
      "max_chars 80–500 (default 300); identity < 0.85; under ~8.5 s; 30-day cache; 256×256 PNG",
      "max_results caps result.phones (1–10, default 3)",
      "est_credits_per_row",
    ]) {
      assert.deepEqual(creditNumbersIn(text), [], text);
    }
  });
});

describe("inventory:refresh carries pricing from the spec", () => {
  it("replaces pinned prices with the spec's and writes src/pricing.generated.ts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kingminos-mcp-pricing-"));
    const file = join(dir, "inventory.json");
    const pinned = readInventoryFile(
      join(process.cwd(), "inventory", "openapi-surfaces.json"),
    );
    // A stale pinned price for a capability the spec no longer prices.
    writeFileSync(
      file,
      serializeInventoryFile({
        ...pinned,
        pricing: { stale_tool: { ...B2B_SOCIAL, id: "stale.tool" } },
      }),
    );
    const paths: Record<string, Record<string, unknown>> = {};
    for (const op of pinned.operations) {
      const item = paths[op.path] ?? {};
      paths[op.path] = item;
      item[op.method.toLowerCase()] = {
        operationId: op.operationId,
        security: [{ bearer: [] }],
        ...(op.operationId === "company_b2b_social"
          ? {
              "x-kingminos-pricing": {
                id: "company.b2b_social",
                byok_basis: "per_answer",
                opt_in_hops: [{ provider: "wiza", price: 15 }],
                paths: B2B_SOCIAL.paths,
              },
            }
          : {}),
      };
    }
    const specFile = join(dir, "openapi.live.json");
    writeFileSync(
      specFile,
      JSON.stringify({
        openapi: "3.0.3",
        components: {
          schemas: { ProviderName: { type: "string", enum: pinned.providers } },
        },
        paths,
      }),
    );
    const prev = {
      url: process.env[OPENAPI_JSON_URL_ENV],
      path: process.env[INVENTORY_PATH_ENV],
    };
    process.env[OPENAPI_JSON_URL_ENV] = pathToFileURL(specFile).href;
    process.env[INVENTORY_PATH_ENV] = file;
    try {
      await refreshInventoryFile(dir);
      const written = readInventoryFile(file);
      assert.deepEqual(written.pricing, { company_b2b_social: B2B_SOCIAL });
      const modulePath = join(dir, "src", "pricing.generated.ts");
      assert.ok(existsSync(modulePath));
      assert.equal(
        readFileSync(modulePath, "utf8"),
        renderPricingModule(written.pricing),
      );
    } finally {
      if (prev.url === undefined) delete process.env[OPENAPI_JSON_URL_ENV];
      else process.env[OPENAPI_JSON_URL_ENV] = prev.url;
      if (prev.path === undefined) delete process.env[INVENTORY_PATH_ENV];
      else process.env[INVENTORY_PATH_ENV] = prev.path;
    }
  });
});
