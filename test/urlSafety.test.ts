import { beforeEach, describe, expect, it, vi } from "vitest";
import * as dns from "node:dns/promises";

vi.mock("node:dns/promises");

describe("URL safety resolution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the exact vetted addresses for connection pinning", async () => {
    vi.mocked(dns.lookup).mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ] as any);
    const { resolvePublicHttpUrl } = await import("../src/urlSafety.js");

    const resolution = await resolvePublicHttpUrl("https://example.com/tool");

    expect(resolution?.addresses).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
  });

  it("pins socket lookup to vetted addresses without resolving the hostname again", async () => {
    const { createPinnedLookup } = await import("../src/shortlinks.js");
    const lookup = createPinnedLookup([{ address: "93.184.216.34", family: 4 }]);

    const address = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      lookup("attacker.example", { all: false }, (error, value, family) => {
        if (error) return reject(error);
        if (typeof value !== "string") return reject(new Error("expected one address"));
        resolve({ address: value, family: family ?? 0 });
      });
    });

    expect(address).toEqual({ address: "93.184.216.34", family: 4 });
    expect(dns.lookup).not.toHaveBeenCalled();
  });
});
