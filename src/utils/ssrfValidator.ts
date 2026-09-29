import dns from 'dns';
import net from 'net';

/**
 * Checks whether an IP address is a private, loopback, link-local, multicast, or reserved address.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  // Check IPv4
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(p => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }

    // 0.0.0.0/8 (Current network / broadcast)
    if (parts[0] === 0) return true;
    // 10.0.0.0/8 (Private network - RFC 1918)
    if (parts[0] === 10) return true;
    // 127.0.0.0/8 (Loopback / localhost)
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (Link-local / AWS, GCP, Azure metadata service)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 172.16.0.0/12 (Private network - RFC 1918: 172.16.x.x - 172.31.x.x)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16 (Private network - RFC 1918)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 100.64.0.0/10 (Shared address space / Carrier-grade NAT)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // 198.18.0.0/15 (Benchmarking)
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
    // 224.0.0.0/4 (Multicast)
    if (parts[0] >= 224 && parts[0] <= 239) return true;
    // 240.0.0.0/4 (Reserved for future use)
    if (parts[0] >= 240) return true;

    return false;
  }

  // Check IPv6
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    // ::1 (Loopback)
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
    // :: (Unspecified)
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
    // Unique local address (fc00::/7)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // Link-local address (fe80::/10)
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
    // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
    if (lower.includes('::ffff:')) {
      const ipv4Part = lower.split('::ffff:')[1];
      if (ipv4Part && net.isIPv4(ipv4Part)) {
        return isPrivateOrReservedIp(ipv4Part);
      }
    }
    return false;
  }

  return true;
}

/**
 * Validates a remote URL to prevent Server-Side Request Forgery (SSRF).
 * Rejects requests to localhost, internal networks, or cloud metadata endpoints.
 */
export async function validateUrlForSsrf(urlString: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('Invalid URL format.');
  }

  // Only permit HTTP and HTTPS protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: '${parsed.protocol}'. Only http and https are permitted.`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block obvious localhost and internal domains
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal'
  ) {
    throw new Error('Access to local or internal network hostnames is blocked for security.');
  }

  // If hostname is directly an IP literal
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new Error(`Access to private or reserved IP address '${hostname}' is blocked for security.`);
    }
    return parsed;
  }

  // Resolve hostname via DNS to protect against DNS rebinding and internal IP aliases
  try {
    const lookupResult = await dns.promises.lookup(hostname, { all: true });
    for (const record of lookupResult) {
      if (isPrivateOrReservedIp(record.address)) {
        throw new Error(`Hostname '${hostname}' resolves to private IP '${record.address}'. Access blocked for security.`);
      }
    }
  } catch (err: any) {
    if (err.message?.includes('Access blocked for security')) {
      throw err;
    }
    throw new Error(`Failed to resolve hostname '${hostname}': ${err.message}`);
  }

  return parsed;
}
