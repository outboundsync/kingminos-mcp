import { pathToFileURL } from "node:url";
import {
  OPENAPI_LIVE_ENV,
  type ProviderCheckMode,
  type ProviderDiff,
  type ProviderLists,
  diffProviders,
  fetchLiveOpenApiDocument,
  formatProviderDiff,
  providersAligned,
  providersFromOpenApiDocument,
  resolveExpectedInventory,
} from "./openapi-inventory.js";
import { CREDENTIAL_PROVIDER_VALUES, PROVIDER_NAME_VALUES } from "./schemas.js";

export interface ProviderCheckResult {
  ok: boolean;
  source: string;
  mode: ProviderCheckMode;
  advertised: ProviderLists;
  expected: ProviderLists;
  diff: ProviderDiff;
}

export function advertisedProviders(): ProviderLists {
  return {
    providers: [...PROVIDER_NAME_VALUES],
    credentialProviders: [...CREDENTIAL_PROVIDER_VALUES],
  };
}

function pinnedProvidersMissing(expected: ProviderLists): string | undefined {
  if (expected.providers.length === 0) {
    return "inventory is missing providers[]";
  }
  if (expected.credentialProviders.length === 0) {
    return "inventory is missing credentialProviders[]";
  }
  return undefined;
}

export async function checkProviders(
  options: { live?: boolean } = {},
): Promise<ProviderCheckResult> {
  const advertised = advertisedProviders();
  const mode: ProviderCheckMode = options.live ? "live" : "pinned";
  switch (mode) {
    case "live": {
      const live = await fetchLiveOpenApiDocument();
      const expected = providersFromOpenApiDocument(live.document);
      if (
        expected.providers.length === 0 ||
        expected.credentialProviders.length === 0
      ) {
        return {
          ok: false,
          source: live.source,
          mode,
          advertised,
          expected,
          diff: {
            missingProviderNames:
              expected.providers.length === 0
                ? ["<live OpenAPI missing ProviderName enum>"]
                : [],
            extraProviderNames: [],
            missingCredentialProviders:
              expected.credentialProviders.length === 0
                ? ["<live OpenAPI missing credential provider enum>"]
                : [],
            extraCredentialProviders: [],
          },
        };
      }
      const diff = diffProviders(advertised, expected, {
        ignoreExtraAdvertised: true,
      });
      return {
        ok: providersAligned(diff),
        source: live.source,
        mode,
        advertised,
        expected,
        diff,
      };
    }
    case "pinned": {
      const resolved = await resolveExpectedInventory();
      const expected: ProviderLists = {
        providers: resolved.inventory.providers,
        credentialProviders: resolved.inventory.credentialProviders,
      };
      const pinError = pinnedProvidersMissing(expected);
      if (pinError) {
        return {
          ok: false,
          source: `${resolved.source} (${pinError})`,
          mode,
          advertised,
          expected,
          diff: {
            missingProviderNames:
              expected.providers.length === 0
                ? ["<inventory missing providers[]>"]
                : [],
            extraProviderNames: [],
            missingCredentialProviders:
              expected.credentialProviders.length === 0
                ? ["<inventory missing credentialProviders[]>"]
                : [],
            extraCredentialProviders: [],
          },
        };
      }
      const diff = diffProviders(advertised, expected);
      return {
        ok: providersAligned(diff),
        source: resolved.source,
        mode,
        advertised,
        expected,
        diff,
      };
    }
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unhandled provider check mode: ${_exhaustive}`);
    }
  }
}

export function formatProviderCheckResult(result: ProviderCheckResult): string {
  if (!result.ok) {
    return formatProviderDiff(result.diff, result.source);
  }
  return [
    "KingMinos MCP provider enums aligned with the OpenAPI inventory.",
    `source: ${result.source}`,
    `mode: ${result.mode}`,
    `ProviderName (${result.advertised.providers.length}): ${result.advertised.providers.join(", ")}`,
    `CredentialProvider (${result.advertised.credentialProviders.length}): ${result.advertised.credentialProviders.join(", ")}`,
    "",
  ].join("\n");
}

function wantsLive(argv: string[] = process.argv): boolean {
  return argv.includes("--live") || process.env[OPENAPI_LIVE_ENV] === "1";
}

async function main(): Promise<void> {
  const result = await checkProviders({ live: wantsLive() });
  if (!result.ok) {
    process.stderr.write(`${formatProviderCheckResult(result)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(formatProviderCheckResult(result));
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
