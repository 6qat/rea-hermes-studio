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
    expect(terminal?.querySelector("path")?.getAttribute("d")).toBe("M3 4.5l4 3.5-4 3.5M9 12h4");

    instance.postMessageToWebview({ type: "terminal:fontSize", size: 18 });

    terminal?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(terminal?.getAttribute("aria-selected")).toBe("true");
    const layer = shadowRoot.querySelector<HTMLElement>("#hermes-terminal-layer");
    expect(layer?.classList.contains("is-active")).toBe(true);
    expect(layer?.style.fontSize).toBe("18px");
    expect(shadowRoot.querySelector("#hs-terminal-marker")).not.toBeNull();
    expect(shadowRoot.textContent).not.toContain("Reading Hermes's files");

    instance.postMessageToWebview({ type: "terminal:fontSize", size: 20 });
    expect(layer?.style.fontSize).toBe("20px");

    const chat = shadowRoot.querySelector<HTMLElement>("#hs-tab-chat");
    chat?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(layer?.classList.contains("is-active")).toBe(false);
    expect(receivedByHost.filter((msg) => msg.type === "terminal:open")).toHaveLength(1);

    terminal?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(receivedByHost.filter((msg) => msg.type === "terminal:open")).toHaveLength(1);

    instance.postMessageToWebview({ type: "terminal:error", message: "python3 is missing" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(terminal?.getAttribute("aria-selected")).toBe("true");
    expect(layer?.textContent).toContain("python3 is missing");

    instance.postMessageToWebview({ type: "terminal:exit", code: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(chat?.getAttribute("aria-selected")).toBe("true");
    expect(layer?.classList.contains("is-active")).toBe(false);

    terminal?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(terminal?.getAttribute("aria-selected")).toBe("true");
    expect(receivedByHost.filter((msg) => msg.type === "terminal:open")).toHaveLength(2);

    instance.destroy();
    hostEl.remove();
  });
});
