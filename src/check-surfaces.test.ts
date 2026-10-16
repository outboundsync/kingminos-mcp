import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  advertisedOperations,
  LIVE_RESOURCE_ROUTES,
  TOOL_NAMES,
} from "./catalog.js";
import {
  diffSurfaces,
  inventoryFromOpenApiDocument,
  mergeOperations,
  parseInventoryDocument,
  readInventoryFile,
  surfacesAligned,
  toolNameFromOperationId,
} from "./openapi-inventory.js";

const EXPECTED_TOOLS = [
  "get_providers",
  "get_capabilities",
  "company_resolve",
  "company_domain",
  "company_hierarchy",
  "company_b2b_social",
  "company_icon",
  "company_description",
  "person_verify_employment",
  "person_language",
  "person_phone",
  "person_title",
  "get_run",
  "list_credentials",
  "put_credentials",
  "delete_credentials",
  "delete_subject",
  "list_webhooks",
  "create_webhook",
  "get_webhook",
  "patch_webhook",
  "delete_webhook",
  "rotate_webhook_secret",
  "test_webhook",
  "list_webhook_deliveries",
  "replay_webhook_delivery",
  "list_events",
  "submit_feedback",
] as const;

const BEARER = [{ bearer: [] }];

describe("toolNameFromOperationId", () => {
  it("keeps already-snake_case operationIds", () => {
    assert.equal(toolNameFromOperationId("company_resolve"), "company_resolve");
    assert.equal(
      toolNameFromOperationId("person_verify_employment"),
      "person_verify_employment",
    );
    assert.equal(
      toolNameFromOperationId("listCredentials"),
      "list_credentials",
    );
  });

  it("converts camelCase and dotted capability names", () => {
    assert.equal(toolNameFromOperationId("companyResolve"), "company_resolve");
    assert.equal(toolNameFromOperationId("company.domain"), "company_domain");
    assert.equal(
      toolNameFromOperationId("person.verify_employment"),
      "person_verify_employment",
    );
  });
});

