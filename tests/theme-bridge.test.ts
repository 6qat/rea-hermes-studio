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
      "file:///workspace/Vault/Note.md",
      "obsidian://open?vault=Main_Vault&file=Folder%2FSubnote.md",
      "[[Project Plan]]",
    ].join("\n");

    const extracted = extractDroppedFileUris(raw);
    expect(extracted).toEqual([
      "file:///workspace/Vault/Note.md",
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

    // Verify the New chat (+) icon button in the Chat header bar emits { type: "newChat" }
    const newChatBtn = shadowRoot.querySelector<HTMLButtonElement>(
      'header button[aria-label="New chat"]',
    );
    expect(newChatBtn).not.toBeNull();
    newChatBtn!.click();
    expect(receivedByHost.some((m) => m.type === "newChat")).toBe(true);

    // 3. Host updates model with user message item
    let clipboardText = "";
    Object.assign(navigator, {
      clipboard: {
        writeText: async (t: string) => {
          clipboardText = t;
          return true;
        },
      },
    });

    instance.postMessageToWebview({
      type: "init",
      model: {
        items: [
          {
            id: "1",
            kind: "user",
            text: "list todas as notas alteradas ou criadas hoje",
            turn: 1,
          },
        ],
        meta: {
          connection: { state: "ready" },
          busy: false,
          turn: 1,
          queued: [],
          models: [],
          model: "anthropic/claude-sonnet-4",
          modes: [],
          skills: [],
          folder: "Main_Vault",
        },
      },
    });

    await new Promise((r) => setTimeout(r, 40));

    // Verify user message bubble has copy button
    const userCopyBtn = shadowRoot.querySelector<HTMLButtonElement>(
      '.user-copy-btn, button[aria-label="Copy prompt"]',
    );
    expect(userCopyBtn).not.toBeNull();
    expect(userCopyBtn!.textContent).toContain("Copy");

    // Click user copy button and verify clipboard copy and feedback state
    userCopyBtn!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(clipboardText).toBe("list todas as notas alteradas ou criadas hoje");
    expect(userCopyBtn!.textContent).toContain("Copied");

    instance.destroy();
    hostEl.remove();
  });

  it("opens the mode and effort combobox popover and renders dynamic effort levels", async () => {
    const hostEl = document.createElement("div");
    document.body.appendChild(hostEl);
    const shadowRoot = hostEl.attachShadow({ mode: "open" });

    const receivedByHost: any[] = [];
    const instance = mountHermesWebview({
      shadowRoot,
      place: "side",
      onMessageFromWebview: (msg) => {
        receivedByHost.push(msg);
      },
    });

    instance.postMessageToWebview({
      type: "init",
      model: {
        items: [],
        meta: {
          connection: { state: "ready" },
          busy: false,
          turn: 0,
          queued: [],
          models: [{ id: "moonshot/kimi-k3", label: "Kimi K3" }],
          model: "moonshot/kimi-k3",
          modes: [
            { id: "default", name: "Manual" },
            { id: "accept_edits", name: "Edit Automatically" },
            { id: "dont_ask", name: "Auto" },
          ],
          mode: "default",
          skills: [],
          folder: "Main_Vault",
        },
      },
    });

    instance.postMessageToWebview({
      type: "effort",
      effort: {
        value: "high",
        supported: true,
        levels: [
          { id: "low", label: "Low" },
          { id: "high", label: "High" },
          { id: "max", label: "Max" },
        ],
      },
    });

    await new Promise((r) => setTimeout(r, 40));

    // Find the Mode and effort combobox button in composer
    const modeBtn = shadowRoot.querySelector<HTMLButtonElement>(
      'button[aria-label^="Mode and effort:"]',
    );
    expect(modeBtn).not.toBeNull();

    // Click to open the combobox menu
    modeBtn!.click();
    await new Promise((r) => setTimeout(r, 40));

    // Verify the popover opened and contains the 3 modes
    const modeOptions = shadowRoot.querySelectorAll('[role="menuitemcheckbox"], [aria-checked]');
    expect(modeOptions.length).toBeGreaterThanOrEqual(3);

    // Verify the effort slider is rendered inside the popover without crashing
    const slider = shadowRoot.querySelector<HTMLElement>('[role="slider"][aria-label="Effort"]');
    expect(slider).not.toBeNull();
    expect(slider!.getAttribute("aria-valuemax")).toBe("3");
    expect(slider!.getAttribute("aria-valuenow")).toBe("2"); // 'high' is index 2 in [low, high, max]

    // Verify 3 stop marks and 3 stop labels are rendered
    const stopDots = slider!.querySelectorAll(".effort-stop");
    expect(stopDots.length).toBe(3);

    instance.destroy();
    hostEl.remove();
  });
});
