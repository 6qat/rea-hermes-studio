// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { attachVaultLinkContextMenu } from "../src/webview/vault-link-context-menu";

function mount() {
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  const root = document.createElement("div");
  const vault = document.createElement("a");
  vault.setAttribute("data-href", "wikilink://AI%2FAI.md");
  vault.textContent = "AI";
  const external = document.createElement("a");
  external.setAttribute("data-href", "https://example.com");
  external.textContent = "Example";
  root.append(vault, external);
  shadow.append(root);
  document.body.append(host);
  const postMessage = vi.fn();
  const dispose = attachVaultLinkContextMenu(root, postMessage);
  return { root, vault, external, postMessage, dispose };
}

describe("attachVaultLinkContextMenu", () => {
  it("opens a new-tab item for a vault link and posts openLink", () => {
    const { root, vault, postMessage, dispose } = mount();

    vault.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 24 }),
    );

    const item = root.querySelector("button");
    expect(item?.textContent).toBe("Open in new tab");
    item?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(postMessage).toHaveBeenCalledWith({
      type: "openLink",
      href: "wikilink://AI%2FAI.md",
      newTab: true,
    });
    expect(root.querySelector("button")).toBeNull();
    dispose();
  });

  it("leaves https links to the browser menu", () => {
    const { root, external, postMessage, dispose } = mount();
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });

    external.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(root.querySelector("button")).toBeNull();
    expect(postMessage).not.toHaveBeenCalled();
    dispose();
  });

  it("opens a new tab for a vault file path rendered as code", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const root = document.createElement("div");
    const code = document.createElement("code");
    code.className = "md-path is-file";
    code.dataset.path = "AI/AI.md";
    code.dataset.line = "4";
    code.textContent = "AI/AI.md:4";
    root.append(code);
    shadow.append(root);
    document.body.append(host);
    const postMessage = vi.fn();
    const dispose = attachVaultLinkContextMenu(root, postMessage);

    code.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    root.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(postMessage).toHaveBeenCalledWith({
      type: "openFile",
      path: "AI/AI.md",
      line: 4,
      newTab: true,
    });
    dispose();
  });

  it("does not intercept a left click", () => {
    const { vault, postMessage, dispose } = mount();

    vault.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(postMessage).not.toHaveBeenCalled();
    dispose();
  });
});