describe("OpenAPI inventory contract", () => {
  const fileInventory = readInventoryFile("inventory/openapi-surfaces.json");
  const advertised = advertisedOperations();

  it("advertises exactly the bearer resource operationIds", () => {
    assert.deepEqual([...TOOL_NAMES].sort(), [...EXPECTED_TOOLS].sort());
    assert.deepEqual(
      fileInventory.operations.map((op) => op.operationId).sort(),
      [...EXPECTED_TOOLS].sort(),
    );
    assert.deepEqual(
      advertised.map((op) => op.operationId).sort(),
      [...EXPECTED_TOOLS].sort(),
    );
  });

  it("keeps catalog routes aligned with the inventory file", () => {
    const diff = diffSurfaces(advertised, fileInventory.operations);
    assert.equal(surfacesAligned(diff), true, JSON.stringify(diff));
    assert.equal(LIVE_RESOURCE_ROUTES.length, EXPECTED_TOOLS.length);
  });

  it("records reviewed session/account exclusions", () => {
    assert.ok(fileInventory.nonToolPathPrefixes.includes("/v1/auth"));
    assert.ok(fileInventory.nonToolPathPrefixes.includes("/v1/account"));
    assert.ok(fileInventory.excludedOperationIds.includes("startLogin"));
    assert.ok(fileInventory.excludedOperationIds.includes("getAccount"));
    assert.ok(
      fileInventory.excludedOperationIds.includes("patchAccountWorkspace"),
    );
    assert.ok(
      fileInventory.excludedOperationIds.includes("deleteAccountMember"),
    );
    assert.ok(
      fileInventory.excludedOperationIds.includes("deleteAccountInvite"),
    );
    assert.ok(
      !fileInventory.operations.some((op) => op.path.startsWith("/v1/auth")),
    );
    assert.ok(
      !fileInventory.operations.some((op) => op.path.startsWith("/v1/account")),
    );
  });

  it("fails when a tool is missing from the advertised list", () => {
    const drifted = advertised.filter(
      (op) => op.operationId !== "delete_subject",
    );
    const diff = diffSurfaces(drifted, fileInventory.operations);
    assert.equal(surfacesAligned(diff), false);
    assert.deepEqual(diff.missingTools, ["delete_subject"]);
    assert.deepEqual(diff.missingRoutes, ["DELETE /v1/subjects/{}"]);
  });

  it("fails when an invented tool is advertised", () => {
    const drifted = [
      ...advertised,
      {
        operationId: "invented_tool",
        method: "GET" as const,
        path: "/v1/invented",
      },
    ];
    const diff = diffSurfaces(drifted, fileInventory.operations);
    assert.equal(surfacesAligned(diff), false);
    assert.deepEqual(diff.extraTools, ["invented_tool"]);
    assert.deepEqual(diff.extraRoutes, ["GET /v1/invented"]);
  });

  it("fails when a route path drifts from the inventory", () => {
    const drifted = advertised.map((op) =>
      op.operationId === "get_run" ? { ...op, path: "/v1/run/{id}" } : op,
    );
    const diff = diffSurfaces(drifted, fileInventory.operations);
    assert.equal(surfacesAligned(diff), false);
    assert.deepEqual(diff.missingRoutes, ["GET /v1/runs/{}"]);
    assert.deepEqual(diff.extraRoutes, ["GET /v1/run/{}"]);
  });

  it("rejects a mutated inventory file the same way CI would", () => {
    const dir = mkdtempSync(join(tmpdir(), "kingminos-mcp-inventory-"));
    const path = join(dir, "openapi-surfaces.json");
    const mutated = {
      publicNonToolPaths: fileInventory.publicNonToolPaths,
      operations: fileInventory.operations.filter(
        (op) => op.operationId !== "company_resolve",
      ),
    };
    writeFileSync(path, JSON.stringify(mutated));
    const loaded = readInventoryFile(path);
    const diff = diffSurfaces(advertised, loaded.operations);
    assert.equal(surfacesAligned(diff), false);
    assert.deepEqual(diff.extraTools, ["company_resolve"]);
  });
});

