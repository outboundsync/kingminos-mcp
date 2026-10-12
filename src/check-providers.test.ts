import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { advertisedProviders } from "./check-providers.js";
import {
  CREDENTIAL_ONLY_PROVIDERS,
  diffProviders,
  INVENTORY_PATH_ENV,
  OPENAPI_JSON_URL_ENV,
  parseInventoryDocument,
  providersAligned,
  providersFromOpenApiDocument,
  readInventoryFile,
  refreshInventoryFile,
  serializeInventoryFile,
} from "./openapi-inventory.js";
import { CREDENTIAL_PROVIDER_VALUES, PROVIDER_NAME_VALUES } from "./schemas.js";

describe("advertisedProviders", () => {
  it("exposes the Zod ProviderName and CredentialProvider enums", () => {
    assert.deepEqual(advertisedProviders(), {
      providers: [...PROVIDER_NAME_VALUES],
      credentialProviders: [...CREDENTIAL_PROVIDER_VALUES],
    });
    assert.ok(advertisedProviders().providers.includes("prospeo"));
    assert.ok(advertisedProviders().credentialProviders.includes("prospeo"));
  });
});

describe("provider enum contract", () => {
  const fileInventory = readInventoryFile("inventory/openapi-surfaces.json");

  it("pins providers that include prospeo even if production OpenAPI lags", () => {
    assert.deepEqual(fileInventory.providers, [...PROVIDER_NAME_VALUES]);
    assert.deepEqual(fileInventory.credentialProviders, [
      ...CREDENTIAL_PROVIDER_VALUES,
    ]);
    assert.ok(fileInventory.providers.includes("prospeo"));
    assert.ok(fileInventory.credentialProviders.includes("prospeo"));
  });

  it("pins lemlist on providers and credentialProviders with favicon neighbor intact", () => {
    assert.ok(fileInventory.providers.includes("lemlist"));
    assert.ok(fileInventory.credentialProviders.includes("lemlist"));
    assert.ok(fileInventory.providers.includes("favicon"));
    assert.ok(fileInventory.providers.includes("brandfetch"));
  });

  it("pins snovio on credentialProviders only (credentials-only BYOK)", () => {
    assert.ok(fileInventory.credentialProviders.includes("snovio"));
    assert.equal(fileInventory.providers.includes("snovio"), false);
  });

  it("pins the eight credential-only vendors on credentialProviders only", () => {
    // Cognism / Lusha / Starbridge / Clay / Databar (Harris 2026-10-10) and
    // QuickEnrich / GetLeads / BlitzAPI (Harris 2026-10-12): store/verify via
    // put_credentials, no routing hop — never in providers[].
    for (const id of [
      "cognism",
      "lusha",
      "starbridge",
      "clay",
      "databar",
      "quickenrich",
      "getleads",
      "blitzapi",
    ]) {
      assert.ok(fileInventory.credentialProviders.includes(id));
      assert.equal(fileInventory.providers.includes(id), false);
    }
  });

  it("lists aiark on company.b2b_social capabilityProviders pin", () => {
    const b2b = fileInventory.capabilityProviders?.["company.b2b_social"];
    assert.ok(b2b?.includes("aiark"));
    assert.ok(b2b?.includes("leadmagic"));
  });

  it("lists brandfetch and house favicon hops on company.icon capabilityProviders pin", () => {
    const icon = fileInventory.capabilityProviders?.["company.icon"];
    assert.ok(icon?.includes("dns"));
    assert.ok(icon?.includes("site_probe"));
    assert.ok(icon?.includes("brandfetch"));
    assert.ok(icon?.includes("zoominfo"));
  });

  it("pins AI Ark + websearch hops on company.description (PR #177; no LeadMagic/Wiza/Findymail/Brandfetch)", () => {
    const description =
      fileInventory.capabilityProviders?.["company.description"];
    for (const name of [
      "dns",
      "site_probe",
      "aiark",
      "websearch",
      "zoominfo",
    ]) {
      assert.ok(description?.includes(name), name);
    }
    for (const excluded of ["leadmagic", "wiza", "findymail", "brandfetch"]) {
      assert.equal(description?.includes(excluded), false, excluded);
    }
  });

  it("fails when inventory lists prospeo but MCP Zod enums do not", () => {
    const advertised = {
      providers: PROVIDER_NAME_VALUES.filter((name) => name !== "prospeo"),
      credentialProviders: CREDENTIAL_PROVIDER_VALUES.filter(
        (name) => name !== "prospeo",
      ),
    };
    const diff = diffProviders(advertised, {
      providers: fileInventory.providers,
      credentialProviders: fileInventory.credentialProviders,
    });
    assert.equal(providersAligned(diff), false);
    assert.deepEqual(diff.missingProviderNames, ["prospeo"]);
    assert.deepEqual(diff.missingCredentialProviders, ["prospeo"]);
    assert.match(JSON.stringify(diff.missingProviderNames), /prospeo/);
  });

  it("does not fail live-style when production lags the pin", () => {
    const live = {
      providers: PROVIDER_NAME_VALUES.filter((name) => name !== "prospeo"),
      credentialProviders: CREDENTIAL_PROVIDER_VALUES.filter(
        (name) => name !== "prospeo",
      ),
    };
    const diff = diffProviders(advertisedProviders(), live, {
      ignoreExtraAdvertised: true,
    });
    assert.equal(providersAligned(diff), true);
  });

  it("fails live-style when the served spec adds a provider Zod lacks", () => {
    const live = {
      providers: [...PROVIDER_NAME_VALUES, "brand_new_vendor"],
      credentialProviders: [...CREDENTIAL_PROVIDER_VALUES, "brand_new_vendor"],
    };
    const diff = diffProviders(advertisedProviders(), live, {
      ignoreExtraAdvertised: true,
    });
    assert.equal(providersAligned(diff), false);
    assert.deepEqual(diff.missingProviderNames, ["brand_new_vendor"]);
    assert.deepEqual(diff.missingCredentialProviders, ["brand_new_vendor"]);
  });
});

