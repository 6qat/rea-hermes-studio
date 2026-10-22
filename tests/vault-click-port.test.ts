import { describe, expect, it, vi } from "vitest";
import { resolveVaultClick, type VaultClickRouter } from "../src/host/vault-click-port";

function router(overrides: Partial<VaultClickRouter> = {}): VaultClickRouter {
  return {
    isPathKnown: () => false,
    routeUri: async () => false,
    ...overrides,
  };
}

describe("resolveVaultClick", () => {
  it("answers checkPaths and does not forward", async () => {
    const known = vi.fn((p: string) => p === "Note.md");
    const routeUri = vi.fn(async () => true);
    const resolution = await resolveVaultClick(
      { type: "checkPaths", paths: ["Note.md", "missing", 3] },
      router({ isPathKnown: known, routeUri }),
    );

    expect(resolution).toEqual({
      disposition: "handled",
      reply: { type: "paths", known: { "Note.md": true, missing: false } },
    });
    expect(routeUri).not.toHaveBeenCalled();
  });

  it("handles an openFile the router can open", async () => {
    const routeUri = vi.fn(async () => true);
    const resolution = await resolveVaultClick(
      { type: "openFile", path: "Note.md", line: 4 },
      router({ routeUri }),
    );

    expect(resolution).toEqual({ disposition: "handled" });
    expect(routeUri).toHaveBeenCalledWith("Note.md", {
      selection: { startLine: 4, endLine: 4 },
    });
  });

  it("forwards an openFile the router cannot open", async () => {
    const resolution = await resolveVaultClick(
      { type: "openFile", path: "gone.md" },
      router({ routeUri: async () => false }),
    );
    expect(resolution).toEqual({ disposition: "forward" });
  });

  it("handles vault schemes and relative links, and forwards http without routing", async () => {
    const routeUri = vi.fn(async (href: string) => href.startsWith("wikilink://"));
    const clickRouter = router({ routeUri });

    expect(
      await resolveVaultClick({ type: "openLink", href: "wikilink://Note" }, clickRouter),
    ).toEqual({ disposition: "handled" });
    expect(
      await resolveVaultClick({ type: "openLink", href: "obsidian://open?file=Note" }, clickRouter),
    ).toEqual({ disposition: "forward" });
    expect(await resolveVaultClick({ type: "openLink", href: "Note.md" }, clickRouter)).toEqual({
      disposition: "forward",
    });

    routeUri.mockClear();
    expect(
      await resolveVaultClick({ type: "openLink", href: "https://example.com" }, clickRouter),
    ).toEqual({ disposition: "forward" });
    expect(routeUri).not.toHaveBeenCalled();
  });

  it("forwards messages that are not vault navigation", async () => {
    const routeUri = vi.fn(async () => true);
    const resolution = await resolveVaultClick({ type: "ready" }, router({ routeUri }));
    expect(resolution).toEqual({ disposition: "forward" });
    expect(routeUri).not.toHaveBeenCalled();
  });
});
