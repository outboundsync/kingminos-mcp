import assert from "node:assert/strict";
import { test } from "node:test";
import type { ErrorEvent } from "@sentry/cloudflare";
import { scrubEvent, scrubString, sentryOptions } from "./sentry.js";

test("sentryOptions is undefined without a DSN", () => {
  assert.equal(sentryOptions({}), undefined);
});

test("sentryOptions: no traces, production default, scrubbing hook", () => {
  const opts = sentryOptions({
    SENTRY_DSN: "https://k@o0.ingest.us.sentry.io/1",
  });
  assert.equal(opts?.tracesSampleRate, 0);
  assert.equal(opts?.environment, "production");
  assert.equal(opts?.beforeSend, scrubEvent);
});

test("scrubString redacts tokens, emails and LinkedIn URLs", () => {
  const out = scrubString(
    "km_live_abc kmwhsec_xyz kmadm_q1 osr_123 Bearer abc.def jane@acme.com https://www.linkedin.com/in/jane",
  );
  for (const leak of [
    "km_live_abc",
    "kmwhsec_xyz",
    "kmadm_q1",
    "osr_123",
    "abc.def",
    "jane@acme.com",
    "linkedin.com",
  ]) {
    assert.ok(!out.includes(leak), leak);
  }
});

test("scrubEvent drops bodies, cookies, auth, user and query strings", () => {
  const event = {
    user: { email: "a@b.co" },
    request: {
      method: "POST",
      url: "https://mcp.kingminos.com/mcp?email=a@b.co",
      data: '{"secret":1}',
      cookies: { s: "1" },
      headers: {
        authorization: "Bearer km_x",
        cookie: "s=1",
        "user-agent": "ua",
      },
    },
    exception: {
      values: [{ type: "Error", value: "failed for a@b.co with km_abc" }],
    },
    extra: { payload: { email: "a@b.co" }, note: "osr_1" },
  } as unknown as ErrorEvent;
  const out = scrubEvent(event);
  assert.ok(out);
  const json = JSON.stringify(out);
  for (const leak of [
    "a@b.co",
    "km_x",
    "km_abc",
    "osr_1",
    "s=1",
    '\\"secret\\"',
  ]) {
    assert.ok(!json.includes(leak), leak);
  }
  assert.equal(out.request?.url, "https://mcp.kingminos.com/mcp");
  assert.equal(out.request?.data, undefined);
  assert.equal(out.user, undefined);
});
