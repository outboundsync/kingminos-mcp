/** Host / Origin parsing. IPv6 Host headers must not be split on `:`. */

export function normalizeHostname(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function hostnameFromHostHeader(hostHeader: string): string {
  const trimmed = hostHeader.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return normalizeHostname(new URL(`http://${trimmed}`).hostname);
  } catch {
    return normalizeHostname(trimmed);
  }
}

export function hostnameFromOrigin(origin: string): string | undefined {
  try {
    return normalizeHostname(new URL(origin).hostname);
  } catch {
    return undefined;
  }
}

export function isLoopbackHost(host: string): boolean {
  const hostname = normalizeHostname(host);
  return (
    hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
  );
}
