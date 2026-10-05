/** Non-secret runtime config. Never put vendor keys or tenant Bearers in files. */
export interface RuntimeEnv {
  KINGMINOS_API_URL?: string;
  KINGMINOS_API_KEY?: string;
  KINGMINOS_MCP_ALLOWED_HOSTS?: string;
  KINGMINOS_MCP_ALLOWED_ORIGINS?: string;
  KINGMINOS_MCP_PUBLIC_URL?: string;
  KINGMINOS_MCP_ALLOW_ENV_BEARER?: string;
  PORT?: string;
  HOST?: string;
}

const NODE_ENV_KEYS = [
  "KINGMINOS_API_URL",
  "KINGMINOS_API_KEY",
  "KINGMINOS_MCP_ALLOWED_HOSTS",
  "KINGMINOS_MCP_ALLOWED_ORIGINS",
  "KINGMINOS_MCP_PUBLIC_URL",
  "KINGMINOS_MCP_ALLOW_ENV_BEARER",
  "PORT",
  "HOST",
] as const;

/** Worker bindings that may be copied from the Worker env object. Never the bearer. */
const WORKER_ENV_KEYS = [
  "KINGMINOS_API_URL",
  "KINGMINOS_MCP_ALLOWED_HOSTS",
  "KINGMINOS_MCP_ALLOWED_ORIGINS",
  "KINGMINOS_MCP_PUBLIC_URL",
] as const;

export function processRuntimeEnv(): RuntimeEnv {
  return {
    KINGMINOS_API_URL: process.env.KINGMINOS_API_URL,
    KINGMINOS_API_KEY: process.env.KINGMINOS_API_KEY,
    KINGMINOS_MCP_ALLOWED_HOSTS: process.env.KINGMINOS_MCP_ALLOWED_HOSTS,
    KINGMINOS_MCP_ALLOWED_ORIGINS: process.env.KINGMINOS_MCP_ALLOWED_ORIGINS,
    KINGMINOS_MCP_PUBLIC_URL: process.env.KINGMINOS_MCP_PUBLIC_URL,
    KINGMINOS_MCP_ALLOW_ENV_BEARER: process.env.KINGMINOS_MCP_ALLOW_ENV_BEARER,
    PORT: process.env.PORT,
    HOST: process.env.HOST,
  };
}

export function envString(
  env: RuntimeEnv,
  key: keyof RuntimeEnv,
): string | undefined {
  const value = env[key]?.trim();
  return value && value.length > 0 ? value : undefined;
}

/** Node-only merge. Worker mode must not call this (it reads process.env). */
export function mergeRuntimeEnv(env?: RuntimeEnv): RuntimeEnv {
  const fromProcess = processRuntimeEnv();
  if (!env) {
    return fromProcess;
  }
  const merged: RuntimeEnv = { ...fromProcess };
  for (const key of NODE_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * Worker bindings only. Never reads process.env and never copies KINGMINOS_API_KEY
 * even if a caller passes it on the env object.
 */
export function workerRuntimeEnv(env?: RuntimeEnv): RuntimeEnv {
  const resolved: RuntimeEnv = {};
  if (!env) {
    return resolved;
  }
  for (const key of WORKER_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      resolved[key] = value;
    }
  }
  return resolved;
}