describe("inventoryFromOpenApiDocument", () => {
  it("extracts bearer tools from a served OpenAPI document", () => {
    const parsed = inventoryFromOpenApiDocument(
      {
        openapi: "3.1.0",
        paths: {
          "/health": { get: { summary: "Liveness" } },
          "/openapi.json": { get: { summary: "Spec" } },
          "/v1/providers": {
            get: { operationId: "get_providers", security: BEARER },
          },
          "/v1/company/resolve": {
            post: { operationId: "company_resolve", security: BEARER },
          },
        },
      },
      ["/health", "/openapi.json"],
    );
    assert.ok(!("reason" in parsed));
    if ("reason" in parsed) {
      return;
    }
    assert.deepEqual(
      parsed.operations.map((op) => op.operationId),
      ["get_providers", "company_resolve"],
    );
  });

  it("ignores operations whose effective security does not include bearer", () => {
    const parsed = inventoryFromOpenApiDocument({
      paths: {
        "/v1/auth/login": { post: { operationId: "startLogin" } },
        "/v1/account": { get: { operationId: "getAccount" } },
        "/v1/providers": {
          get: { operationId: "get_providers", security: BEARER },
        },
      },
    });
    assert.ok(!("reason" in parsed));
    if ("reason" in parsed) {
      return;
    }
    assert.deepEqual(
      parsed.operations.map((op) => op.operationId),
      ["get_providers"],
    );
  });

  it("still fails when a bearer operation is missing from the advertised catalog", () => {
    const parsed = inventoryFromOpenApiDocument({
      paths: {
        "/v1/providers": {
          get: { operationId: "get_providers", security: BEARER },
        },
        "/v1/credentials": {
          get: { operationId: "listCredentials", security: BEARER },
        },
      },
    });
    assert.ok(!("reason" in parsed));
    if ("reason" in parsed) {
      return;
    }
    const advertised = [
      {
        operationId: "get_providers",
        method: "GET" as const,
        path: "/v1/providers",
      },
    ];
    const diff = diffSurfaces(advertised, parsed.operations);
    assert.equal(surfacesAligned(diff), false);
    assert.deepEqual(diff.missingTools, ["list_credentials"]);
    assert.deepEqual(diff.missingRoutes, ["GET /v1/credentials"]);
  });

  it("does not invent tools when bearer operations lack operationId", () => {
    const parsed = inventoryFromOpenApiDocument({
      paths: {
        "/v1/providers": {
          get: { summary: "Provider registry", security: BEARER },
        },
      },
    });
    assert.deepEqual(parsed, {
      reason: "no bearer-authenticated resource operations",
    });
  });

  it("rejects a partial live spec instead of inventing the rest", () => {
    const parsed = inventoryFromOpenApiDocument({
      paths: {
        "/v1/providers": {
          get: { operationId: "get_providers", security: BEARER },
        },
        "/v1/capabilities": {
          get: { summary: "Capability catalog", security: BEARER },
        },
      },
    });
    assert.ok("reason" in parsed);
    if (!("reason" in parsed)) {
      return;
    }
    assert.match(parsed.reason, /GET \/v1\/capabilities/);
  });

  it("skips reviewed auth/account prefixes even if they later grow bearer security", () => {
    const parsed = inventoryFromOpenApiDocument(
      {
        paths: {
          "/v1/auth/login": {
            post: { operationId: "startLogin", security: BEARER },
          },
          "/v1/providers": {
            get: { operationId: "get_providers", security: BEARER },
          },
        },
      },
      { nonToolPathPrefixes: ["/v1/auth"] },
    );
    assert.ok(!("reason" in parsed));
    if ("reason" in parsed) {
      return;
    }
    assert.deepEqual(
      parsed.operations.map((op) => op.operationId),
      ["get_providers"],
    );
  });
});

describe("mergeOperations", () => {
  it("keeps existing order, updates live rows, and appends new routes", () => {
    const merged = mergeOperations(
      [
        {
          operationId: "get_providers",
          method: "GET",
          path: "/v1/providers",
        },
        {
          operationId: "company_resolve",
          method: "POST",
          path: "/v1/company/resolve",
        },
      ],
      [
        {
          operationId: "company_resolve",
          method: "POST",
          path: "/v1/company/resolve",
        },
        {
          operationId: "get_capabilities",
          method: "GET",
          path: "/v1/capabilities",
        },
      ],
    );
    assert.deepEqual(
      merged.map((op) => op.operationId),
      ["company_resolve", "get_capabilities"],
    );
  });
});

describe("parseInventoryDocument", () => {
  it("refuses operations without an operationId", () => {
    assert.throws(
      () =>
        parseInventoryDocument(
          {
            operations: [{ method: "GET", path: "/v1/providers" }],
          },
          "fixture",
        ),
      /missing operationId/,
    );
  });
});

describe("check:surfaces CLI", () => {
  it("exits non-zero when advertised tools drift from the inventory file", () => {
    const dir = mkdtempSync(join(tmpdir(), "kingminos-mcp-cli-"));
    const inventoryPath = join(dir, "openapi-surfaces.json");
    const fileInventory = readInventoryFile("inventory/openapi-surfaces.json");
    writeFileSync(
      inventoryPath,
      JSON.stringify({
        publicNonToolPaths: fileInventory.publicNonToolPaths,
        operations: fileInventory.operations.filter(
          (op) => op.operationId !== "get_run",
        ),
      }),
    );

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/check-surfaces.ts"],
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
    assert.match(result.stderr, /extra tools: get_run/);
  });
});
