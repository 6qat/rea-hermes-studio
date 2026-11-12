// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mountHermesWebview } from "../src/webview/webview-mount";

describe("Terminal tab", () => {
  it("sits beside the other Hermes tabs and opens the terminal layer", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
      }),
    });

    const hostEl = document.createElement("div");
    document.body.appendChild(hostEl);
    const shadowRoot = hostEl.attachShadow({ mode: "open" });
    const receivedByHost: Array<{ type?: string }> = [];

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
          models: [],
          modes: [],
          skills: [],
          folder: "Main_Vault",
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const tabs = [...shadowRoot.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.id)).toEqual([
      "hs-tab-chat",
      "hs-tab-learning",
      "hs-tab-memory",
      "hs-tab-capabilities",
      "hs-tab-agents",
      "hs-tab-terminal",
    ]);
    const terminal = tabs.at(-1);
    expect(terminal?.textContent).toContain("Terminal");

    terminal?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(terminal?.getAttribute("aria-selected")).toBe("true");
    const layer = shadowRoot.querySelector("#hermes-terminal-layer");
    expect(layer?.classList.contains("is-active")).toBe(true);
    expect(shadowRoot.querySelector("#hs-terminal-marker")).not.toBeNull();
    expect(shadowRoot.textContent).not.toContain("Reading Hermes's files");

    shadowRoot.querySelector<HTMLElement>("#hs-tab-chat")?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(layer?.classList.contains("is-active")).toBe(false);
    expect(receivedByHost.some((msg) => msg.type === "terminal:open")).toBe(true);

    instance.destroy();
    hostEl.remove();
  });
});
