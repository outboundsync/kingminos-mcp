import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { KingMinosApiError } from "./errors.js";
import {
  apiRequest,
  joinUrl,
  methodAwareRetryable,
  okText,
  parseRetryAfter,
} from "./kingminos-client.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(payload, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("joinUrl", () => {
  it("keeps a path prefix on KINGMINOS_API_URL", () => {
    assert.equal(
      joinUrl("/v1/providers", undefined, "https://example.com/prefix"),
      "https://example.com/prefix/v1/providers",
    );
  });

  it("rejects an absolute path", () => {
    assert.throws(
      () => joinUrl("https://evil.example/v1/providers"),
      /Absolute upstream/,
    );
  });
});

describe("parseRetryAfter", () => {
  it("reads seconds and HTTP-date forms", () => {
    assert.equal(parseRetryAfter("3"), 3);
    const when = new Date(Date.now() + 2_500).toUTCString();
    const parsed = parseRetryAfter(when);
    assert.ok(parsed !== undefined && parsed >= 2 && parsed <= 4);
  });
});

describe("methodAwareRetryable", () => {
  it("is false for cancelled requests and 504", () => {
    assert.equal(
      methodAwareRetryable({
        method: "GET",
        cancelled: true,
        hasIdempotencyKey: false,
      }),
      false,
    );
    assert.equal(
      methodAwareRetryable({
        method: "GET",
        status: 504,
        hasIdempotencyKey: false,
      }),
      false,
    );
  });

  it("allows GET 5xx/429 and writes only with an Idempotency-Key", () => {
    assert.equal(
      methodAwareRetryable({
        method: "GET",
        status: 500,
        hasIdempotencyKey: false,
      }),
      true,
    );
    assert.equal(
      methodAwareRetryable({
        method: "POST",
        status: 500,
        hasIdempotencyKey: false,
      }),
      false,
    );
    assert.equal(
      methodAwareRetryable({
        method: "POST",
        status: 500,
        hasIdempotencyKey: true,
      }),
      true,
    );
    assert.equal(
      methodAwareRetryable({
        method: "DELETE",
        status: 429,
        hasIdempotencyKey: false,
      }),
      false,
    );
  });
});

