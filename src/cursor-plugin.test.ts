import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { OAUTH_SCOPE_BASELINE } from "./oauth.js";

// Shape per https://cursor.com/docs/plugins/building and
// https://cursor.com/docs/mcp ("Static OAuth for remote servers").
const plugin = JSON.parse(
  readFileSync(".cursor-plugin/plugin.json", "utf8"),
) as Record<string, unknown>;
const mcp = JSON.parse(readFileSync(".cursor-plugin/mcp.json", "utf8")) as {
  mcpServers: Record<string, Record<string, unknown>>;
};

describe("Cursor plugin (.cursor-plugin)", () => {
  it("has a kebab-case name, router copy and a committed logo", () => {
    assert.equal(plugin.name, "kingminos");
    assert.match(String(plugin.description), /data enrichment router/);
    const logo = String(plugin.logo);
    assert.equal(logo.startsWith("/") || logo.includes(".."), false);
    assert.ok(existsSync(logo), logo);
    assert.equal(plugin.mcpServers, ".cursor-plugin/mcp.json");
  });

  it("points at the hosted server with OAuth only (no API-key header)", () => {
    const servers = Object.values(mcp.mcpServers);
    assert.equal(servers.length, 1);
    const server = servers[0] as {
      url?: string;
      headers?: unknown;
      auth?: { CLIENT_ID?: string; CLIENT_SECRET?: string; scopes?: string[] };
    };
    assert.equal(server.url, "https://mcp.kingminos.com/mcp");
    assert.equal(server.headers, undefined);
    assert.equal(server.auth?.CLIENT_SECRET, undefined, "public client");
    assert.ok((server.auth?.CLIENT_ID ?? "").length > 0);
    assert.deepEqual(server.auth?.scopes, [
      OAUTH_SCOPE_BASELINE,
      "offline_access",
    ]);
    assert.doesNotMatch(JSON.stringify(mcp), /\$\{|KINGMINOS_API_KEY|km_/);
  });
});
