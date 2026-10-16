import path from "node:path";
import {
  addIcon,
  FileSystemAdapter,
  MarkdownView,
  Plugin,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import {
  ActivatedHermesCore,
  activateHermesCore,
} from "./host/hermes-core-bridge";
import { VaultNoteTracker } from "./host/note-tracker";
import { createObsidianVscodeShim, SimpleUri } from "./host/obsidian-shim";
import {
  DEFAULT_HERMES_SETTINGS,
  HermesPluginSettings,
  HermesSettingTab,
} from "./settings";
import {
  HERMES_DIFF_VIEW_TYPE,
  HERMES_EDITOR_VIEW_TYPE,
  HERMES_SIDE_VIEW_TYPE,
  HermesDiffItemView,
  HermesStudioView,
} from "./views/hermes-chat-view";
import {
  HermesMultiPickModal,
  HermesQuickPickModal,
  showHermesNotice,
  showImageFileDialog,
} from "./views/modals";

export {
  HERMES_SIDE_VIEW_TYPE,
  HERMES_EDITOR_VIEW_TYPE,
  HERMES_DIFF_VIEW_TYPE,
};

// Hermes Studio 100x100 scaled icon for Obsidian's addIcon API
const HERMES_OBSIDIAN_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M4 4h3.2v6.6h7.6V4H18v16h-3.2v-6.6H7.2V20H4z"/><path fill="currentColor" d="M18 4.2c1.9-1.5 3.6-1.6 5-.9-1.1.4-2 1.1-2.6 2.1.8-.1 1.6 0 2.3.4-1.3.4-2.6 1.3-3.4 2.6H18z"/></svg>`;

export default class HermesStudioPlugin extends Plugin {
  settings: HermesPluginSettings = { ...DEFAULT_HERMES_SETTINGS };
  vscodeShim!: ReturnType<typeof createObsidianVscodeShim>;
  noteTracker!: VaultNoteTracker;
  private core: ActivatedHermesCore | undefined;
  private ribbonEl: HTMLElement | undefined;
  private activeSideView: HermesStudioView | undefined;
  private activeEditorView: HermesStudioView | undefined;
  private pendingEditorAdapter: any | undefined;

  getVaultBasePath(): string {
    const adapter = this.app?.vault?.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return adapter.getBasePath();
    }
    if (typeof (adapter as any)?.getBasePath === "function") {
      return (adapter as any).getBasePath();
    }
    return process.cwd();
  }

  getPluginDirPath(): string {
    const base = this.getVaultBasePath();
    const dir = (this.manifest as any)?.dir;
    return dir ? path.resolve(base, dir) : base;
  }

  async onload(): Promise<void> {
    await this.loadSettings();

    addIcon("hermes-studio", HERMES_OBSIDIAN_ICON_SVG);

    const vaultBasePath = this.getVaultBasePath();
    const vaultName = this.app?.vault?.getName?.() || path.basename(vaultBasePath);

    this.noteTracker = new VaultNoteTracker({
      vaultBasePath,
      resolveWikiLink: (linkpath, sourcePath) =>
        this.resolveVaultWikiLink(linkpath, sourcePath),
      onChange: () => {
        this.vscodeShim?._internal.fireActiveEditorChanged();
        this.vscodeShim?._internal.fireSelectionChanged();
      },
    });

    this.vscodeShim = createObsidianVscodeShim({
      vaultBasePath,
      vaultName,
      getSettings: () => this.settings,
      updateSetting: async (key, value) => {
        (this.settings as any)[key] = value;
        await this.saveSettings(key);
      },
      resolveWikiLink: (linkpath) => this.resolveVaultWikiLink(linkpath),
      listVaultFiles: () => {
        const files = this.app?.vault?.getFiles?.() ?? [];
        return files.map((f: TFile) => f.path);
      },
      revealSideView: async () => {
        await this.activateSideView();
      },
      createEditorWebviewPanel: () => {
        if (this.pendingEditorAdapter) {
          const adapter = this.pendingEditorAdapter;
          this.pendingEditorAdapter = undefined;
          return adapter;
        }
        void this.openEditorViewLeaf();
        return this.activeEditorView?.toVscodeWebviewAdapter();
      },
      getVaultDiagnostics: () => this.collectVaultDiagnostics(),
      openFileInObsidian: async (absPath, selection) => {
        await this.openVaultFile(absPath, selection);
      },
      openDiffInObsidian: async ({ leftUri, rightUri, title, readContent }) => {
        const beforeText = readContent(leftUri) ?? "";
        const afterText = readContent(rightUri) ?? "";
        const filePath =
          rightUri.scheme === "file"
            ? rightUri.fsPath
            : leftUri.scheme === "file"
              ? leftUri.fsPath
              : undefined;
        await this.openDiffLeaf({
          title,
          beforeText,
          afterText,
          filePath,
          onOpenFile: (fp, line) => {
            void this.openVaultFile(
              fp,
              line ? { startLine: line, endLine: line } : undefined,
            );
          },
        });
      },
      openPluginSettings: () => {
        (this.app as any)?.setting?.open?.();
        (this.app as any)?.setting?.openTabById?.(this.manifest.id);
      },
      showNotice: (message, level, actions) =>
        showHermesNotice(message, level, actions),
      showQuickPickModal: (items, options) =>
        new Promise((resolve) => {
          if (options?.canPickMany) {
            new HermesMultiPickModal(this.app, items, options, resolve).open();
          } else {
            new HermesQuickPickModal(this.app, items, options, resolve).open();
          }
        }),
      showOpenFileDialog: () => showImageFileDialog(),
      getActiveEditorState: () => {
        this.refreshTrackerFromWorkspace();
        const cur = this.noteTracker.current;
        if (!cur) return undefined;
        return {
          absPath: cur.absPath,
          relPath: cur.relPath,
          content: cur.selection?.text ?? "",
          languageId: "markdown",
          cursorLine: cur.cursorLine,
          selection: cur.selection,
        };
      },
    });

    // Activate Hermes Studio core engine
    this.core = activateHermesCore({
      vscodeShim: this.vscodeShim,
      extensionPath: this.getPluginDirPath(),
      initialWorkspaceState: this.settings.workspaceState,
      onWorkspaceStateChange: (next) => {
        this.settings.workspaceState = next;
        void this.saveData(this.settings);
      },
      resolvePromptWikiLinks: (text) =>
        this.noteTracker.resolvePromptWikiLinks(text),
      getCustomEnv: () => this.settings.environment ?? {},
    });

    // Register Obsidian workspace views
    this.safeRegisterView(
      HERMES_SIDE_VIEW_TYPE,
      (leaf) => new HermesStudioView(leaf, this, "side"),
    );
    this.safeRegisterView(
      HERMES_EDITOR_VIEW_TYPE,
      (leaf) => new HermesStudioView(leaf, this, "editor"),
    );
    this.safeRegisterView(
      HERMES_DIFF_VIEW_TYPE,
      (leaf) => new HermesDiffItemView(leaf, this),
    );

    // Add Ribbon Icon
    this.ribbonEl = this.addRibbonIcon(
      "hermes-studio",
      "Hermes Studio",
      () => {
        void this.activateSideView();
      },
    );

    // Add Settings Tab
    this.addSettingTab(new HermesSettingTab(this.app, this));

    // Register Obsidian URI protocol handler: obsidian://hermes-studio?session=...&card=...
    this.registerObsidianProtocolHandler("hermes-studio", (params) => {
      const query = new URLSearchParams(params as Record<string, string>).toString();
      const uri = SimpleUri.from({
        scheme: "obsidian",
        authority: "hermes-studio",
        path: "/show",
        query,
      });
      this.vscodeShim._internal.getUriHandler()?.handleUri(uri);
    });

    // Track active MarkdownView & selection
    this.setupWorkspaceListeners();

    // Register all Hermes Studio commands in Obsidian Command Palette
    this.registerHermesCommands();
  }

  private safeRegisterView(
    viewType: string,
    factory: (leaf: WorkspaceLeaf) => any,
  ): void {
    try {
      this.registerView(viewType, factory);
    } catch {
      // View type already registered
    }
  }

  attachHermesView(view: HermesStudioView): void {
    const provider = this.vscodeShim._internal.getWebviewViewProvider();
    if (!provider) return;

    const adapter = view.toVscodeWebviewAdapter();
    if (view.place === "side") {
      this.activeSideView = view;
      provider.resolveWebviewView(adapter);
      view.notifyReady();
    } else {
      this.activeEditorView = view;
      provider.adopt(adapter);
      view.notifyReady();
    }
  }

  updateRibbonBadge(count: number, tooltip: string): void {
    if (!this.ribbonEl) return;
    this.ribbonEl.setAttribute(
      "aria-label",
      count > 0 ? `Hermes Studio (${tooltip})` : "Hermes Studio",
    );
    this.ribbonEl.toggleClass?.("hermes-has-badge", count > 0);
  }

  async activateSideView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(HERMES_SIDE_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(false);
      await leaf?.setViewState({
        type: HERMES_SIDE_VIEW_TYPE,
        active: true,
      });
    }
    if (leaf) {
      await workspace.revealLeaf(leaf);
    }
  }

  async openEditorViewLeaf(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(HERMES_EDITOR_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf?.setViewState({
        type: HERMES_EDITOR_VIEW_TYPE,
        active: true,
      });
    }
    if (leaf) {
      await workspace.revealLeaf(leaf);
    }
  }

  async openDiffLeaf(payload: {
    title: string;
    beforeText: string;
    afterText: string;
    filePath?: string;
    onOpenFile?: (filePath: string, line?: number) => void;
  }): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(HERMES_DIFF_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf?.setViewState({
        type: HERMES_DIFF_VIEW_TYPE,
        active: true,
      });
    }
    if (leaf) {
      await workspace.revealLeaf(leaf);
      const view = (leaf as any).view;
      if (view instanceof HermesDiffItemView || typeof view?.setDiffPayload === "function") {
        view.setDiffPayload(payload);
      }
    }
  }

  private resolveVaultWikiLink(
    linkpath: string,
    sourcePath = "",
  ): string | undefined {
    const dest = this.app?.metadataCache?.getFirstLinkpathDest?.(
      linkpath,
      sourcePath,
    );
    if (dest?.path) return dest.path;
    const files: TFile[] = this.app?.vault?.getMarkdownFiles?.() ?? [];
    const found = files.find(
      (f) =>
        f.basename.toLowerCase() === linkpath.toLowerCase() ||
        f.path.toLowerCase() === linkpath.toLowerCase() ||
        f.path.toLowerCase() === `${linkpath.toLowerCase()}.md`,
    );
    return found?.path;
  }

  private collectVaultDiagnostics() {
    const unresolved = this.app?.metadataCache?.unresolvedLinks ?? {};
    const out: Array<{
      relPath: string;
      line: number;
      column: number;
      severity: "error" | "warning";
      message: string;
      source?: string;
    }> = [];

    for (const [sourcePath, linksObj] of Object.entries(unresolved)) {
      if (!linksObj || typeof linksObj !== "object") continue;
      for (const [missingTarget, count] of Object.entries(
        linksObj as Record<string, number>,
      )) {
        if (count > 0) {
          out.push({
            relPath: sourcePath,
            line: 1,
            column: 1,
            severity: "warning",
            message: `Unresolved WikiLink [[${missingTarget}]] (${count} reference${count === 1 ? "" : "s"})`,
            source: "Obsidian Links",
          });
        }
      }
    }
    return out;
  }

  private async openVaultFile(
    absPath: string,
    selection?: { startLine: number; endLine: number },
  ): Promise<void> {
    const base = this.getVaultBasePath();
    const rel = path.relative(base, absPath).replace(/\\/g, "/");
    if (rel.startsWith("..")) return;

    const abstractFile = (this.app.vault as any).getAbstractFileByPath?.(rel);
    const leaf = this.app.workspace.getLeaf("tab");
    if (abstractFile && leaf && typeof (leaf as any).openFile === "function") {
      await (leaf as any).openFile(abstractFile);
      if (selection) {
        const view = (leaf as any).view;
        const editor = view?.editor;
        if (editor) {
          const line = Math.max(0, selection.startLine - 1);
          editor.setCursor?.({ line, ch: 0 });
          editor.scrollIntoView?.(
            { from: { line, ch: 0 }, to: { line, ch: 0 } },
            true,
          );
        }
      }
    }
  }

  private refreshTrackerFromWorkspace(): void {
    const mdView = this.app?.workspace?.getActiveViewOfType?.(MarkdownView) as any;
    if (!mdView?.file?.path) return;
    const editor = mdView.editor;
    if (!editor) {
      this.noteTracker.updateFromEditor({
        relPath: mdView.file.path,
        cursorLine: 1,
      });
      return;
    }

    const cursor = editor.getCursor?.() ?? { line: 0, ch: 0 };
    const selectedText = editor.getSelection?.() ?? "";
    if (selectedText && selectedText.trim().length > 0) {
      const from = editor.getCursor?.("from") ?? cursor;
      const to = editor.getCursor?.("to") ?? cursor;
      this.noteTracker.updateFromEditor({
        relPath: mdView.file.path,
        cursorLine: (cursor.line ?? 0) + 1,
        selection: {
          startLine: (from.line ?? 0) + 1,
          endLine: (to.line ?? 0) + 1,
          text: selectedText,
        },
      });
    } else {
      this.noteTracker.updateFromEditor({
        relPath: mdView.file.path,
        cursorLine: (cursor.line ?? 0) + 1,
      });
    }
  }

  private setupWorkspaceListeners(): void {
    if (typeof this.app?.workspace?.on !== "function") return;

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf: WorkspaceLeaf | null) => {
        const viewType = (leaf?.view as any)?.getViewType?.();
        this.noteTracker.onActiveLeafChanged(viewType);
        if (viewType === "markdown") {
          this.refreshTrackerFromWorkspace();
        }
      }),
    );

    this.registerEvent(
      this.app.workspace.on("editor-change", () => {
        this.refreshTrackerFromWorkspace();
      }),
    );

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: any) => {
        menu.addItem?.((item: any) => {
          item
            .setTitle("Send selection to Hermes Studio")
            .setIcon("hermes-studio")
            .onClick(async () => {
              this.refreshTrackerFromWorkspace();
              await this.activateSideView();
              this.activeSideView?. notifyAddContext("selection");
            });
        });
      }),
    );
  }

  private registerHermesCommands(): void {
    const cmds: Array<{ id: string; name: string; run: () => any }> = [
      {
        id: "open-chat",
        name: "Open Chat",
        run: async () => {
          await this.activateSideView();
          await this.executeHermesCommand("hermesStudio.openChat");
        },
      },
      {
        id: "open-chat-in-editor",
        name: "Open Chat in Editor Tab",
        run: async () => {
          await this.openEditorViewLeaf();
        },
      },
      {
        id: "move-chat-to-sidebar",
        name: "Move Chat to Side Bar",
        run: async () => {
          await this.executeHermesCommand("hermesStudio.moveChatToSidebar");
          await this.activateSideView();
        },
      },
      {
        id: "new-chat",
        name: "New Chat",
        run: async () => {
          await this.activateSideView();
          await this.executeHermesCommand("hermesStudio.newChat");
        },
      },
      {
        id: "show-sessions",
        name: "Show Sessions / Past Chats",
        run: async () => {
          await this.activateSideView();
          await this.executeHermesCommand("hermesStudio.showSessions");
        },
      },
      {
        id: "refresh-panels",
        name: "Refresh Panels (Learning, Curator, Memory, Capabilities, Agents)",
        run: () => this.executeHermesCommand("hermesStudio.refreshPanels"),
      },
      {
        id: "show-skill-changes",
        name: "Show All Skill Changes",
        run: () => this.executeHermesCommand("hermesStudio.showSkillChanges"),
      },
      {
        id: "review-memory",
        name: "Review Memory Proposals in Terminal",
        run: () => this.executeHermesCommand("hermesStudio.reviewMemory"),
      },
      {
        id: "restart-hermes",
        name: "Restart Hermes",
        run: () => this.executeHermesCommand("hermesStudio.restart"),
      },
      {
        id: "show-log",
        name: "Show Log",
        run: () => this.executeHermesCommand("hermesStudio.showLog"),
      },
    ];

    for (const c of cmds) {
      this.addCommand({
        id: c.id,
        name: c.name,
        callback: () => c.run(),
      });
    }
  }

  async executeHermesCommand(commandId: string, ...args: any[]): Promise<any> {
    return this.vscodeShim?.commands.executeCommand(commandId, ...args);
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) ?? {};
    this.settings = {
      ...DEFAULT_HERMES_SETTINGS,
      ...loaded,
    };
  }

  async saveSettings(changedKey?: string): Promise<void> {
    await this.saveData(this.settings);
    this.vscodeShim?._internal.fireConfigChanged(changedKey);
  }

  async onunload(): Promise<void> {
    await this.core?.deactivate();
    this.core = undefined;
  }
}
