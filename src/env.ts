/** Non-secret runtime config. Never put vendor keys or tenant Bearers in files. */
export interface RuntimeEnv {
  KINGMINOS_API_URL?: string;
  KINGMINOS_API_KEY?: string;
  KINGMINOS_MCP_ALLOWED_HOSTS?: string;
  KINGMINOS_MCP_PUBLIC_URL?: string;
  PORT?: string;
}

export function processRuntimeEnv(): RuntimeEnv {
  return {
    KINGMINOS_API_URL: process.env.KINGMINOS_API_URL,
    KINGMINOS_API_KEY: process.env.KINGMINOS_API_KEY,
    KINGMINOS_MCP_ALLOWED_HOSTS: process.env.KINGMINOS_MCP_ALLOWED_HOSTS,
    KINGMINOS_MCP_PUBLIC_URL: process.env.KINGMINOS_MCP_PUBLIC_URL,
    PORT: process.env.PORT,
  };
}

export function envString(env: RuntimeEnv, key: keyof RuntimeEnv): string | undefined {
  const value = env[key]?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function mergeRuntimeEnv(env?: RuntimeEnv): RuntimeEnv {
  const fromProcess = processRuntimeEnv();
  if (!env) {
    return fromProcess;
  }
  const merged: RuntimeEnv = { ...fromProcess };
  for (const key of [
    "KINGMINOS_API_URL",
    "KINGMINOS_API_KEY",
    "KINGMINOS_MCP_ALLOWED_HOSTS",
    "KINGMINOS_MCP_PUBLIC_URL",
    "PORT",
  ] as const) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      merged[key] = value;
    }
  }
  return merged;
}