describe("providersFromOpenApiDocument", () => {
  it("reads ProviderName and credential path enums", () => {
    const extracted = providersFromOpenApiDocument({
      components: {
        schemas: {
          ProviderName: {
            type: "string",
            enum: ["zoominfo", "leadmagic", "prospeo"],
          },
          CredentialStoreResponse: {
            properties: {
              provider: {
                type: "string",
                enum: ["zoominfo", "leadmagic"],
              },
            },
          },
        },
      },
      paths: {
        "/v1/credentials/{provider}": {
          parameters: [
            {
              name: "provider",
              schema: {
                type: "string",
                enum: ["zoominfo", "leadmagic", "prospeo"],
              },
            },
          ],
        },
      },
    });
    assert.deepEqual(extracted.providers, ["zoominfo", "leadmagic", "prospeo"]);
    assert.deepEqual(extracted.credentialProviders, [
      "zoominfo",
      "leadmagic",
      "prospeo",
    ]);
  });
});

describe("credential-only vendors", () => {
  it("never lands credential-only vendors in providers[]", () => {
    const extracted = providersFromOpenApiDocument({
      components: {
        schemas: {
          ProviderName: {
            type: "string",
            enum: ["leadmagic", ...CREDENTIAL_ONLY_PROVIDERS, "lemlist"],
          },
        },
      },
      paths: {},
    });
    assert.deepEqual(extracted.providers, ["leadmagic", "lemlist"]);
  });

  it("inventory:refresh skips credential-only vendors and preserves capabilityProviders", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kingminos-mcp-refresh-"));
    const file = join(dir, "inventory.json");
    const pinned = readInventoryFile(
      join(process.cwd(), "inventory", "openapi-surfaces.json"),
    );
    writeFileSync(
      file,
      serializeInventoryFile({
        ...pinned,
        providers: [...pinned.providers, "clay"],
      }),
    );
    const doc = {
      openapi: "3.0.3",
      components: {
        securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
        schemas: {
          ProviderName: {
            type: "string",
            enum: [...pinned.providers, ...CREDENTIAL_ONLY_PROVIDERS],
          },
        },
      },
      paths: Object.fromEntries(
        pinned.operations.map((op) => [
          op.path,
          {
            [op.method.toLowerCase()]: {
              operationId: op.operationId,
              security: [{ bearer: [] }],
            },
          },
        ]),
      ),
    };
    const server = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(doc));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    const prev = {
      url: process.env[OPENAPI_JSON_URL_ENV],
      path: process.env[INVENTORY_PATH_ENV],
    };
    process.env[OPENAPI_JSON_URL_ENV] = `http://127.0.0.1:${port}/openapi.json`;
    process.env[INVENTORY_PATH_ENV] = file;
    try {
      const { inventory } = await refreshInventoryFile(dir);
      for (const vendor of CREDENTIAL_ONLY_PROVIDERS) {
        assert.equal(inventory.providers.includes(vendor), false, vendor);
      }
      const written = readInventoryFile(file);
      assert.deepEqual(written.providers, pinned.providers);
      assert.deepEqual(written.capabilityProviders, pinned.capabilityProviders);
      assert.ok(written.capabilityProviders?.["company.description"]);
    } finally {
      server.close();
      if (prev.url === undefined) delete process.env[OPENAPI_JSON_URL_ENV];
      else process.env[OPENAPI_JSON_URL_ENV] = prev.url;
      if (prev.path === undefined) delete process.env[INVENTORY_PATH_ENV];
      else process.env[INVENTORY_PATH_ENV] = prev.path;
    }
  });
});

describe("check:providers CLI", () => {
  it("exits non-zero when the pin lists a provider Zod does not have", () => {
    const dir = mkdtempSync(join(tmpdir(), "kingminos-mcp-providers-"));
    const inventoryPath = join(dir, "openapi-surfaces.json");
    const fileInventory = readInventoryFile("inventory/openapi-surfaces.json");
    writeFileSync(
      inventoryPath,
      JSON.stringify({
        publicNonToolPaths: fileInventory.publicNonToolPaths,
        nonToolPathPrefixes: fileInventory.nonToolPathPrefixes,
        excludedOperationIds: fileInventory.excludedOperationIds,
        providers: [...fileInventory.providers, "brand_new_vendor"],
        credentialProviders: [
          ...fileInventory.credentialProviders,
          "brand_new_vendor",
        ],
        operations: fileInventory.operations,
      }),
    );

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/check-providers.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          KINGMINOS_OPENAPI_INVENTORY: inventoryPath,
        },
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /missing ProviderName values: brand_new_vendor/,
    );
    assert.match(
      result.stderr,
      /missing CredentialProvider values: brand_new_vendor/,
    );
  });

  it("exits non-zero when the inventory omits the provider pin", () => {
    const dir = mkdtempSync(join(tmpdir(), "kingminos-mcp-providers-empty-"));
    const inventoryPath = join(dir, "openapi-surfaces.json");
    const fileInventory = readInventoryFile("inventory/openapi-surfaces.json");
    writeFileSync(
      inventoryPath,
      JSON.stringify({
        operations: fileInventory.operations,
      }),
    );
    parseInventoryDocument(
      { operations: fileInventory.operations },
      inventoryPath,
    );

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/check-providers.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          KINGMINOS_OPENAPI_INVENTORY: inventoryPath,
        },
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing providers\[\]/);
  });
});
