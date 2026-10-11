import * as Sentry from "@sentry/cloudflare";
import { handleFetch } from "./fetch.js";
import { sentryOptions } from "./sentry.js";

/**
 * Production entry for Worker `kingminos-mcp-prod`.
 * Vars only — no D1/R2/router bindings, no embedded tenant or vendor keys.
 * Worker mode never reads process.env for the tenant Bearer.
 * Sentry (errors only, scrubbed) is on when the SENTRY_DSN secret is set.
 */
const handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleFetch(request, env, { mode: "worker" });
  },
};

export default Sentry.withSentry((env: Env) => sentryOptions(env), handler);
