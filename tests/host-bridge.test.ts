// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createObsidianVscodeShim } from "../src/host/obsidian-shim";
import { activateHermesCore } from "../src/host/hermes-core-bridge";
import { computeUnifiedDiffLines } from "../src/views/hermes-diff-view";
import { mountHermesWebview } from "../src/webview/webview-mount";

describe("HermesDiffView line diff computation", () => {
  it("computes added, deleted, and unchanged lines with line numbers", () => {
    const before = "line 1\nold line 2\nline 3\n";
    const after = "line 1\nnew line 2\nadded line\nline 3\n";
    const rows = computeUnifiedDiffLines(before, after);

    expect(rows.some((r) => r.kind === "del" && r.text === "old line 2")).toBe(
      true,
    );
    expect(rows.some((r) => r.kind === "add" && r.text === "new line 2")).toBe(
      true,
    );
    expect(rows.some((r) => r.kind === "add" && r.text === "added line")).toBe(
      true,
    );
    expect(rows.some((r) => r.kind === "ctx" && r.text === "line 1")).toBe(
      true,
    );
  });
});

describe("Hermes Core Host <-> Shadow DOM Svelte 5 Webview Integration", () => {
  it("activates Hermes Studio core, binds the Shadow DOM webview, and exchanges init + panels + context messages", async () => {
    const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-core-vault-"));
    fs.writeFileSync(
      path.join(tmpVault, "Architecture.md"),
      "# Architecture\nDetails here.\n",
      "utf8",
    );

    const shim = createObsidianVscodeShim({
      vaultBasePath: tmpVault,
      vaultName: "CoreTestVault",
      getSettings: () => ({
        path: "/nonexistent/hermes-binary-for-unit-test",
        environment: {},
        autoStart: false,
        notifications: "all",
      }),
      resolveWikiLink: (link) =>
        link === "Architecture" ? "Architecture.md" : undefined,
    });

    const core = activateHermesCore({
      vscodeShim: shim,
      extensionPath: tmpVault,
      resolvePromptWikiLinks: (text) =>
        text.includes("[[Architecture]]") ? ["Architecture.md"] : [],
    });

    const provider = shim._internal.getWebviewViewProvider();
    expect(provider).toBeDefined();

    // Mount real Shadow DOM Svelte 5 webview and connect to provider.resolveWebviewView
    const hostEl = document.createElement("div");
    document.body.appendChild(hostEl);
    const shadowRoot = hostEl.attachShadow({ mode: "open" });

    const hostToWebviewMessages: any[] = [];
    let webviewReceiveCallback: ((msg: any) => void) | undefined;
    let mounted: ReturnType<typeof mountHermesWebview> | undefined;

    const fakeWebviewView = {
      visible: true,
      badge: undefined as any,
      webview: {
        options: {},
        html: "",
        cspSource: "self",
        asWebviewUri: (u: any) => u,
        onDidReceiveMessage: (cb: (msg: any) => void) => {
          webviewReceiveCallback = cb;
          return { dispose() {} };
        },
        postMessage: async (msg: any) => {
          hostToWebviewMessages.push(msg);
          mounted?.postMessageToWebview(msg);
          return true;
        },
      },
      onDidChangeVisibility: () => ({ dispose() {} }),
      onDidDispose: () => ({ dispose() {} }),
    };

    provider.resolveWebviewView(fakeWebviewView);

    mounted = mountHermesWebview({
      shadowRoot,
      place: "side",
      onMessageFromWebview: (msg) => {
        webviewReceiveCallback?.(msg);
      },
    });

    // Wait for async panel loading and initial messages
    await new Promise((r) => setTimeout(r, 80));

    const msgTypes = new Set(hostToWebviewMessages.map((m) => m.type));
    expect(msgTypes.has("chatPlace")).toBe(true);
    expect(msgTypes.has("init")).toBe(true);
    expect(msgTypes.has("context")).toBe(true);
    expect(msgTypes.has("accountUsage")).toBe(true);
    expect(msgTypes.has("effort")).toBe(true);
    expect(msgTypes.has("background")).toBe(true);

    // Verify mentioning a file adds a context chip
    webviewReceiveCallback?.({ type: "mentionFile", path: "Architecture.md" });
    await new Promise((r) => setTimeout(r, 40));

    const ctxMsgs = hostToWebviewMessages.filter((m) => m.type === "context");
    const lastCtx = ctxMsgs.at(-1);
    expect(lastCtx?.items?.some((item: any) => item.label === "Architecture.md")).toBe(
      true,
    );

    mounted.destroy();
    await core.deactivate();
    hostEl.remove();
    fs.rmSync(tmpVault, { recursive: true, force: true });
  });
});
