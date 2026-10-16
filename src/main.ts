import fs from "node:fs";
import path from "node:path";
import {
  addIcon,
  FileSystemAdapter,
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  TFolder,
  type WorkspaceLeaf,
} from "obsidian";
import { type ActivatedHermesCore, activateHermesCore } from "./host/hermes-core-bridge";
import { VaultNoteTracker } from "./host/note-tracker";
import { createObsidianVscodeShim, SimpleUri } from "./host/obsidian-shim";
import { DEFAULT_HERMES_SETTINGS, type HermesPluginSettings, HermesSettingTab } from "./settings";
import {
  HERMES_DIFF_VIEW_TYPE,
  HERMES_EDITOR_VIEW_TYPE,
  HERMES_SIDE_VIEW_TYPE,
  HermesDiffItemView,
  HermesStudioView,
} from "./views/hermes-chat-view";
import { HERMES_DOC_VIEW_TYPE, HermesDocItemView } from "./views/hermes-doc-view";
import {
  HermesMultiPickModal,
  HermesQuickPickModal,
  showHermesNotice,
  showImageFileDialog,
} from "./views/modals";

export {
  HERMES_DIFF_VIEW_TYPE,
  HERMES_DOC_VIEW_TYPE,
  HERMES_EDITOR_VIEW_TYPE,
  HERMES_SIDE_VIEW_TYPE,
  HermesDocItemView,
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
    this.applyLayoutSpacing();

    addIcon("hermes-studio", HERMES_OBSIDIAN_ICON_SVG);

    const vaultBasePath = this.getVaultBasePath();
    const vaultName = this.app?.vault?.getName?.() || path.basename(vaultBasePath);

    this.noteTracker = new VaultNoteTracker({
      vaultBasePath,
      resolveWikiLink: (linkpath, sourcePath) => this.resolveVaultWikiLink(linkpath, sourcePath),
      onChange: () => {
        this.vscodeShim?._internal.fireActiveEditorChanged();
        this.vscodeShim?._internal.fireSelectionChanged();
      },
    });

    let hasGitRepo = false;
    try {
      hasGitRepo = Boolean(await this.app?.vault?.adapter?.exists?.(".git"));
    } catch {}

    this.vscodeShim = createObsidianVscodeShim({
      vaultBasePath,
      vaultName,
      app: this.app,
      vault: this.app?.vault,
      adapter: this.app?.vault?.adapter,
      hasGit: () => hasGitRepo,
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
        if (this.activeEditorView) {
          return this.activeEditorView.toVscodeWebviewAdapter();
        }
        void this.openEditorViewLeaf();
        return { _asyncAdopt: true };
      },
      getVaultDiagnostics: () => this.collectVaultDiagnostics(),
      openFileInObsidian: async (absPath, selection) => {
        await this.openVaultFile(absPath, selection);
      },
      openDiffInObsidian: async ({ leftUri, rightUri, title, readContent }) => {
        const beforeText = (await Promise.resolve(readContent(leftUri))) ?? "";
        const afterText = (await Promise.resolve(readContent(rightUri))) ?? "";
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
            void this.openVaultFile(fp, line ? { startLine: line, endLine: line } : undefined);
          },
        });
      },
      openPluginSettings: () => {
        (this.app as any)?.setting?.open?.();
        (this.app as any)?.setting?.openTabById?.(this.manifest.id);
      },
      showNotice: (message, level, actions) => showHermesNotice(message, level, actions),
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
      resolvePromptWikiLinks: (text) => this.noteTracker.resolvePromptWikiLinks(text),
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
    this.safeRegisterView(HERMES_DIFF_VIEW_TYPE, (leaf) => new HermesDiffItemView(leaf, this));
    this.safeRegisterView(HERMES_DOC_VIEW_TYPE, (leaf) => new HermesDocItemView(leaf, this));

    // Add Ribbon Icon
    this.ribbonEl = this.addRibbonIcon("hermes-studio", "Hermes Studio", () => {
      void this.activateSideView();
    });

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

  private safeRegisterView(viewType: string, factory: (leaf: WorkspaceLeaf) => any): void {
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

  public async openDocumentInObsidian(payload: {
    title: string;
    filePath: string;
    content: string;
    selection?: { startLine: number; endLine: number };
  }): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(HERMES_DOC_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf?.setViewState({
        type: HERMES_DOC_VIEW_TYPE,
        active: true,
      });
    }
    if (leaf) {
      await workspace.revealLeaf(leaf);
      const view = (leaf as any).view;
      if (view instanceof HermesDocItemView || typeof view?.setDocPayload === "function") {
        view.setDocPayload(payload);
      }
    }
  }

  private resolveVaultWikiLink(linkpath: string, sourcePath = ""): string | undefined {
    const dest = this.app?.metadataCache?.getFirstLinkpathDest?.(linkpath, sourcePath);
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
      for (const [missingTarget, count] of Object.entries(linksObj as Record<string, number>)) {
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

  public isVaultPathKnown(targetPath: string): boolean {
    if (!targetPath || typeof targetPath !== "string") return false;
    let clean = targetPath.trim();
    if (clean.startsWith("[[") && clean.endsWith("]]")) {
      clean = clean.slice(2, -2).trim();
    }
    const withoutSlash = clean.replace(/[\\/]+$/, "");

    // 1. Vault relative path
    if (this.app?.vault?.getAbstractFileByPath?.(clean)) return true;
    if (withoutSlash && this.app?.vault?.getAbstractFileByPath?.(withoutSlash)) return true;

    // 2. Absolute path on disk
    if (path.isAbsolute(clean)) {
      try {
        if (fs.existsSync(clean)) return true;
      } catch {}
      const base = this.getVaultBasePath();
      const rel = path.relative(base, clean).replace(/\\/g, "/");
      if (!rel.startsWith("..") && this.app?.vault?.getAbstractFileByPath?.(rel)) return true;
    }

    // 3. Relative to base on disk
    try {
      const base = this.getVaultBasePath();
      if (fs.existsSync(path.resolve(base, clean))) return true;
      if (withoutSlash && fs.existsSync(path.resolve(base, withoutSlash))) return true;
    } catch {}

    // 4. MetadataCache link destination
    if (this.app?.metadataCache?.getFirstLinkpathDest?.(clean, "")) return true;
    if (withoutSlash && this.app?.metadataCache?.getFirstLinkpathDest?.(withoutSlash, ""))
      return true;

    // 5. Match by file name, basename, or path across vault files
    const lower = clean.toLowerCase();
    const lowerNoSlash = withoutSlash.toLowerCase();
    const allFiles: TFile[] = this.app?.vault?.getFiles?.() ?? [];
    const match = allFiles.some((f) => {
      const fn = f.name?.toLowerCase?.() ?? "";
      const bn = f.basename?.toLowerCase?.() ?? "";
      const fp = f.path?.toLowerCase?.() ?? "";
      return (
        fn === lower ||
        bn === lower ||
        fp === lower ||
        fn === lowerNoSlash ||
        bn === lowerNoSlash ||
        fp === lowerNoSlash ||
        fp === `${lower}.md` ||
        fp === `${lowerNoSlash}.md`
      );
    });
    if (match) return true;

    // 6. Match folders
    const allLoaded = (this.app?.vault as any)?.getAllLoadedFiles?.() ?? [];
    const folderMatch = allLoaded.some((f: any) => {
      if (!f || f instanceof TFile) return false;
      const fp = (f.path ?? "").toLowerCase();
      return fp === lower || fp === lowerNoSlash;
    });
    if (folderMatch) return true;

    return false;
  }

  public async openVaultFile(
    filePathOrLink: string,
    selection?: { startLine: number; endLine: number },
  ): Promise<boolean> {
    if (!filePathOrLink || typeof filePathOrLink !== "string") return false;

    let target = filePathOrLink.trim();

    // 1. Decode specialized URIs
    if (target.startsWith("wikilink://")) {
      target = decodeURIComponent(target.slice("wikilink://".length)).trim();
    } else if (target.startsWith("file://")) {
      try {
        target = decodeURIComponent(new URL(target).pathname);
      } catch {
        target = target.slice("file://".length);
      }
    } else if (target.startsWith("obsidian://open?")) {
      try {
        const url = new URL(target);
        const fileParam = url.searchParams.get("file");
        if (fileParam) target = decodeURIComponent(fileParam).trim();
      } catch {}
    }

    if (target.startsWith("[[") && target.endsWith("]]")) {
      target = target.slice(2, -2).trim();
    }

    // 2. Parse inline line numbers if not explicitly provided
    if (!selection) {
      const lineMatch = /^(.*?):(\d+)(?::\d+)?$/.exec(target);
      if (lineMatch?.[1] && lineMatch[2]) {
        target = lineMatch[1].trim();
        const l = parseInt(lineMatch[2], 10);
        if (l > 0) selection = { startLine: l, endLine: l };
      }
    }

    const cleanTarget = target.replace(/[\\/]+$/, "");
    const base = this.getVaultBasePath();

    let abstractFile: any = null;

    // 3. Check absolute path on disk
    if (path.isAbsolute(target)) {
      const rel = path.relative(base, target).replace(/\\/g, "/");
      if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
        abstractFile = this.app?.vault?.getAbstractFileByPath?.(rel);
        if (!abstractFile && cleanTarget) {
          const cleanRel = path.relative(base, cleanTarget).replace(/\\/g, "/");
          abstractFile = this.app?.vault?.getAbstractFileByPath?.(cleanRel);
        }
      } else {
        // Target is an absolute path outside the vault (e.g. ~/.hermes/skills/.../SKILL.md)
        try {
          const targetExists = fs.existsSync(target);
          const cleanExists = cleanTarget ? fs.existsSync(cleanTarget) : false;
          if (targetExists || cleanExists) {
            const resolvedPath = targetExists ? target : cleanTarget;
            const stat = fs.statSync(resolvedPath);
            if (stat.isDirectory()) {
              const appAny = this.app as any;
              if (typeof appAny.showInFolder === "function") {
                appAny.showInFolder(resolvedPath);
              } else if (typeof appAny.openWithDefaultApp === "function") {
                appAny.openWithDefaultApp(resolvedPath);
              }
              new Notice(`Opened folder: ${path.basename(resolvedPath)}`);
              return true;
            }
            if (stat.isFile()) {
              const content = fs.readFileSync(resolvedPath, "utf8");
              const title = path.basename(resolvedPath);
              await this.openDocumentInObsidian({
                title,
                filePath: resolvedPath,
                content,
                selection,
              });
              return true;
            }
          } else {
            new Notice(`File not found: ${path.basename(target)}`);
            return false;
          }
        } catch (err) {
          console.error("[Hermes Studio] Failed to open external file:", err);
          new Notice(`Failed to open external file: ${path.basename(target)}`);
          return false;
        }
      }
    }

    // 4. Check relative path in vault
    if (!abstractFile) {
      abstractFile = this.app?.vault?.getAbstractFileByPath?.(target);
    }
    if (!abstractFile && cleanTarget) {
      abstractFile = this.app?.vault?.getAbstractFileByPath?.(cleanTarget);
    }

    // 5. Check metadataCache destination
    if (!abstractFile) {
      abstractFile =
        this.app?.metadataCache?.getFirstLinkpathDest?.(cleanTarget || target, "") ?? null;
    }

    // 6. Match against vault files by name or basename
    if (!abstractFile) {
      const allFiles: TFile[] = this.app?.vault?.getFiles?.() ?? [];
      const lower = (cleanTarget || target).toLowerCase();
      const matchedFile = allFiles.find((f) => {
        const fn = f.name?.toLowerCase?.() ?? "";
        const bn = f.basename?.toLowerCase?.() ?? "";
        const fp = f.path?.toLowerCase?.() ?? "";
        return fn === lower || bn === lower || fp === lower || fp === `${lower}.md`;
      });
      if (matchedFile) {
        abstractFile = matchedFile;
      }
    }

    // 7. Match against vault folders
    if (!abstractFile) {
      const allLoaded = (this.app?.vault as any)?.getAllLoadedFiles?.() ?? [];
      const lower = (cleanTarget || target).toLowerCase();
      const matchedFolder = allLoaded.find((f: any) => {
        if (!f || f instanceof TFile) return false;
        const fp = (f.path ?? "").toLowerCase();
        return fp === lower;
      });
      if (matchedFolder) {
        abstractFile = matchedFolder;
      }
    }

    // 8. Open or reveal in Obsidian
    if (abstractFile) {
      // If it's a folder, reveal in file explorer
      const isFolder =
        (typeof TFolder !== "undefined" && abstractFile instanceof TFolder) ||
        (Boolean((abstractFile as any)?.children) && !(abstractFile as any)?.extension);
      if (isFolder) {
        const leaves = this.app?.workspace?.getLeavesOfType?.("file-explorer") ?? [];
        if (leaves.length > 0 && leaves[0]?.view) {
          (leaves[0].view as any).revealInFolder?.(abstractFile);
        }
        return true;
      }

      // Check if there is already an opened tab with this document
      let existingLeaf: WorkspaceLeaf | undefined;
      if (typeof this.app?.workspace?.iterateAllLeaves === "function") {
        this.app.workspace.iterateAllLeaves((l: WorkspaceLeaf) => {
          if (!existingLeaf && (l.view as any)?.file?.path === abstractFile.path) {
            existingLeaf = l;
          }
        });
      } else if (typeof this.app?.workspace?.getLeavesOfType === "function") {
        const mdLeaves = this.app.workspace.getLeavesOfType("markdown") ?? [];
        for (const l of mdLeaves) {
          if ((l.view as any)?.file?.path === abstractFile.path) {
            existingLeaf = l;
            break;
          }
        }
      }

      let leaf: WorkspaceLeaf | undefined = existingLeaf;
      if (leaf) {
        // Tab already opened: switch to it and reveal
        this.app?.workspace?.revealLeaf?.(leaf);
        this.app?.workspace?.setActiveLeaf?.(leaf, { focus: true });
      } else {
        // Only open a new tab when it's not already opened
        leaf = this.app?.workspace?.getLeaf?.("tab") ?? this.app?.workspace?.getLeaf?.(false);
        if (leaf && typeof (leaf as any).openFile === "function") {
          await (leaf as any).openFile(abstractFile, {
            active: true,
            state: { mode: "preview" },
          });
        }
      }

      // Ensure Reading View mode (preview) for markdown documents
      if (leaf) {
        try {
          const vs = leaf.getViewState?.();
          if (
            vs &&
            (vs.type === "markdown" ||
              (!vs.type && (abstractFile.path?.endsWith?.(".md") ?? false)))
          ) {
            if (vs.state?.mode !== "preview") {
              await leaf.setViewState?.({
                ...vs,
                type: "markdown",
                state: {
                  ...(vs.state ?? {}),
                  file: abstractFile.path,
                  mode: "preview",
                },
              });
            }
          }
        } catch {}

        if (selection) {
          const view = (leaf as any).view;
          const editor = view?.editor;
          if (editor) {
            const line = Math.max(0, selection.startLine - 1);
            editor.setCursor?.({ line, ch: 0 });
            editor.scrollIntoView?.({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
          }
        }
        return true;
      }
    }

    // 9. Fallback: try openLinkText for vault-relative links (never for absolute paths or paths with leading slash)
    if (
      !path.isAbsolute(target) &&
      !target.startsWith("/") &&
      !target.startsWith("\\") &&
      this.app?.workspace?.openLinkText
    ) {
      try {
        await this.app.workspace.openLinkText(cleanTarget || target, "", false, {
          state: { mode: "preview" },
        });
        return true;
      } catch {}
    }

    return false;
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
              this.activeSideView?.notifyAddContext("selection");
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

  applyLayoutSpacing(): void {
    if (typeof document === "undefined") return;
    const pad = Math.max(0, this.settings.statusBarPadding ?? 14);
    document.body?.style?.setProperty?.("--hermes-status-bar-padding", `${pad}px`);
  }

  async saveSettings(changedKey?: string): Promise<void> {
    await this.saveData(this.settings);
    if (changedKey === "statusBarPadding" || !changedKey) {
      this.applyLayoutSpacing();
    }
    this.vscodeShim?._internal.fireConfigChanged(changedKey);
  }

  async onunload(): Promise<void> {
    if (typeof document !== "undefined") {
      document.body?.style?.removeProperty?.("--hermes-status-bar-padding");
    }
    await this.core?.deactivate();
    this.core = undefined;
  }
}
