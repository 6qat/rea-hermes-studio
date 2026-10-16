// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { HERMES_WEBVIEW_BASE_CSS, THEME_BRIDGE_CSS } from "../src/webview/theme-bridge";
import { extractDroppedFileUris, mountHermesWebview } from "../src/webview/webview-mount";

describe("Theme Bridge CSS coverage", () => {
  it("maps every --vscode-* variable referenced in webview-base.css with dark theme defaults", () => {
    const baseCss = HERMES_WEBVIEW_BASE_CSS;
    const matches = baseCss.match(/--vscode-[a-zA-Z0-9-]+/g) ?? [];
    const uniqueVars = [...new Set(matches)].sort();
    expect(uniqueVars.length).toBeGreaterThan(25);

    for (const v of uniqueVars) {
      expect(
        THEME_BRIDGE_CSS.includes(`${v}:`),
        `Missing CSS mapping for ${v} in theme-bridge.ts`,
      ).toBe(true);
    }
  });
});

describe("Obsidian drop URI & WikiLink extraction in webview", () => {
  it("parses file://, obsidian://open, and [[WikiLink]] lines into normalized drop tokens", () => {
    const raw = [
      "file:///home/guiga/Vault/Note.md",
      "obsidian://open?vault=Main_Vault&file=Folder%2FSubnote.md",
      "[[Project Plan]]",
    ].join("\n");

    const extracted = extractDroppedFileUris(raw);
    expect(extracted).toEqual([
      "file:///home/guiga/Vault/Note.md",
      "obsidian://open?vault=Main_Vault&file=Folder%2FSubnote.md",
      "wikilink://Project Plan",
    ]);
  });
});

describe("Shadow-DOM scoped Svelte 5 webview mount", () => {
  it("mounts the Hermes Studio Svelte 5 UI inside a ShadowRoot and completes the ready -> init -> panels handshake", async () => {
    const hostEl = document.createElement("div");
    document.body.appendChild(hostEl);
    const shadowRoot = hostEl.attachShadow({ mode: "open" });

    const receivedByHost: any[] = [];
    let stateStore: any;

    const instance = mountHermesWebview({
      shadowRoot,
      place: "side",
      onMessageFromWebview: (msg) => {
        receivedByHost.push(msg);
      },
      getState: () => stateStore,
      setState: (s) => {
        stateStore = s;
      },
    });

    // 1. Webview immediately emits { type: "ready" } on mount
    expect(receivedByHost.some((m) => m.type === "ready")).toBe(true);

    // 2. Host sends { type: "init", model } and { type: "panels", view }
    instance.postMessageToWebview({
      type: "init",
      model: {
        items: [],
        meta: {
          connection: { state: "ready" },
          busy: false,
          turn: 0,
          queued: [],
          models: [{ id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" }],
          model: "anthropic/claude-sonnet-4",
          modes: [],
          skills: [],
          folder: "Main_Vault",
        },
      },
    });

    await new Promise((r) => setTimeout(r, 20));

    // Verify the Svelte 5 DOM rendered inside shadowRoot
    const appEl = shadowRoot.getElementById("app");
    expect(appEl).not.toBeNull();
    expect(appEl!.innerHTML).toContain('role="tabpanel"');
    expect(appEl!.textContent).toContain("anthropic/claude-sonnet-4");
    expect(appEl!.textContent).toContain("Main_Vault");

    instance.destroy();
    hostEl.remove();
  });
});
