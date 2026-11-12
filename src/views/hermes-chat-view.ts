import { ItemView, Menu, type WorkspaceLeaf } from "obsidian";
import {
  createIntegratedTerminal,
  defaultTerminalShell,
  type IntegratedTerminal,
} from "../host/integrated-terminal";
import { SimpleEventEmitter, type SimpleUri } from "../host/obsidian-shim";
import { resolveVaultClick } from "../host/vault-click-port";
import type HermesStudioPlugin from "../main";
import {
  clampTerminalFontSize,
  isTerminalClientMessage,
  type TerminalClientMessage,
} from "../webview/terminal-panel";
import { type HermesWebviewMounted, mountHermesWebview } from "../webview/webview-mount";
import { type DiffViewPayload, renderDiffIntoContainer } from "./hermes-diff-view";

export const HERMES_SIDE_VIEW_TYPE = "hermes-studio-side-view";
export const HERMES_EDITOR_VIEW_TYPE = "hermes-studio-editor-view";
export const HERMES_DIFF_VIEW_TYPE = "hermes-studio-diff-view";

export class HermesStudioView extends ItemView {
  private mounted: HermesWebviewMounted | undefined;
  private terminal: IntegratedTerminal | undefined;
  private receiveEmitter = new SimpleEventEmitter<any>();
  private visibilityEmitter = new SimpleEventEmitter<void>();
  private disposeEmitter = new SimpleEventEmitter<void>();
  private isViewVisible = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: HermesStudioPlugin,
    public readonly place: "side" | "editor",
  ) {
    super(leaf);
  }

  getViewType(): string {
    return this.place === "side" ? HERMES_SIDE_VIEW_TYPE : HERMES_EDITOR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Hermes Studio";
  }

  getIcon(): string {
    return "hermes-studio";
  }

  async onOpen(): Promise<void> {
    this.isViewVisible = true;
    if (typeof this.contentEl.empty === "function") {
      this.contentEl.empty();
    } else {
      while (this.contentEl.firstChild) {
        this.contentEl.removeChild(this.contentEl.firstChild);
      }
    }
    this.contentEl.classList.add("hermes-studio-view-content", "hermes-chat-content");

    this.mountShadowUi();

    // Handle Obsidian popout window migration cleanly (matching Obsidian Copilot)
    if (typeof (this.containerEl as any).onWindowMigrated === "function") {
      this.register(
        (this.containerEl as any).onWindowMigrated(() => {
          this.mountShadowUi();
        }),
      );
    }

    // Bind to Hermes Studio host controller
    this.plugin.attachHermesView(this);
  }

  private mountShadowUi(): void {
    this.mounted?.destroy();
    const shadowRoot = this.contentEl.shadowRoot ?? this.contentEl.attachShadow({ mode: "open" });

    this.mounted = mountHermesWebview({
      shadowRoot,
      place: this.place,
      onMessageFromWebview: async (msg) => {
        if (isTerminalClientMessage(msg)) {
          this.handleTerminalMessage(msg);
          return;
        }
        const resolution = await resolveVaultClick(msg, this.plugin.router);
        if (resolution.reply) this.mounted?.postMessageToWebview(resolution.reply);
        if (resolution.disposition === "handled") return;
        this.receiveEmitter.fire(msg);
      },
      getState: () => this.plugin.settings.webviewState,
      setState: (state) => {
        this.plugin.settings.webviewState = state;
        void this.plugin.saveData(this.plugin.settings);
      },
      linkifyVaultText: (text) => this.plugin.linkifyVaultReferences(text),
      isVaultPathKnown: (p) => this.plugin.isVaultPathKnown(p),
      showContextMenu: (event, run) => {
        const menu = new Menu();
        menu.addItem((item) => {
          item.setTitle("Open in new tab");
          item.onClick(() => run());
        });
        menu.showAtMouseEvent(event);
      },
    });

    // Support direct drag-and-drop of Obsidian notes from File Explorer without requiring Shift
    this.setupObsidianDropBridge(this.mounted.rootEl);
    this.applyTerminalFontSize();
  }

  applyTerminalFontSize(): void {
    this.mounted?.postMessageToWebview({
      type: "terminal:fontSize",
      size: clampTerminalFontSize(this.plugin.settings.terminalFontSize),
    });
  }

  private setupObsidianDropBridge(rootEl: HTMLElement): void {
    rootEl.addEventListener("dragover", (e) => {
      if (
        e.dataTransfer?.types.includes("text/plain") ||
        e.dataTransfer?.types.includes("text/uri-list")
      ) {
        e.preventDefault();
      }
    });

    rootEl.addEventListener("drop", (e) => {
      if (e.defaultPrevented) return;
      const text =
        e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain") || "";
      if (text.includes("obsidian://") || text.includes("[[")) {
        e.preventDefault();
        const uris = text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        if (uris.length > 0) {
          this.receiveEmitter.fire({ type: "dropUris", uris });
        }
      }
    });
  }

  /**
   * Produces a VSCode WebviewView / WebviewPanel compatible adapter consumed by `nr` in hermes-core.js.
   */
  toVscodeWebviewAdapter(): any {
    const self = this;
    let badgeVal: { value: number; tooltip: string } | undefined;

    return {
      get visible() {
        return self.isViewVisible;
      },
      get badge() {
        return badgeVal;
      },
      set badge(val: { value: number; tooltip: string } | undefined) {
        badgeVal = val;
        self.plugin.updateRibbonBadge(val?.value ?? 0, val?.tooltip ?? "");
      },
      iconPath: undefined as any,
      webview: {
        options: {},
        html: "",
        cspSource: "self",
        asWebviewUri: (u: SimpleUri) => u,
        onDidReceiveMessage: (cb: (msg: any) => void) => self.receiveEmitter.event(cb),
        postMessage: async (msg: any) => {
          self.mounted?.postMessageToWebview(msg);
          return true;
        },
      },
      reveal: () => {
        this.app.workspace.revealLeaf?.(this.leaf);
      },
      onDidChangeVisibility: (cb: () => void) => self.visibilityEmitter.event(cb),
      onDidChangeViewState: (cb: () => void) => self.visibilityEmitter.event(cb),
      onDidDispose: (cb: () => void) => self.disposeEmitter.event(cb),
      dispose: () => {
        this.leaf?.detach?.();
      },
    };
  }

  /**
   * Re-emits { type: "ready" } after `nr.attach()` registers its message listener.
   */
  notifyReady(): void {
    this.receiveEmitter.fire({ type: "ready" });
  }

  notifyAddContext(kind: "file" | "selection" | "problems" | "git" | "image"): void {
    this.receiveEmitter.fire({ type: "addContext", kind });
  }

  async onClose(): Promise<void> {
    this.isViewVisible = false;
    this.visibilityEmitter.fire();
    this.disposeEmitter.fire();
    this.terminal?.dispose();
    this.terminal = undefined;
    this.mounted?.destroy();
    this.mounted = undefined;
  }

  private handleTerminalMessage(msg: TerminalClientMessage): void {
    const session = this.ensureTerminal();
    if (msg.type === "terminal:open") session.open(msg.cols, msg.rows);
    else if (msg.type === "terminal:input") session.input(msg.data);
    else if (msg.type === "terminal:resize") session.resize(msg.cols, msg.rows);
    else session.restart();
  }

  private ensureTerminal(): IntegratedTerminal {
    if (!this.terminal) {
      this.terminal = createIntegratedTerminal({
        cwd: this.plugin.getVaultBasePath(),
        shell: () => this.plugin.settings.terminalShell || defaultTerminalShell(),
        onData: (data) => {
          this.mounted?.postMessageToWebview({ type: "terminal:data", data });
        },
        onExit: (code) => {
          this.mounted?.postMessageToWebview({ type: "terminal:exit", code });
        },
        onError: (message) => {
          this.mounted?.postMessageToWebview({ type: "terminal:error", message });
        },
      });
    }
    return this.terminal;
  }
}

export class HermesDiffItemView extends ItemView {
  private currentPayload: DiffViewPayload = {
    title: "Hermes Diff",
    beforeText: "",
    afterText: "",
  };

  constructor(
    leaf: WorkspaceLeaf,
    public readonly plugin: HermesStudioPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return HERMES_DIFF_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.currentPayload.title || "Hermes Diff";
  }

  getIcon(): string {
    return "hermes-studio";
  }

  setDiffPayload(payload: DiffViewPayload): void {
    this.currentPayload = payload;
    (this.leaf as any)?.updateHeader?.();
    if (this.contentEl) {
      renderDiffIntoContainer(this.contentEl, this.currentPayload);
    }
  }

  async onOpen(): Promise<void> {
    if (typeof this.contentEl.empty === "function") {
      this.contentEl.empty();
    } else {
      while (this.contentEl.firstChild) {
        this.contentEl.removeChild(this.contentEl.firstChild);
      }
    }
    this.contentEl.classList.add("hermes-studio-view-content", "hermes-diff-content");
    renderDiffIntoContainer(this.contentEl, this.currentPayload);
  }
}
