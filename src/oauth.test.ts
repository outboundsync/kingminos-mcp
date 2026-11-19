import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LIVE_RESOURCE_ROUTES } from "./catalog.js";
import { DIRECTORY_HIDDEN_TOOLS } from "./directory-tools.js";
import { handleFetch } from "./fetch.js";
import {
  type AuthServerBinding,
  authorizationServerMetadata,
  bearerChallenge,
  looksLikeOAuthToken,
  OAUTH_TOOL_SECURITY_SCHEMES,
  oauthSettings,
  oauthToolAllowed,
  resetAuthorizationServerMetadataCache,
  type ValidatedToken,
} from "./oauth.js";

const RESOURCE = "https://mcp.kingminos.com/mcp";
const OAUTH_TOKEN = "usr_1:grant_1:secret";
const ON = { OAUTH_ENABLED: "on", KINGMINOS_MCP_PUBLIC_URL: RESOURCE };

interface FakeBinding extends AuthServerBinding {
  fetched: Request[];
}

function fakeBinding(
  validate: (
    resource: string,
    token: string,
  ) => Promise<ValidatedToken | null> = async () => ({
    props: {
      userId: "usr_1",
      workspaceId: "ws_1",
      platform: "claude",
      level: "lookups",
    },
    audience: RESOURCE,
    expiresAt: Date.now() / 1000 + 3600,
    scope: ["capability:*", "billing:read"],
  }),
  answer: () => Response = () =>
    new Response(JSON.stringify({ ok: true, capabilities: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
): FakeBinding {
  const fetched: Request[] = [];
  return {
    fetched,
    validateToken: validate,
    async fetch(input: Request | string, init?: RequestInit) {
      const request =
        typeof input === "string" ? new Request(input, init) : input;
      fetched.push(request);
      return answer();
    },
  };
}

function apiError(status: number, error: string): () => Response {
  return () =>
    new Response(JSON.stringify({ error, message: error }), {
      status,
      headers: { "content-type": "application/json" },
    });
}

const DEFAULT_VALIDATE = fakeBinding().validateToken;

function post(token?: string): Request {
  return new Request("https://mcp.kingminos.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });
}

async function client(
  token: string,
  binding: AuthServerBinding | undefined,
  env = ON,
): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(
    new URL("https://mcp.kingminos.com/mcp"),
    {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: async (input, init) =>
        handleFetch(new Request(input, init), env, {
          mode: "worker",
          ...(binding ? { authServer: binding } : {}),
        }),
    },
  );
  const mcp = new Client({ name: "kingminos-oauth-test", version: "0.0.0" });
  await mcp.connect(transport);
  return mcp;
}

describe("MCP OAuth off switch", () => {
  it("serves no discovery and keeps the plain 401 while off", async () => {
    for (const env of [{}, { OAUTH_ENABLED: "true" }]) {
      const prm = await handleFetch(
        new Request(
          "https://mcp.kingminos.com/.well-known/oauth-protected-resource/mcp",
        ),
        env,
        { mode: "worker", authServer: fakeBinding() },
      );
      assert.equal(prm.status, 404);
      const unauth = await handleFetch(post(), env, {
        mode: "worker",
        authServer: fakeBinding(),
      });
      assert.equal(unauth.status, 401);
      assert.equal(unauth.headers.get("www-authenticate"), null);
    }
  });

  it("stays off when the switch is on but the binding is missing", () => {
    assert.equal(oauthSettings(ON, undefined), null);
  });
});

describe("MCP OAuth discovery", () => {
  it("serves RFC 9728 metadata at the path-insert URL and the domain root", async () => {
    for (const path of [
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-protected-resource",
    ]) {
      const response = await handleFetch(
        new Request(`https://mcp.kingminos.com${path}`),
        ON,
        {
          mode: "worker",
          authServer: fakeBinding(),
        },
      );
      assert.equal(response.status, 200, path);
      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(body.resource, RESOURCE);
      assert.deepEqual(body.authorization_servers, [
        "https://api.kingminos.com",
      ]);
      assert.deepEqual(body.scopes_supported, ["capability:*"]);
    }
  });

  it("mirrors the issuer's AS metadata at this host's root (HubSpot) and caches it", async () => {
    resetAuthorizationServerMetadataCache();
    const settings = oauthSettings(ON, fakeBinding());
    assert.ok(settings);
    let calls = 0;
    const fetchImpl = (async (url: string) => {
      calls += 1;
      assert.equal(
        url,
        "https://api.kingminos.com/.well-known/oauth-authorization-server",
      );
      return new Response(
        JSON.stringify({ issuer: "https://api.kingminos.com" }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const first = await authorizationServerMetadata(settings, fetchImpl, 1_000);
    const second = await authorizationServerMetadata(
      settings,
      fetchImpl,
      2_000,
    );
    assert.equal(first.status, 200);
    assert.equal(
      ((await second.json()) as { issuer: string }).issuer,
      "https://api.kingminos.com",
    );
    assert.equal(calls, 1);
    resetAuthorizationServerMetadataCache();
    const down = await authorizationServerMetadata(
      settings,
      (async () =>
        new Response("no", { status: 401 })) as unknown as typeof fetch,
      3_000,
    );
    assert.equal(down.status, 502);
    assert.equal(down.headers.get("access-control-allow-origin"), "*");
    const thrown = await authorizationServerMetadata(
      settings,
      (async () => {
        throw new TypeError("network down");
      }) as unknown as typeof fetch,
      4_000,
    );
    assert.equal(thrown.status, 502, "a thrown fetch is a 502, not a 500");
    assert.equal(thrown.headers.get("access-control-allow-origin"), "*");
  });
});

describe("MCP OAuth on /mcp", () => {
  it("answers an unauthenticated call with 401 and a sign-in challenge", async () => {
    const response = await handleFetch(post(), ON, {
      mode: "worker",
      authServer: fakeBinding(),
    });
    assert.equal(response.status, 401);
    const challenge = response.headers.get("www-authenticate") ?? "";
    assert.match(challenge, /^Bearer /);
    assert.match(
      challenge,
      /resource_metadata="https:\/\/mcp\.kingminos\.com\/\.well-known\/oauth-protected-resource\/mcp"/,
    );
    assert.match(challenge, /scope="capability:\*"/);
    assert.equal(
      ((await response.json()) as { error: string }).error,
      "Missing Authorization header",
    );
  });

  it("401s an invalid, wrong-audience or expired OAuth token before the MCP server runs", async () => {
    const bindings = [
      fakeBinding(async () => null),
      fakeBinding(async () => ({
        props: {},
        audience: "https://api.kingminos.com/v1",
      })),
      fakeBinding(async () => ({
        props: {},
        audience: RESOURCE,
        expiresAt: Date.now() / 1000 - 1,
      })),
    ];
    for (const binding of bindings) {
      const response = await handleFetch(post(OAUTH_TOKEN), ON, {
        mode: "worker",
        authServer: binding,
      });
      assert.equal(response.status, 401);
      assert.match(
        response.headers.get("www-authenticate") ?? "",
        /error="invalid_token"/,
      );
      assert.equal(binding.fetched.length, 0);
    }
  });

  it("returns 503 (never a pass) when the auth server binding fails", async () => {
    const binding = fakeBinding(async () => {
      throw new Error("binding down");
    });
    const response = await handleFetch(post(OAUTH_TOKEN), ON, {
      mode: "worker",
      authServer: binding,
    });
    assert.equal(response.status, 503);
  });

  it("gives an OAuth caller the directory tool subset and routes calls over the binding", async () => {
    const binding = fakeBinding();
    const mcp = await client(OAUTH_TOKEN, binding);
    try {
      const names = (await mcp.listTools()).tools
        .map((tool) => tool.name)
        .sort();
      const expected = LIVE_RESOURCE_ROUTES.filter(
        (route) =>
          oauthToolAllowed(route) && !DIRECTORY_HIDDEN_TOOLS.has(route.tool),
      )
        .map((route) => route.tool)
        .sort();
      assert.deepEqual(names, expected);
      for (const hidden of [
        "put_credentials",
        "delete_subject",
        "create_webhook",
        "get_balance_ledger",
        "list_events",
      ]) {
        assert.equal((names as string[]).includes(hidden), false, hidden);
      }
      assert.ok(names.includes("company_resolve"));
      assert.ok(names.includes("get_run"));
      await mcp.callTool({ name: "get_capabilities", arguments: {} });
      assert.equal(binding.fetched.length, 1);
      const sent = binding.fetched[0] as Request;
      assert.equal(new URL(sent.url).pathname, "/v1/capabilities");
      assert.equal(sent.headers.get("authorization"), `Bearer ${OAUTH_TOKEN}`);
      assert.equal(sent.headers.get("x-kingminos-client"), "mcp");
    } finally {
      await mcp.close();
    }
  });

  it("keeps API keys on today's path with the full tool set", async () => {
    const binding = fakeBinding(async () => {
      throw new Error("keys must never be sent to the auth server");
    });
    const mcp = await client("km_live_example", binding);
    try {
      const names = (await mcp.listTools()).tools
        .map((tool) => tool.name)
        .sort();
      assert.deepEqual(
        names,
        LIVE_RESOURCE_ROUTES.map((route) => route.tool).sort(),
      );
    } finally {
      await mcp.close();
    }
  });
});

describe("MCP OAuth helpers", () => {
  it("recognises only the library token shape", () => {
    assert.equal(looksLikeOAuthToken(OAUTH_TOKEN), true);
    for (const key of ["km_live_x", "osr_x", "kmadm_x", "a::b", "a:b"]) {
      assert.equal(looksLikeOAuthToken(key), false, key);
    }
  });
});

interface ListedTool {
  name: string;
  securitySchemes?: unknown;
  _meta?: { securitySchemes?: unknown };
}

async function rawToolsList(
  token: string,
  binding: AuthServerBinding | undefined,
  env: Record<string, string> = ON,
): Promise<ListedTool[]> {
  const response = await handleFetch(post(token), env, {
    mode: "worker",
    ...(binding ? { authServer: binding } : {}),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { result: { tools: ListedTool[] } };
  return body.result.tools;
}

describe("ChatGPT tool-level auth (OAuth on)", () => {
  const OAUTH2 = [{ type: "oauth2", scopes: ["capability:*"] }];

  it("declares oauth2 securitySchemes on every tool, top level and in _meta", async () => {
    const tools = await rawToolsList(OAUTH_TOKEN, fakeBinding());
    assert.ok(tools.length > 0);
    for (const tool of tools) {
      assert.deepEqual(tool.securitySchemes, OAUTH2, tool.name);
      assert.deepEqual(tool._meta?.securitySchemes, OAUTH2, tool.name);
    }
    assert.deepEqual(OAUTH_TOOL_SECURITY_SCHEMES, OAUTH2);
  });

  it("leaves API-key descriptors unchanged, with OAuth on or off", async () => {
    for (const env of [ON, {}]) {
      const tools = await rawToolsList("km_live_example", fakeBinding(), env);
      assert.equal(tools.length, LIVE_RESOURCE_ROUTES.length);
      for (const tool of tools) {
        assert.equal("securitySchemes" in tool, false, tool.name);
        assert.equal(tool._meta, undefined, tool.name);
      }
    }
  });

  it("puts the WWW-Authenticate challenge in _meta when the API answers 401 or 403", async () => {
    const cases = [
      { status: 401, error: "invalid_token" },
      { status: 403, error: "insufficient_scope" },
    ];
    for (const { status, error } of cases) {
      const binding = fakeBinding(
        DEFAULT_VALIDATE,
        apiError(status, "unauthorized"),
      );
      const mcp = await client(OAUTH_TOKEN, binding);
      try {
        const result = (await mcp.callTool({
          name: "get_capabilities",
          arguments: {},
        })) as { isError?: boolean; _meta?: Record<string, unknown> };
        assert.equal(result.isError, true);
        const challenges = result._meta?.["mcp/www_authenticate"];
        assert.ok(Array.isArray(challenges), String(status));
        assert.equal(challenges.length, 1);
        const challenge = challenges[0] as string;
        assert.match(challenge, /^Bearer /);
        assert.match(
          challenge,
          /resource_metadata="https:\/\/mcp\.kingminos\.com\/\.well-known\/oauth-protected-resource\/mcp"/,
        );
        assert.match(challenge, /scope="capability:\*"/);
        assert.match(challenge, new RegExp(`error="${error}"`));
        assert.match(challenge, /error_description="[^"]+"/);
      } finally {
        await mcp.close();
      }
    }
  });

  it("adds no challenge for non-auth failures or for API-key callers", async () => {
    const oauthServerError = await client(
      OAUTH_TOKEN,
      fakeBinding(DEFAULT_VALIDATE, apiError(400, "bad_request")),
    );
    try {
      const result = (await oauthServerError.callTool({
        name: "get_capabilities",
        arguments: {},
      })) as { isError?: boolean; _meta?: Record<string, unknown> };
      assert.equal(result.isError, true);
      assert.equal(result._meta?.["mcp/www_authenticate"], undefined);
    } finally {
      await oauthServerError.close();
    }

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      apiError(401, "unauthorized")()) as typeof fetch;
    const keyCaller = await client("km_live_example", fakeBinding());
    try {
      const result = (await keyCaller.callTool({
        name: "get_capabilities",
        arguments: {},
      })) as { isError?: boolean; _meta?: Record<string, unknown> };
      assert.equal(result.isError, true);
      assert.equal(result._meta?.["mcp/www_authenticate"], undefined);
    } finally {
      globalThis.fetch = realFetch;
      await keyCaller.close();
    }
  });

  it("keeps the HTTP 401 challenge free of error_description", () => {
    const settings = { metadataUrl: "https://m.example/.well-known/x" };
    assert.equal(
      bearerChallenge(settings, "invalid_token"),
      'Bearer realm="KingMinos", resource_metadata="https://m.example/.well-known/x", scope="capability:*", error="invalid_token"',
    );
  });
});

describe("server card authentication schemes", () => {
  async function schemes(
    env: Record<string, string>,
    binding?: AuthServerBinding,
  ): Promise<string[] | undefined> {
    const response = await handleFetch(
      new Request("https://mcp.kingminos.com/.well-known/mcp/server-card.json"),
      env,
      { mode: "worker", ...(binding ? { authServer: binding } : {}) },
    );
    const body = (await response.json()) as {
      authentication?: { schemes?: string[] };
    };
    return body.authentication?.schemes;
  }

  it("adds oauth2 only when OAuth is on with the binding", async () => {
    assert.deepEqual(await schemes(ON, fakeBinding()), ["bearer", "oauth2"]);
    assert.deepEqual(await schemes(ON), ["bearer"]);
    assert.deepEqual(await schemes({}, fakeBinding()), ["bearer"]);
    assert.deepEqual(await schemes({ OAUTH_ENABLED: "off" }, fakeBinding()), [
      "bearer",
    ]);
  });
});

describe("OpenAI apps domain challenge", () => {
  const TOKEN = "oaichal_example_token_123";
  const challengeRequest = () =>
    new Request("https://mcp.kingminos.com/.well-known/openai-apps-challenge");

  it("serves the secret as the exact text/plain body in Worker and Node mode", async () => {
    for (const mode of ["worker", "node"] as const) {
      const response = await handleFetch(
        challengeRequest(),
        { OPENAI_APPS_CHALLENGE: TOKEN },
        { mode },
      );
      assert.equal(response.status, 200, mode);
      assert.match(response.headers.get("content-type") ?? "", /^text\/plain/);
      assert.equal(await response.text(), TOKEN, mode);
    }
  });

  it("is served whether or not OAuth is on", async () => {
    const response = await handleFetch(
      challengeRequest(),
      { ...ON, OPENAI_APPS_CHALLENGE: TOKEN },
      { mode: "worker", authServer: fakeBinding() },
    );
    assert.equal(await response.text(), TOKEN);
  });

  it("404s when the secret is unset or blank", async () => {
    for (const env of [{}, { OPENAI_APPS_CHALLENGE: "   " }]) {
      const response = await handleFetch(challengeRequest(), env, {
        mode: "worker",
      });
      assert.equal(response.status, 404);
    }
  });

  it("never logs the token", async () => {
    const logged: string[] = [];
    const realLog = console.log;
    console.log = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
    try {
      await handleFetch(
        challengeRequest(),
        { OPENAI_APPS_CHALLENGE: TOKEN },
        { mode: "worker" },
      );
    } finally {
      console.log = realLog;
    }
    assert.ok(logged.length > 0);
    assert.equal(
      logged.some((line) => line.includes(TOKEN)),
      false,
    );
  });
});
