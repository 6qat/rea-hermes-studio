import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import xtermCss from "@xterm/xterm/css/xterm.css";

export type TerminalClientMessage =
  | { type: "terminal:open"; cols: number; rows: number }
  | { type: "terminal:input"; data: string }
  | { type: "terminal:resize"; cols: number; rows: number }
  | { type: "terminal:restart" };

export function clampTerminalFontSize(value: unknown): number {
  const num = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(num)) return 13;
  return Math.min(32, Math.max(8, Math.round(num)));
}

export function isTerminalClientMessage(msg: unknown): msg is TerminalClientMessage {
  if (!msg || typeof msg !== "object") return false;
  const type = (msg as { type?: unknown }).type;
  return (
    type === "terminal:open" ||
    type === "terminal:input" ||
    type === "terminal:resize" ||
    type === "terminal:restart"
  );
}

export interface TerminalPanel {
  destroy(): void;
}

export function attachTerminalPanel(options: {
  rootEl: HTMLElement;
  postMessage: (msg: TerminalClientMessage) => void;
  onHostMessage: (listener: (msg: unknown) => void) => () => void;
}): TerminalPanel {
  const doc = options.rootEl.ownerDocument;
  injectXtermCss(options.rootEl, xtermCss);

  const layer = doc.createElement("div");
  layer.id = "hermes-terminal-layer";
  layer.setAttribute("aria-hidden", "true");
  options.rootEl.appendChild(layer);

  let term: Terminal | undefined;
  let fit: FitAddon | undefined;
  let announced = false;
  let exited = false;
  let termFailed = false;
  let fontSize = 13;
  const pending: Array<(terminal: Terminal) => void> = [];

  const resizeObserver = new ResizeObserver(() => {
    placeLayer();
    refit();
  });
  resizeObserver.observe(options.rootEl);

  function placeLayer(): void {
    const tablist = options.rootEl.querySelector<HTMLElement>('[role="tablist"]');
    if (!tablist) {
      layer.style.top = "0px";
      return;
    }
    const rootRect = options.rootEl.getBoundingClientRect();
    const tabRect = tablist.getBoundingClientRect();
    const measured = tabRect.bottom - rootRect.top;
    const fallback = tablist.offsetTop + tablist.offsetHeight;
    const top = measured > 0 ? measured : fallback;
    layer.style.top = `${Math.max(0, top)}px`;
  }

  function writeToTerm(fn: (terminal: Terminal) => void): void {
    if (term) fn(term);
    else pending.push(fn);
  }

  function flushPending(): void {
    if (!term) return;
    for (const fn of pending.splice(0)) fn(term);
  }

  function refit(): void {
    if (!term || !fit || !layer.classList.contains("is-active")) return;
    if (layer.clientWidth < 2 || layer.clientHeight < 2) return;
    try {
      fit.fit();
    } catch {
      return;
    }
    if (announced) return;
    announced = true;
    options.postMessage({
      type: "terminal:open",
      cols: term.cols || 80,
      rows: term.rows || 24,
    });
  }

  function applyFontSize(value: unknown): void {
    fontSize = clampTerminalFontSize(value);
    layer.style.fontSize = `${fontSize}px`;
    if (!term) return;
    term.options.fontSize = fontSize;
    refit();
  }

  function ensureTerm(): void {
    if (term || termFailed) return;
    try {
      const style = doc.defaultView?.getComputedStyle(layer);
      const terminal = new Terminal({
        cursorBlink: true,
        fontFamily: style?.fontFamily || "monospace",
        fontSize,
        scrollback: 10000,
        theme: {
          background: style?.backgroundColor || "#0b0f19",
          foreground: style?.color || "#e2e8f0",
          cursor: style?.color || "#e2e8f0",
        },
      });
      const addon = new FitAddon();
      terminal.loadAddon(addon);
      terminal.open(layer);
      terminal.onData((data) => {
        if (exited) return;
        options.postMessage({ type: "terminal:input", data });
      });
      terminal.onResize(({ cols, rows }) => {
        if (!announced || !layer.classList.contains("is-active")) return;
        options.postMessage({ type: "terminal:resize", cols, rows });
      });
      terminal.attachCustomKeyEventHandler((event) => handleKey(terminal, event));
      term = terminal;
      fit = addon;
      flushPending();
    } catch (error) {
      termFailed = true;
      layer.textContent = error instanceof Error ? error.message : "Could not open the terminal.";
    }
  }

  function handleKey(terminal: Terminal, event: KeyboardEvent): boolean {
    if (event.type !== "keydown") return true;
    if (exited) {
      if (isBareModifier(event)) return false;
      exited = false;
      options.postMessage({ type: "terminal:restart" });
      event.preventDefault();
      return false;
    }
    const key = event.key.toLowerCase();
    if (key === "c" && usesAccel(event) && (event.shiftKey || terminal.hasSelection())) {
      const text = terminal.getSelection();
      if (text) void navigator.clipboard?.writeText(text);
      event.preventDefault();
      return false;
    }
    if (key === "v" && usesAccel(event)) {
      event.preventDefault();
      void pasteClipboard(terminal);
      return false;
    }
    return true;
  }

  async function pasteClipboard(terminal: Terminal): Promise<void> {
    try {
      const text = await navigator.clipboard?.readText();
      if (!text || exited || term !== terminal) return;
      terminal.paste(text);
    } catch {
      // The host did not grant clipboard reads.
    }
  }

  function show(): void {
    layer.classList.add("is-active");
    layer.setAttribute("aria-hidden", "false");
    placeLayer();
    ensureTerm();
    refit();
    if (!announced && term) {
      announced = true;
      options.postMessage({
        type: "terminal:open",
        cols: term.cols || 80,
        rows: term.rows || 24,
      });
    }
    doc.defaultView?.requestAnimationFrame(() => {
      placeLayer();
      refit();
      term?.focus();
    });
  }

  function hide(): void {
    layer.classList.remove("is-active");
    layer.setAttribute("aria-hidden", "true");
    term?.blur();
  }

  function syncTab(active: boolean): void {
    if (active) show();
    else hide();
  }

  const stopWatchingTab = watchTerminalTab(options.rootEl, syncTab);
  const stopHost = options.onHostMessage((msg) => {
    if (!msg || typeof msg !== "object") return;
    const type = (msg as { type?: unknown }).type;
    if (type === "terminal:data") {
      exited = false;
      const data = (msg as { data?: unknown }).data;
      if (typeof data === "string" || data instanceof Uint8Array) {
        writeToTerm((terminal) => terminal.write(data));
      }
      return;
    }
    if (type === "terminal:fontSize") {
      applyFontSize((msg as { size?: unknown }).size);
      return;
    }
    if (type === "terminal:exit") {
      exited = false;
      announced = false;
      try {
        term?.reset();
      } catch {
        // The buffer can fail to reset in a headless document. The next open still starts clean.
      }
      options.rootEl.querySelector<HTMLElement>("#hs-tab-chat")?.click();
      return;
    }
    if (type === "terminal:error") {
      exited = true;
      const message = (msg as { message?: unknown }).message;
      const text = typeof message === "string" ? message : "The terminal stopped.";
      writeToTerm((terminal) => terminal.write(`\r\n${text}\r\n`));
    }
  });

  return {
    destroy() {
      stopWatchingTab();
      stopHost();
      resizeObserver.disconnect();
      term?.dispose();
      term = undefined;
      layer.remove();
    },
  };
}

