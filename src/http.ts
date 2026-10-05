import type { IncomingMessage, ServerResponse } from "node:http";
import express from "express";
import {
  MAX_REQUEST_BODY_BYTES,
  allowEnvBearerOptIn,
  isLoopbackHost,
  listenHost,
} from "./config.js";
import type { RuntimeEnv } from "./env.js";
import { mergeRuntimeEnv } from "./env.js";
import { handleFetch } from "./fetch.js";

export { handleFetch, readTenantBearer } from "./fetch.js";
export type { BearerFailure, BearerResult } from "./fetch.js";

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds 1 MB");
    this.name = "RequestBodyTooLargeError";
  }
}

async function incomingToRequest(req: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else {
      headers.set(key, value);
    }
  }
  const method = (req.method ?? "GET").toUpperCase();
  const url = `http://${req.headers.host ?? "127.0.0.1"}${req.url ?? "/"}`;
  if (method === "GET" || method === "HEAD") {
    return new Request(url, { method, headers });
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buf.byteLength;
    if (size > MAX_REQUEST_BODY_BYTES) {
      throw new RequestBodyTooLargeError();
    }
    chunks.push(buf);
  }
  return new Request(url, { method, headers, body: Buffer.concat(chunks) });
}

async function sendNodeResponse(
  res: ServerResponse,
  response: Response,
): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  if (!response.body) {
    res.end();
    return;
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}

export function createApp(
  env?: RuntimeEnv,
  options?: { listenHost?: string },
): express.Express {
  const merged = mergeRuntimeEnv(env);
  const host = options?.listenHost ?? listenHost(merged);
  const loopbackBound = isLoopbackHost(host);
  const allowEnvBearer = allowEnvBearerOptIn(merged);
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res) => {
    void (async () => {
      const request = await incomingToRequest(req);
      const response = await handleFetch(request, env, {
        mode: "node",
        loopbackBound,
        allowEnvBearer,
      });
      await sendNodeResponse(res, response);
    })().catch((error: unknown) => {
      if (error instanceof RequestBodyTooLargeError) {
        if (!res.headersSent) {
          res.status(413).json({ error: "Payload too large" });
        }
        req.resume();
        return;
      }
      const message =
        error instanceof Error ? error.message : "Internal server error";
      console.error(message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    });
  });
  return app;
}
