import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import net from "node:net";

export interface PublicUrlResolution {
  url: URL;
  addresses: LookupAddress[];
}

export async function isAllowedPublicHttpUrl(rawUrl: string): Promise<boolean> {
  return (await resolvePublicHttpUrl(rawUrl)) !== null;
}

export async function resolvePublicHttpUrl(rawUrl: string): Promise<PublicUrlResolution | null> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const addresses = await resolvePublicHostname(parsed.hostname);
  return addresses ? { url: parsed, addresses } : null;
}

export async function isAllowedPublicHostname(hostname: string): Promise<boolean> {
  return (await resolvePublicHostname(hostname)) !== null;
}

async function resolvePublicHostname(hostname: string): Promise<LookupAddress[] | null> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) return null;
  const ipVersion = net.isIP(host);
  if (!ipVersion) {
    try {
      const addresses = await lookup(host, { all: true, verbatim: false });
      const allowed = addresses.length > 0 && addresses.every((entry) => {
        if (entry.family === 4) return isAllowedIpv4(entry.address);
        if (entry.family === 6) return isAllowedIpv6(entry.address.toLowerCase());
        return false;
      });
      return allowed ? addresses : null;
    } catch {
      return null;
    }
  }
  if (ipVersion === 4) return isAllowedIpv4(host) ? [{ address: host, family: 4 }] : null;
  return isAllowedIpv6(host) ? [{ address: host, family: 6 }] : null;
}

function isAllowedIpv4(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && parts[2] === 100) return false;
  if (a === 203 && b === 0 && parts[2] === 113) return false;
  if (a >= 224) return false;
  return true;
}

function isAllowedIpv6(host: string): boolean {
  const dottedMappedIpv4 = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dottedMappedIpv4) return isAllowedIpv4(dottedMappedIpv4[1]);
  const hexMappedIpv4 = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hexMappedIpv4) {
    const high = Number.parseInt(hexMappedIpv4[1], 16);
    const low = Number.parseInt(hexMappedIpv4[2], 16);
    if (!Number.isFinite(high) || !Number.isFinite(low)) return false;
    return isAllowedIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  if (host === "::1" || host === "::") return false;
  if (host.startsWith("fc") || host.startsWith("fd") || isIpv6LinkLocal(host) || host.startsWith("ff")) return false;
  if (host.startsWith("2001:db8")) return false;
  return true;
}

function isIpv6LinkLocal(host: string): boolean {
  const firstGroup = host.split(":", 1)[0];
  const value = Number.parseInt(firstGroup, 16);
  return Number.isFinite(value) && value >= 0xfe80 && value <= 0xfebf;
}
