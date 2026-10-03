import { pathToFileURL } from "node:url";
import { advertisedOperations, TOOL_NAMES } from "./catalog.js";
import {
  diffSurfaces,
  formatSurfaceDiff,
  resolveExpectedInventory,
  surfacesAligned,
  toolNameFromOperationId,
  type ResolvedInventory,
  type SurfaceDiff,
} from "./openapi-inventory.js";

export interface SurfaceCheckResult {
  ok: boolean;
  source: string;
  advertised: string[];
  expected: string[];
  diff: SurfaceDiff;
}

export async function checkSurfaces(): Promise<SurfaceCheckResult> {
  const resolved: ResolvedInventory = await resolveExpectedInventory();
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

async function main(): Promise<void> {
  const result = await checkSurfaces();
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
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
