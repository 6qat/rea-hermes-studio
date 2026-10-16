import { HERMES_WEBVIEW_BASE_CSS, THEME_BRIDGE_CSS } from "./theme-bridge";
import { createHermesWebviewInstance } from "./webview-runtime.js";

export interface HermesWebviewMountOptions {
  shadowRoot: ShadowRoot;
  place: "side" | "editor";
  onMessageFromWebview: (msg: any) => void;
  getState?: () => any;
  setState?: (state: any) => void;
}

export interface HermesWebviewMounted {
  postMessageToWebview: (msg: any) => void;
  destroy: () => void;
  rootEl: HTMLElement;
  appEl: HTMLElement;
}

/**
 * Extracts dropped file URIs, Obsidian `obsidian://open?...` URIs, and
 * `[[WikiLink]]` references from a text/uri-list or text/plain drop payload.
 */
export function extractDroppedFileUris(raw: string): string[] {
  const results: string[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // 1. Standard URI (file://, obsidian://, etc.)
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(line)) {
      results.push(line);
      continue;
    }

    // 2. Obsidian [[WikiLink]] or ![[Embed]]
    const wikiMatch = /^!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/.exec(line);
    if (wikiMatch && wikiMatch[1]?.trim()) {
      results.push(`wikilink://${wikiMatch[1].trim()}`);
      continue;
    }
  }
  return results;
}

export function mountHermesWebview(
  options: HermesWebviewMountOptions,
): HermesWebviewMounted {
  if (typeof globalThis.ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  const { shadowRoot, place, onMessageFromWebview } = options;
  const doc = shadowRoot.ownerDocument || document;

  // Clear any existing content inside shadowRoot
  shadowRoot.innerHTML = "";

  // 1. Inject Theme Bridge CSS + Hermes Studio Tailwind v4 Base CSS
  const styleEl = doc.createElement("style");
  styleEl.textContent = `${THEME_BRIDGE_CSS}\n${HERMES_WEBVIEW_BASE_CSS}`;
  shadowRoot.appendChild(styleEl);

  // 2. Create #hermes-studio-root (replaces <body data-place="...">) and #app
  const rootEl = doc.createElement("div");
  rootEl.id = "hermes-studio-root";
  rootEl.setAttribute("data-place", place);

  const appEl = doc.createElement("div");
  appEl.id = "app";
  rootEl.appendChild(appEl);
  shadowRoot.appendChild(rootEl);

  // 3. Setup scoped host <-> webview message channel & state persistence
  let internalState: any = options.getState ? options.getState() : undefined;
  const hostMessageListeners = new Set<(msg: any) => void>();

  const vscodeApi = {
    postMessage(msg: any) {
      onMessageFromWebview(msg);
    },
    getState() {
      return options.getState ? options.getState() : internalState;
    },
    setState(next: any) {
      internalState = next;
      options.setState?.(next);
    },
  };

  const runtime = createHermesWebviewInstance({
    vscodeApi,
    root: shadowRoot,
    appEl,
    extractDroppedFileUris,
    onHostMessage(listener: (msg: any) => void) {
      hostMessageListeners.add(listener);
      return () => hostMessageListeners.delete(listener);
    },
  });

  return {
    rootEl,
    appEl,
    postMessageToWebview(msg: any) {
      if (typeof msg === "object" && msg && typeof msg.type === "string") {
        for (const listener of hostMessageListeners) {
          listener(msg);
        }
      }
    },
    destroy() {
      hostMessageListeners.clear();
      runtime?.unmount?.();
      shadowRoot.innerHTML = "";
    },
  };
}
