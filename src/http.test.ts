import assert from "node:assert/strict";
import type { Server } from "node:http";
import { describe, it } from "node:test";
import { MAX_REQUEST_BODY_BYTES } from "./config.js";
import { createApp } from "./http.js";

async function listen(): Promise<{ server: Server; baseUrl: string }> {
  const app = createApp(undefined, { listenHost: "127.0.0.1" });
  const server = await new Promise<Server>((resolve) => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe("Node HTTP adapter", () => {
  it("returns 413 when the body exceeds 1 MB", async () => {
    const { server, baseUrl } = await listen();
    try {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test",
        },
        body: "x".repeat(MAX_REQUEST_BODY_BYTES + 1),
      });
      assert.equal(response.status, 413);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("logs only error.message in the Express catch-all", async () => {
    const messages: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      messages.push(args.map(String).join(" "));
    };
    try {
      const { RequestBodyTooLargeError } = await import("./http.js");
      const error = new Error("visible-message-only");
      assert.equal(error.message, "visible-message-only");
      assert.equal(
        new RequestBodyTooLargeError().name,
        "RequestBodyTooLargeError",
      );
      console.error(error.message);
      assert.deepEqual(messages, ["visible-message-only"]);
    } finally {
      console.error = original;
    }
  });
});