describe("apiRequest", () => {
  it("forwards Authorization: Bearer and does not throw the token in errors", async () => {
    let authorization = "";
    globalThis.fetch = async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return jsonResponse(401, {
        error: "unauthorized",
        detail: "mismatch",
        request_id: "ray-1",
      });
    };
    await assert.rejects(
      () =>
        apiRequest({
          method: "GET",
          path: "/v1/providers",
          bearer: "secret-bearer-token-xyz",
        }),
      (error: unknown) => {
        assert.ok(error instanceof KingMinosApiError);
        assert.equal(error.code, "unauthorized");
        assert.equal(error.detail, "mismatch");
        assert.equal(error.requestId, "ray-1");
        assert.match(error.remediation ?? "", /mismatch/);
        assert.doesNotMatch(error.message, /secret-bearer-token-xyz/);
        assert.doesNotMatch(JSON.stringify(error), /secret-bearer-token-xyz/);
        return true;
      },
    );
    assert.equal(authorization, "Bearer secret-bearer-token-xyz");
  });

  it("maps status codes and non-JSON bodies", async () => {
    const cases: Array<{ status: number; code: string; body: unknown }> = [
      {
        status: 400,
        code: "bad_request",
        body: { error: "bad", detail: "fields" },
      },
      { status: 403, code: "forbidden", body: { error: "nope" } },
      { status: 404, code: "not_found", body: { error: "gone" } },
      { status: 422, code: "bad_request", body: { error: "invalid" } },
      { status: 429, code: "rate_limited", body: { error: "slow" } },
      { status: 500, code: "upstream_error", body: { error: "boom" } },
      { status: 504, code: "upstream_error", body: { error: "budget" } },
      { status: 502, code: "upstream_error", body: "plain upstream failure" },
    ];
    for (const item of cases) {
      globalThis.fetch = async () =>
        jsonResponse(
          item.status,
          item.body,
          item.status === 429 ? { "retry-after": "9" } : {},
        );
      await assert.rejects(
        () =>
          apiRequest({
            method: "POST",
            path: "/v1/company/resolve",
            bearer: "t",
          }),
        (error: unknown) => {
          assert.ok(error instanceof KingMinosApiError);
          assert.equal(error.code, item.code, String(item.status));
          assert.equal(error.status, item.status);
          if (item.status === 429) {
            assert.equal(error.retryAfterSeconds, 9);
            assert.equal(error.retryable, false);
          }
          if (item.status === 502) {
            assert.equal(error.message, "plain upstream failure");
          }
          if (item.status === 504) {
            assert.equal(error.retryable, false);
            assert.match(error.remediation ?? "", /query budget/);
          }
          return true;
        },
      );
    }
  });

  it("retries GET 500 once and does not retry POST 500 without an Idempotency-Key", async () => {
    let gets = 0;
    globalThis.fetch = async () => {
      gets += 1;
      return jsonResponse(gets === 1 ? 500 : 200, { ok: true });
    };
    const payload = await apiRequest({
      method: "GET",
      path: "/v1/providers",
      bearer: "t",
    });
    assert.deepEqual(payload, { ok: true });
    assert.equal(gets, 2);

    let posts = 0;
    globalThis.fetch = async () => {
      posts += 1;
      return jsonResponse(500, { error: "boom" });
    };
    await assert.rejects(() =>
      apiRequest({ method: "POST", path: "/v1/company/resolve", bearer: "t" }),
    );
    assert.equal(posts, 1);
  });

  it("retries POST 500 only when an Idempotency-Key is present and names the retry in remediation", async () => {
    let posts = 0;
    globalThis.fetch = async () => {
      posts += 1;
      return jsonResponse(500, { error: "boom" });
    };
    await assert.rejects(
      () =>
        apiRequest({
          method: "POST",
          path: "/v1/company/resolve",
          bearer: "t",
          headers: { "Idempotency-Key": "idem-1" },
        }),
      (error: unknown) => {
        assert.ok(error instanceof KingMinosApiError);
        assert.match(error.remediation ?? "", /Already retried once/);
        return true;
      },
    );
    assert.equal(posts, 2);
  });

  it("never retries 504", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return jsonResponse(504, { error: "budget" });
    };
    await assert.rejects(() =>
      apiRequest({ method: "GET", path: "/v1/providers", bearer: "t" }),
    );
    assert.equal(calls, 1);
  });

  it("retries 429 once when Retry-After is <= 5s and the method may retry", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(429, { error: "slow" }, { "retry-after": "0" });
      }
      return jsonResponse(200, { ok: true });
    };
    const payload = await apiRequest({
      method: "GET",
      path: "/v1/providers",
      bearer: "t",
    });
    assert.deepEqual(payload, { ok: true });
    assert.equal(calls, 2);
  });

  it("does not auto-wait a 429 longer than 5s", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return jsonResponse(429, { error: "slow" }, { "retry-after": "6" });
    };
    await assert.rejects(
      () => apiRequest({ method: "GET", path: "/v1/providers", bearer: "t" }),
      (error: unknown) => {
        assert.ok(error instanceof KingMinosApiError);
        assert.doesNotMatch(error.remediation ?? "", /Already retried/);
        return true;
      },
    );
    assert.equal(calls, 1);
  });

  it("does not retry POST 429 without an Idempotency-Key", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return jsonResponse(429, { error: "slow" }, { "retry-after": "0" });
    };
    await assert.rejects(() =>
      apiRequest({ method: "POST", path: "/v1/company/resolve", bearer: "t" }),
    );
    assert.equal(calls, 1);
  });

  it("parses a Retry-After HTTP-date that is already past", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(
          429,
          { error: "slow" },
          { "retry-after": new Date(Date.now() - 1_000).toUTCString() },
        );
      }
      return jsonResponse(200, { ok: true });
    };
    const payload = await apiRequest({
      method: "GET",
      path: "/v1/providers",
      bearer: "t",
    });
    assert.deepEqual(payload, { ok: true });
    assert.equal(calls, 2);
  });

  it("maps an already-aborted signal to cancelled, not timeout", async () => {
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = async () => {
      throw new Error("fetch should not run");
    };
    await assert.rejects(
      () =>
        apiRequest({
          method: "GET",
          path: "/v1/providers",
          bearer: "t",
          signal: controller.signal,
        }),
      (error: unknown) => {
        assert.ok(error instanceof KingMinosApiError);
        assert.equal(error.code, "upstream_error");
        assert.match(error.message, /cancelled/);
        assert.equal(error.retryable, false);
        return true;
      },
    );
  });

  it("maps AbortError without a caller abort to timeout", async () => {
    globalThis.fetch = async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    };
    await assert.rejects(
      () => apiRequest({ method: "GET", path: "/v1/providers", bearer: "t" }),
      (error: unknown) => {
        assert.ok(error instanceof KingMinosApiError);
        assert.equal(error.code, "timeout");
        assert.equal(error.retryable, true);
        return true;
      },
    );
  });
});

describe("okText", () => {
  it("emits compact JSON", () => {
    const result = okText({ ok: true, nested: { a: 1 } });
    assert.equal(result.content[0]?.text, '{"ok":true,"nested":{"a":1}}');
    assert.ok(!result.content[0]?.text.includes("\n"));
  });
});
