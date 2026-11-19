import * as Sentry from "@sentry/cloudflare";
import { handleFetch } from "./fetch.js";
import type { AuthServerBinding } from "./oauth.js";
import { sentryOptions } from "./sentry.js";

/**
 * Production entry for Worker `kingminos-mcp-prod`.
 * Vars plus one service binding (AUTH_SERVER → kingminos-api KingMinosGateway, MCP OAuth).
 * No D1/R2/router bindings, no embedded tenant or vendor keys.
 * Worker mode never reads process.env for the tenant Bearer.
 * Sentry (errors only, scrubbed) is on when the SENTRY_DSN secret is set.
 */
const handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    // AUTH_SERVER: service binding to kingminos-api `KingMinosGateway` (MCP OAuth).
    const authServer = (env as { AUTH_SERVER?: AuthServerBinding }).AUTH_SERVER;
    return handleFetch(request, env, {
      mode: "worker",
      ...(authServer ? { authServer } : {}),
    });
  },
};

export default Sentry.withSentry((env: Env) => sentryOptions(env), handler);
