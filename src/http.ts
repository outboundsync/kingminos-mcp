import type { IncomingMessage, ServerResponse } from "node:http";
import express from "express";
import type { RuntimeEnv } from "./env.js";
import { handleFetch } from "./fetch.js";

export { handleFetch, readTenantBearer } from "./fetch.js";
export type { BearerFailure, BearerResult } from "./fetch.js";

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
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return new Request(url, { method, headers, body: Buffer.concat(chunks) });
}

async function sendNodeResponse(res: ServerResponse, response: Response): Promise<void> {
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

export function createApp(env?: RuntimeEnv): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res) => {
    void (async () => {
      const request = await incomingToRequest(req);
      const response = await handleFetch(request, env);
      await sendNodeResponse(res, response);
    })().catch(() => {
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    });
  });
  return app;
}
