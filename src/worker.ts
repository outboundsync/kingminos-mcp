import { handleFetch } from "./fetch.js";

/**
 * Production entry for Worker `kingminos-mcp-prod`.
 * Vars only — no D1/R2/router bindings, no embedded tenant or vendor keys.
 * Worker mode never reads process.env for the tenant Bearer.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleFetch(request, env, { mode: "worker" });
  },
};