function injectXtermCss(root: HTMLElement, css: string): void {
  const shadow = root.getRootNode();
  if (!(shadow instanceof ShadowRoot)) return;
  if (shadow.querySelector("style[data-xterm-css]")) return;
  const style = root.ownerDocument.createElement("style");
  style.dataset.xtermCss = "true";
  style.textContent = typeof css === "string" ? css : "";
  shadow.appendChild(style);
}

function watchTerminalTab(root: HTMLElement, onChange: (active: boolean) => void): () => void {
  let tab: Element | null = null;
  let attrObserver: MutationObserver | undefined;

  const bind = () => {
    const next = root.querySelector("#hs-tab-terminal");
    if (next === tab) return;
    attrObserver?.disconnect();
    tab = next;
    if (!tab) return;
    attrObserver = new MutationObserver(() => {
      onChange(tab?.getAttribute("aria-selected") === "true");
    });
    attrObserver.observe(tab, { attributes: true, attributeFilter: ["aria-selected"] });
    onChange(tab.getAttribute("aria-selected") === "true");
  };

  bind();
  const tree = new MutationObserver(bind);
  tree.observe(root, { childList: true, subtree: true });
  return () => {
    tree.disconnect();
    attrObserver?.disconnect();
  };
}

function usesAccel(event: KeyboardEvent): boolean {
  if (event.altKey) return false;
  if (event.metaKey) return !event.ctrlKey;
  return event.ctrlKey && !event.metaKey;
}

function isBareModifier(event: KeyboardEvent): boolean {
  return (
    event.key === "Shift" || event.key === "Control" || event.key === "Alt" || event.key === "Meta"
  );
}
