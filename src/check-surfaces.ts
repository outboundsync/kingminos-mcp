import { pathToFileURL } from "node:url";
import { TOOL_NAMES, advertisedOperations } from "./catalog.js";
import {
  OPENAPI_LIVE_ENV,
  type ResolvedInventory,
  type SurfaceDiff,
  diffSurfaces,
  formatSurfaceDiff,
  refreshInventoryFile,
  resolveExpectedInventory,
  resolveLiveInventory,
  surfacesAligned,
  toolNameFromOperationId,
} from "./openapi-inventory.js";

export interface SurfaceCheckResult {
  ok: boolean;
  source: string;
  advertised: string[];
  expected: string[];
  diff: SurfaceDiff;
}

export async function checkSurfaces(
  options: { live?: boolean } = {},
): Promise<SurfaceCheckResult> {
  const resolved: ResolvedInventory = options.live
    ? await resolveLiveInventory()
    : await resolveExpectedInventory();
  const advertised = advertisedOperations();
  const expected = resolved.inventory.operations.map((op) => ({
    ...op,
    operationId: toolNameFromOperationId(op.operationId),
  }));
  const diff = diffSurfaces(advertised, expected);
  return {
    ok: surfacesAligned(diff) && advertised.length === TOOL_NAMES.length,
    source: resolved.source,
    advertised: advertised.map((op) => op.operationId).sort(),
    expected: expected.map((op) => op.operationId).sort(),
    diff,
  };
}

export function formatCheckResult(result: SurfaceCheckResult): string {
  if (!result.ok) {
    return formatSurfaceDiff(result.diff, result.source);
  }
  return [
    "KingMinos MCP surfaces aligned with the OpenAPI inventory.",
    `source: ${result.source}`,
    `tools (${result.advertised.length}): ${result.advertised.join(", ")}`,
    "",
  ].join("\n");
}

function wantsLive(argv: string[] = process.argv): boolean {
  return argv.includes("--live") || process.env[OPENAPI_LIVE_ENV] === "1";
}

async function main(): Promise<void> {
  if (process.argv.includes("--refresh")) {
    const refreshed = await refreshInventoryFile();
    process.stdout.write(
      [
        "Wrote pinned OpenAPI inventory from live spec.",
        `source: ${refreshed.source}`,
        `path: ${refreshed.path}`,
        `tools (${refreshed.inventory.operations.length}): ${refreshed.inventory.operations.map((op) => op.operationId).join(", ")}`,
        `providers: ${refreshed.inventory.providers.join(", ")}`,
        `credentialProviders: ${refreshed.inventory.credentialProviders.join(", ")}`,
        "Account/auth operationIds stay on the deny-list; they are not MCP tools.",
        "Review the diff, then run npm run check:surfaces && npm run check:providers.",
        "",
      ].join("\n"),
    );
    return;
  }
  const result = await checkSurfaces({ live: wantsLive() });
  if (!result.ok) {
    process.stderr.write(`${formatCheckResult(result)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(formatCheckResult(result));
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
