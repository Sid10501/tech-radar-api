import http from "node:http";
import https from "node:https";
import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import type { ExtractResult } from "./extract.js";
import { resolvePublicHttpUrl } from "./urlSafety.js";

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const SHORTLINK_HOSTS = new Set([
  "t.co",
  "bit.ly",
  "bitly.com",
  "tinyurl.com",
  "cutt.ly",
  "goo.gl",
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type ShortlinkExpansionStatus = "resolved" | "unresolved" | "blocked";
export type ShortlinkExpansionReason =
  | "expanded"
  | "not_redirect"
  | "blocked_redirect"
  | "invalid_redirect"
  | "redirect_loop"
  | "redirect_limit"
  | "timeout"
  | "network_error";

export interface ShortlinkExpansion {
  sourceUrl: string;
  expandedUrl: string | null;
  finalHost: string | null;
  status: ShortlinkExpansionStatus;
  reason: ShortlinkExpansionReason;
  redirectCount: number;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type RequestMethod = "HEAD" | "GET";

interface RedirectResponse {
  status: number;
  headers: { get(name: string): string | null };
}

export interface ResolveShortlinkOptions {
  fetcher?: Fetcher;
  maxRedirects?: number;
  timeoutMs?: number;
}

export function findShortlinkUrls(extract: ExtractResult): string[] {
  const texts = [
    extract.url,
    extract.title,
    extract.caption,
    extract.transcript,
    extract.visual_text,
    ...(extract.source_links ?? []),
  ];
  const found = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(URL_RE)) {
      const value = cleanUrl(match[0]);
      try {
        if (SHORTLINK_HOSTS.has(new URL(value).hostname.toLowerCase())) found.add(value);
      } catch {
        // Ignore malformed text matches.
      }
    }
  }
  return [...found].slice(0, 10);
}

export async function resolveShortlink(
  sourceUrl: string,
  options: ResolveShortlinkOptions = {},
): Promise<ShortlinkExpansion> {
  const maxRedirects = options.maxRedirects ?? 5;
  const timeoutMs = options.timeoutMs ?? 3_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let currentUrl = sourceUrl;
  let redirectCount = 0;
  const visited = new Set<string>();

  try {
    while (true) {
      let current: URL;
      try {
        current = new URL(currentUrl);
      } catch {
        return result(sourceUrl, null, null, "unresolved", "invalid_redirect", redirectCount);
      }

      const resolution = await withAbort(resolvePublicHttpUrl(current.href), controller.signal);
      if (!resolution) {
        return result(
          sourceUrl,
          null,
          current.hostname || null,
          "blocked",
          "blocked_redirect",
          redirectCount,
        );
      }
      if (visited.has(current.href)) {
        return result(sourceUrl, null, current.hostname, "unresolved", "redirect_loop", redirectCount);
      }
      visited.add(current.href);

      let response = await requestRedirectResponse(
        current.href,
        resolution.addresses,
        "HEAD",
        controller.signal,
        options.fetcher,
      );
      if (!REDIRECT_STATUSES.has(response.status)) {
        response = await requestRedirectResponse(
          current.href,
          resolution.addresses,
          "GET",
          controller.signal,
          options.fetcher,
        );
      }
      if (!REDIRECT_STATUSES.has(response.status)) {
        if (redirectCount === 0) {
          return result(sourceUrl, null, current.hostname, "unresolved", "not_redirect", 0);
        }
        return result(sourceUrl, current.href, current.hostname, "resolved", "expanded", redirectCount);
      }

      if (redirectCount >= maxRedirects) {
        return result(sourceUrl, null, current.hostname, "unresolved", "redirect_limit", redirectCount);
      }
      const location = response.headers.get("location");
      if (!location) {
        return result(sourceUrl, null, current.hostname, "unresolved", "invalid_redirect", redirectCount);
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return result(sourceUrl, null, current.hostname, "unresolved", "invalid_redirect", redirectCount);
      }
      redirectCount += 1;
      if (visited.has(next.href)) {
        return result(sourceUrl, null, next.hostname || null, "unresolved", "redirect_loop", redirectCount);
      }
      currentUrl = next.href;
    }
  } catch (error) {
    const timedOut = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
    return result(
      sourceUrl,
      null,
      safeHostname(currentUrl),
      "unresolved",
      timedOut ? "timeout" : "network_error",
      redirectCount,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function expandShortlinksInExtract(
  extract: ExtractResult,
  options: ResolveShortlinkOptions = {},
): Promise<ExtractResult> {
  const urls = findShortlinkUrls(extract);
  if (urls.length === 0) return extract;

  const expansions = await Promise.all(urls.map((url) => resolveShortlink(url, options)));
  const resolvedUrls = expansions.flatMap((entry) => entry.expandedUrl ? [entry.expandedUrl] : []);
  const warnings = expansions
    .filter((entry) => entry.status !== "resolved")
    .map((entry) => `Shortlink ${entry.status} (${entry.reason}): ${entry.sourceUrl}`);
  const resolvedAny = resolvedUrls.length > 0;

  return {
    ...extract,
    shortlink_expansions: expansions,
    source_links: unique([...(extract.source_links ?? []), ...resolvedUrls]),
    extraction_methods: unique([
      ...(extract.extraction_methods ?? []),
      ...(resolvedAny ? ["shortlink:resolved"] : []),
    ]),
    extraction_warnings: unique([...(extract.extraction_warnings ?? []), ...warnings]),
  };
}

function result(
  sourceUrl: string,
  expandedUrl: string | null,
  finalHost: string | null,
  status: ShortlinkExpansionStatus,
  reason: ShortlinkExpansionReason,
  redirectCount: number,
): ShortlinkExpansion {
  return { sourceUrl, expandedUrl, finalHost, status, reason, redirectCount };
}

function cleanUrl(value: string): string {
  return value.replace(/[.,;:!?]+$/g, "");
}

function safeHostname(value: string): string | null {
  try {
    return new URL(value).hostname || null;
  } catch {
    return null;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

async function requestRedirectResponse(
  url: string,
  addresses: LookupAddress[],
  method: RequestMethod,
  signal: AbortSignal,
  fetcher?: Fetcher,
): Promise<RedirectResponse> {
  if (fetcher) {
    return fetcher(url, { method, redirect: "manual", signal });
  }
  return requestWithPinnedAddresses(url, addresses, method, signal);
}

function requestWithPinnedAddresses(
  rawUrl: string,
  addresses: LookupAddress[],
  method: RequestMethod,
  signal: AbortSignal,
): Promise<RedirectResponse> {
  const url = new URL(rawUrl);
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method,
      lookup: createPinnedLookup(addresses),
      signal,
      headers: { accept: "*/*", "user-agent": "tech-radar-shortlink-resolver/1.0" },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const headers = {
        get(name: string): string | null {
          const value = response.headers[name.toLowerCase()];
          if (Array.isArray(value)) return value[0] ?? null;
          return value ?? null;
        },
      };
      response.destroy();
      resolve({ status, headers });
    });
    request.once("error", reject);
    request.end();
  });
}

export function createPinnedLookup(addresses: LookupAddress[]): LookupFunction {
  const vetted = addresses.map((entry) => ({ ...entry }));
  return (_hostname, options, callback) => {
    const requestedFamily = options.family === 4 || options.family === 6 ? options.family : 0;
    const eligible = requestedFamily ? vetted.filter((entry) => entry.family === requestedFamily) : vetted;
    if (eligible.length === 0) {
      const error = Object.assign(new Error("No vetted address for requested family"), { code: "ENOTFOUND" });
      callback(error, "", 0);
      return;
    }
    if (options.all) {
      callback(null, eligible);
      return;
    }
    callback(null, eligible[0].address, eligible[0].family);
  };
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
