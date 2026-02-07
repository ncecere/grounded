/**
 * SSRF protection: validates URLs before fetching to prevent
 * access to private networks, cloud metadata, and dangerous protocols.
 */

const BLOCKED_PROTOCOLS = new Set(["file:", "data:", "javascript:", "ftp:", "gopher:"]);

// Private/reserved IPv4 ranges (CIDR notation conceptually)
const PRIVATE_IPV4_PATTERNS = [
  /^127\./,                          // 127.0.0.0/8 (loopback)
  /^10\./,                           // 10.0.0.0/8 (private)
  /^172\.(1[6-9]|2\d|3[01])\./,     // 172.16.0.0/12 (private)
  /^192\.168\./,                     // 192.168.0.0/16 (private)
  /^169\.254\./,                     // 169.254.0.0/16 (link-local / cloud metadata)
  /^0\./,                            // 0.0.0.0/8
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10 (CGN)
  /^198\.18\./,                      // 198.18.0.0/15 (benchmark)
  /^224\./,                          // 224.0.0.0/4 (multicast)
  /^240\./,                          // 240.0.0.0/4 (reserved)
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.internal",
]);

export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSRFError";
  }
}

/**
 * Validates a URL is safe to fetch (not targeting private/internal resources).
 * Throws SSRFError if the URL is blocked.
 */
export function validateUrlForScraping(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SSRFError(`Invalid URL: ${url}`);
  }

  // Block dangerous protocols
  if (BLOCKED_PROTOCOLS.has(parsed.protocol)) {
    throw new SSRFError(`Blocked protocol: ${parsed.protocol}`);
  }

  // Only allow http/https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SSRFError(`Unsupported protocol: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block known dangerous hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new SSRFError(`Blocked hostname: ${hostname}`);
  }

  // Block IPv6 loopback and private addresses
  if (hostname === "[::1]" || hostname === "::1") {
    throw new SSRFError("Blocked IPv6 loopback address");
  }

  // Check if hostname is an IP address
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    for (const pattern of PRIVATE_IPV4_PATTERNS) {
      if (pattern.test(hostname)) {
        throw new SSRFError(`Blocked private IP address: ${hostname}`);
      }
    }
  }

  // Block cloud metadata endpoints (AWS, GCP, Azure)
  // AWS/GCP: 169.254.169.254, Azure: 169.254.169.254 + others
  if (hostname === "169.254.169.254") {
    throw new SSRFError("Blocked cloud metadata endpoint");
  }
}
