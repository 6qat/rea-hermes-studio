import childProcess from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import url from "node:url";
import { launchExternalTerminal } from "./terminal-runner";

export interface HermesSettingsValues {
  path: string;
  environment: Record<string, string>;
  autoStart: boolean;
  notifications: "all" | "permissions" | "off" | boolean;
  windowsNotifications?: boolean;
  trace?: boolean;
}

export interface ObsidianShimDependencies {
  vaultBasePath: string;
  vaultName: string;
  getSettings: () => HermesSettingsValues;
  updateSetting?: (key: keyof HermesSettingsValues, value: any) => Promise<void>;
  resolveWikiLink?: (linkpath: string) => string | undefined;
  listVaultFiles?: () => string[];
  revealSideView?: () => Promise<void>;
  createEditorWebviewPanel?: () => any;
  onBadgeCountChanged?: (count: number, tooltip: string) => void;
  getVaultDiagnostics?: () => Array<{
    relPath: string;
    line: number;
    column: number;
    severity: "error" | "warning";
    message: string;
    source?: string;
  }>;
  openFileInObsidian?: (
    absPath: string,
    selection?: { startLine: number; endLine: number },
  ) => Promise<void>;
  openDiffInObsidian?: (params: {
    leftUri: SimpleUri;
    rightUri: SimpleUri;
    title: string;
    readContent: (uri: SimpleUri) => string | undefined;
  }) => Promise<void>;
  openPluginSettings?: () => void;
  showNotice?: (
    message: string,
    level: "info" | "warning" | "error",
    actions?: string[],
  ) => Promise<string | undefined>;
  showQuickPickModal?: (items: any[], options?: any) => Promise<any>;
  showOpenFileDialog?: (options?: any) => Promise<SimpleUri[] | undefined>;
  getActiveEditorState?: () =>
    | {
        absPath: string;
        relPath: string;
        content: string;
        languageId?: string;
        cursorLine: number;
        selection?: {
          startLine: number;
          endLine: number;
          text: string;
        };
      }
    | undefined;
}

export class SimpleEventEmitter<T = void> {
  private listeners = new Set<(e: T) => any>();

  readonly event = (listener: (e: T) => any) => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };

  fire(data: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(data);
      } catch (err) {
        console.error("[HermesStudio] Event listener error:", err);
      }
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

export class SimplePosition {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

export class SimpleRange {
  public readonly start: SimplePosition;
  public readonly end: SimplePosition;

  constructor(
    startLineOrPos: number | SimplePosition,
    startCharOrEndPos: number | SimplePosition,
    endLine?: number,
    endChar?: number,
  ) {
    if (
      typeof startLineOrPos === "number" &&
      typeof startCharOrEndPos === "number"
    ) {
      this.start = new SimplePosition(startLineOrPos, startCharOrEndPos);
      this.end = new SimplePosition(endLine ?? startLineOrPos, endChar ?? startCharOrEndPos);
    } else {
      this.start = startLineOrPos as SimplePosition;
      this.end = startCharOrEndPos as SimplePosition;
    }
  }

  get isEmpty(): boolean {
    return (
      this.start.line === this.end.line &&
      this.start.character === this.end.character
    );
  }
}

export class SimpleUri {
  constructor(
    public readonly scheme: string,
    public readonly authority: string,
    public readonly path: string,
    public readonly query: string,
    public readonly fragment: string,
    private readonly _fsPath?: string,
  ) {}

  get fsPath(): string {
    if (this._fsPath) return this._fsPath;
    if (this.scheme === "file") {
      try {
        return url.fileURLToPath(this.toString());
      } catch {
        return this.path;
      }
    }
    return this.path;
  }

  toString(): string {
    if (this.scheme === "file" && this._fsPath) {
      return url.pathToFileURL(this._fsPath).href;
    }
    const auth = this.authority ? `//${this.authority}` : "//";
    const q = this.query ? `?${this.query}` : "";
    const f = this.fragment ? `#${this.fragment}` : "";
    return `${this.scheme}:${auth}${this.path}${q}${f}`;
  }

  static file(fsPath: string): SimpleUri {
    const resolved = path.resolve(fsPath);
    const parsed = new URL(url.pathToFileURL(resolved).href);
    return new SimpleUri(
      "file",
      "",
      parsed.pathname,
      "",
      "",
      resolved,
    );
  }

  static joinPath(base: SimpleUri, ...segments: string[]): SimpleUri {
    if (base.scheme === "file") {
      return SimpleUri.file(path.join(base.fsPath, ...segments));
    }
    const joined = path.posix.join(base.path || "/", ...segments);
    return new SimpleUri(
      base.scheme,
      base.authority,
      joined,
      base.query,
      base.fragment,
    );
  }

  static from(components: {
    scheme: string;
    authority?: string;
    path?: string;
    query?: string;
    fragment?: string;
  }): SimpleUri {
    if (components.scheme === "file" && components.path) {
      return SimpleUri.file(components.path);
    }
    return new SimpleUri(
      components.scheme,
      components.authority ?? "",
      components.path ?? "",
      components.query ?? "",
      components.fragment ?? "",
    );
  }
}

function walkVaultFilesSync(rootDir: string, maxResults = 5000): string[] {
  const results: string[] = [];
  const ignored = new Set([".git", "node_modules", ".obsidian", ".trash"]);

  function visit(dir: string) {
    if (results.length >= maxResults) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxResults) break;
      if (ignored.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  }

  visit(rootDir);
  return results;
}

export function createObsidianVscodeShim(deps: ObsidianShimDependencies) {
  const configChangeEmitter = new SimpleEventEmitter<{
    affectsConfiguration: (section: string) => boolean;
  }>();
  const activeEditorEmitter = new SimpleEventEmitter<any>();
  const selectionChangeEmitter = new SimpleEventEmitter<any>();
  const windowStateEmitter = new SimpleEventEmitter<{ focused: boolean }>();
  const terminalCloseEmitter = new SimpleEventEmitter<any>();
  const tabChangeEmitter = new SimpleEventEmitter<void>();

  const registeredCommands = new Map<string, (...args: any[]) => any>();
  const contentProviders = new Map<
    string,
    { provideTextDocumentContent: (uri: SimpleUri) => string | undefined }
  >();
  let webviewViewProvider: any = undefined;
  let uriHandler: { handleUri: (uri: SimpleUri) => void } | undefined;

  function parseUri(value: string, _strict?: boolean): SimpleUri {
    // 1. Handle obsidian://open?vault=...&file=...
    if (value.startsWith("obsidian://")) {
      const parsed = new URL(value);
      const fileParam = parsed.searchParams.get("file") || parsed.searchParams.get("path");
      if (fileParam) {
        const decoded = decodeURIComponent(fileParam);
        const withExt =
          path.extname(decoded) ||
          fs.existsSync(path.join(deps.vaultBasePath, decoded))
            ? decoded
            : fs.existsSync(path.join(deps.vaultBasePath, `${decoded}.md`))
              ? `${decoded}.md`
              : deps.resolveWikiLink?.(decoded) ?? decoded;
        return SimpleUri.file(path.join(deps.vaultBasePath, withExt));
      }
    }

    // 2. Handle wikilink://NoteName
    if (value.startsWith("wikilink://")) {
      const rawTarget = decodeURIComponent(value.slice("wikilink://".length)).trim();
      const resolvedRel =
        deps.resolveWikiLink?.(rawTarget) ??
        (fs.existsSync(path.join(deps.vaultBasePath, `${rawTarget}.md`))
          ? `${rawTarget}.md`
          : rawTarget);
      return SimpleUri.file(path.join(deps.vaultBasePath, resolvedRel));
    }

    // 3. Handle file:// URI
    if (value.startsWith("file://")) {
      try {
        return SimpleUri.file(url.fileURLToPath(value));
      } catch {
        const parsed = new URL(value);
        return SimpleUri.file(decodeURIComponent(parsed.pathname));
      }
    }

    // 4. Generic scheme (e.g. hermes-studio-diff:...)
    const parsed = new URL(value);
    return new SimpleUri(
      parsed.protocol.replace(/:$/, ""),
      parsed.host,
      decodeURIComponent(parsed.pathname),
      parsed.search.replace(/^\?/, ""),
      parsed.hash.replace(/^#/, ""),
    );
  }

  const Uri = {
    file: SimpleUri.file,
    joinPath: SimpleUri.joinPath,
    from: SimpleUri.from,
    parse: parseUri,
  };

  const FileType = {
    Unknown: 0,
    File: 1,
    Directory: 2,
    SymbolicLink: 64,
  };

  const DiagnosticSeverity = {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3,
  };

  const TreeItemCollapsibleState = {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  };

  const ViewColumn = {
    Active: -1,
    Beside: -2,
    One: 1,
    Two: 2,
  };

  class TreeItem {
    label: any;
    collapsibleState: number;
    id?: string;
    description?: string;
    tooltip?: string;
    iconPath?: any;
    contextValue?: string;
    command?: any;
    resourceUri?: SimpleUri;
    constructor(label: any, collapsibleState = 0) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }

  class ThemeIcon {
    constructor(
      public readonly id: string,
      public readonly color?: ThemeColor,
    ) {}
  }

  class ThemeColor {
    constructor(public readonly id: string) {}
  }

  class RelativePattern {
    constructor(
      public readonly baseUri: SimpleUri | string,
      public readonly pattern: string,
    ) {}
  }

  class CodeLens {
    constructor(
      public readonly range: SimpleRange,
      public readonly command?: any,
    ) {}
  }

  class TabInputText {
    constructor(public readonly uri: SimpleUri) {}
  }

  class TabInputTextDiff {
    constructor(
      public readonly original: SimpleUri,
      public readonly modified: SimpleUri,
    ) {}
  }

  function makeActiveTextEditor() {
    const state = deps.getActiveEditorState?.();
    if (!state) return undefined;
    const uri = SimpleUri.file(state.absPath);
    const lines = state.content.split(/\r?\n/);
    const selEndChar = state.selection
      ? Math.max(
          1,
          state.selection.text.split(/\r?\n/).at(-1)?.length ?? 1,
        )
      : 0;
    const sel = state.selection
      ? new SimpleRange(
          Math.max(0, state.selection.startLine - 1),
          0,
          Math.max(0, state.selection.endLine - 1),
          selEndChar,
        )
      : new SimpleRange(
          Math.max(0, state.cursorLine - 1),
          0,
          Math.max(0, state.cursorLine - 1),
          0,
        );
    (sel as any).active = new SimplePosition(
      Math.max(0, state.cursorLine - 1),
      0,
    );

    const document = {
      uri,
      fileName: state.absPath,
      languageId: state.languageId ?? "markdown",
      getText(range?: SimpleRange) {
        if (!range || range.isEmpty) return state.selection?.text ?? state.content;
        if (state.selection?.text) return state.selection.text;
        return lines.slice(range.start.line, range.end.line + 1).join("\n");
      },
    };

    return {
      document,
      selection: sel,
      selections: [sel],
      revealRange() {},
    };
  }

  const workspace = {
    get workspaceFolders() {
      return [
        {
          uri: SimpleUri.file(deps.vaultBasePath),
          name: deps.vaultName,
          index: 0,
        },
      ];
    },
    get textDocuments() {
      const ed = makeActiveTextEditor();
      return ed ? [ed.document] : [];
    },
    getConfiguration(_section?: string) {
      const s = deps.getSettings();
      const defaults: Record<string, any> = {
        path: "",
        trace: false,
        notifications: true,
        windowsNotifications: true,
      };
      const normalizeValue = (key: string) => {
        if (key === "notifications") {
          return s.notifications !== "off" && s.notifications !== false;
        }
        return (s as any)[key];
      };
      return {
        get<T>(key: string, defaultValue?: T): T {
          const val = normalizeValue(key);
          return val !== undefined ? val : (defaultValue as T);
        },
        inspect(key: string) {
          const val = normalizeValue(key);
          return {
            key: `hermesStudio.${key}`,
            defaultValue: defaults[key],
            globalValue: val !== undefined ? val : defaults[key],
          };
        },
        async update(key: string, value: any) {
          await deps.updateSetting?.(key as keyof HermesSettingsValues, value);
          configChangeEmitter.fire({
            affectsConfiguration: (sec: string) =>
              sec === "hermesStudio" || sec === `hermesStudio.${key}`,
          });
        },
      };
    },
    onDidChangeConfiguration: configChangeEmitter.event,
    asRelativePath(pathOrUri: SimpleUri | string, _includeWorkspaceFolder?: boolean) {
      const fsPath =
        typeof pathOrUri === "string" ? pathOrUri : pathOrUri.fsPath;
      const rel = path.relative(deps.vaultBasePath, fsPath).replace(/\\/g, "/");
      return rel.startsWith("..") ? fsPath : rel;
    },
    async findFiles(_include: any, _exclude?: any, maxResults = 5000): Promise<SimpleUri[]> {
      if (deps.listVaultFiles) {
        return deps
          .listVaultFiles()
          .slice(0, maxResults)
          .map((rel) => SimpleUri.file(path.join(deps.vaultBasePath, rel)));
      }
      return walkVaultFilesSync(deps.vaultBasePath, maxResults).map((p) =>
        SimpleUri.file(p),
      );
    },
    createFileSystemWatcher(globPattern: RelativePattern | string) {
      const onChange = new SimpleEventEmitter<SimpleUri>();
      const onCreate = new SimpleEventEmitter<SimpleUri>();
      const onDelete = new SimpleEventEmitter<SimpleUri>();
      const baseDir =
        typeof globPattern === "string"
          ? deps.vaultBasePath
          : typeof globPattern.baseUri === "string"
            ? globPattern.baseUri
            : globPattern.baseUri.fsPath;

      let watcher: fs.FSWatcher | undefined;
      try {
        if (fs.existsSync(baseDir)) {
          watcher = fs.watch(baseDir, { recursive: false }, (eventType, filename) => {
            const targetUri = SimpleUri.file(
              filename ? path.join(baseDir, filename.toString()) : baseDir,
            );
            if (eventType === "rename") {
              onCreate.fire(targetUri);
            } else {
              onChange.fire(targetUri);
            }
          });
        }
      } catch {
        // Ignore fs.watch unsupported errors
      }

      return {
        onDidChange: onChange.event,
        onDidCreate: onCreate.event,
        onDidDelete: onDelete.event,
        dispose() {
          try {
            watcher?.close();
          } catch {}
          onChange.dispose();
          onCreate.dispose();
          onDelete.dispose();
        },
      };
    },
    registerTextDocumentContentProvider(
      scheme: string,
      provider: { provideTextDocumentContent: (uri: SimpleUri) => string | undefined },
    ) {
      contentProviders.set(scheme, provider);
      return {
        dispose: () => {
          contentProviders.delete(scheme);
        },
      };
    },
    async openTextDocument(uriOrPath: SimpleUri | string) {
      const uri =
        typeof uriOrPath === "string" ? SimpleUri.file(uriOrPath) : uriOrPath;
      let content = "";
      if (uri.scheme === "file") {
        content = await fsp.readFile(uri.fsPath, "utf8").catch(() => "");
      } else {
        const provider = contentProviders.get(uri.scheme);
        content = provider?.provideTextDocumentContent(uri) ?? "";
      }
      return {
        uri,
        fileName: uri.fsPath,
        languageId: "markdown",
        getText: () => content,
      };
    },
    fs: {
      async stat(uri: SimpleUri) {
        const st = await fsp.stat(uri.fsPath);
        let type = FileType.Unknown;
        if (st.isFile()) type |= FileType.File;
        if (st.isDirectory()) type |= FileType.Directory;
        if (st.isSymbolicLink()) type |= FileType.SymbolicLink;
        return {
          type,
          ctime: st.ctimeMs,
          mtime: st.mtimeMs,
          size: st.size,
        };
      },
      async readFile(uri: SimpleUri): Promise<Uint8Array> {
        const buf = await fsp.readFile(uri.fsPath);
        return new Uint8Array(buf);
      },
      async readDirectory(uri: SimpleUri): Promise<Array<[string, number]>> {
        const entries = await fsp.readdir(uri.fsPath, { withFileTypes: true });
        return entries
          .filter((e) => !e.name.startsWith(".obsidian") && e.name !== ".git")
          .map((e) => [
            e.name,
            e.isDirectory() ? FileType.Directory : FileType.File,
          ]);
      },
    },
  };

  const windowObj = {
    get activeTextEditor() {
      return makeActiveTextEditor();
    },
    get visibleTextEditors() {
      const ed = makeActiveTextEditor();
      return ed ? [ed] : [];
    },
    onDidChangeActiveTextEditor: activeEditorEmitter.event,
    onDidChangeTextEditorSelection: selectionChangeEmitter.event,
    state: {
      get focused() {
        return typeof document !== "undefined" ? document.hasFocus() : true;
      },
    },
    onDidChangeWindowState: windowStateEmitter.event,
    tabGroups: {
      get all() {
        const ed = makeActiveTextEditor();
        return ed
          ? [{ tabs: [{ input: new TabInputText(ed.document.uri) }] }]
          : [];
      },
      onDidChangeTabs: tabChangeEmitter.event,
    },
    createOutputChannel(_name: string) {
      const lines: string[] = [];
      return {
        appendLine(line: string) {
          lines.push(line);
          if (lines.length > 500) lines.shift();
          console.debug(line);
        },
        show() {
          deps.showNotice?.(
            lines.slice(-8).join("\n") || "Hermes Studio log is empty.",
            "info",
          );
        },
        dispose() {},
        getLines: () => [...lines],
      };
    },
    createTerminal(opts: any) {
      const handle = launchExternalTerminal({
        name: opts.name ?? "Hermes",
        cwd: opts.cwd ?? deps.vaultBasePath,
        shellPath: opts.shellPath,
        shellArgs: opts.shellArgs,
        env: opts.env,
        onClose: () => {
          terminalCloseEmitter.fire(handle);
        },
      });
      return handle;
    },
    onDidCloseTerminal: terminalCloseEmitter.event,
    registerUriHandler(handler: { handleUri: (uri: SimpleUri) => void }) {
      uriHandler = handler;
      return {
        dispose: () => {
          uriHandler = undefined;
        },
      };
    },
    registerWebviewViewProvider(_id: string, provider: any) {
      webviewViewProvider = provider;
      return {
        dispose: () => {
          webviewViewProvider = undefined;
        },
      };
    },
    registerWebviewPanelSerializer(_id: string, _serializer: any) {
      return { dispose() {} };
    },
    createWebviewPanel(_viewType: string, _title: string, _column: any, _options: any) {
      if (deps.createEditorWebviewPanel) {
        return deps.createEditorWebviewPanel();
      }
      return {
        webview: {
          options: {},
          html: "",
          cspSource: "self",
          asWebviewUri: (u: SimpleUri) => u,
          postMessage: async () => true,
          onDidReceiveMessage: () => ({ dispose() {} }),
        },
        visible: true,
        reveal() {},
        onDidChangeViewState: () => ({ dispose() {} }),
        onDidDispose: () => ({ dispose() {} }),
        dispose() {},
      };
    },
    createTreeView(_id: string, _opts: any) {
      return {
        badge: undefined,
        onDidChangeVisibility: () => ({ dispose() {} }),
        dispose() {},
      };
    },
    async showInformationMessage(message: string, ...items: any[]) {
      const actions = items.filter((i) => typeof i === "string") as string[];
      return deps.showNotice
        ? deps.showNotice(message, "info", actions)
        : undefined;
    },
    async showWarningMessage(message: string, ...items: any[]) {
      const actions = items.filter((i) => typeof i === "string") as string[];
      return deps.showNotice
        ? deps.showNotice(message, "warning", actions)
        : undefined;
    },
    async showErrorMessage(message: string, ...items: any[]) {
      const actions = items.filter((i) => typeof i === "string") as string[];
      return deps.showNotice
        ? deps.showNotice(message, "error", actions)
        : undefined;
    },
    async showQuickPick(items: any[], options?: any) {
      return deps.showQuickPickModal
        ? deps.showQuickPickModal(items, options)
        : undefined;
    },
    async showOpenDialog(options?: any) {
      return deps.showOpenFileDialog
        ? deps.showOpenFileDialog(options)
        : undefined;
    },
    async showTextDocument(docOrUri: any, options?: any) {
      const uri: SimpleUri = docOrUri?.uri ?? docOrUri;
      const sel: SimpleRange | undefined = options?.selection;
      if (uri && deps.openFileInObsidian) {
        await deps.openFileInObsidian(
          uri.fsPath,
          sel
            ? { startLine: sel.start.line + 1, endLine: sel.end.line + 1 }
            : undefined,
        );
      }
      return makeActiveTextEditor();
    },
  };

  const commands = {
    registerCommand(id: string, callback: (...args: any[]) => any) {
      registeredCommands.set(id, callback);
      return {
        dispose: () => {
          registeredCommands.delete(id);
        },
      };
    },
    async executeCommand(id: string, ...args: any[]) {
      if (registeredCommands.has(id)) {
        return registeredCommands.get(id)!(...args);
      }
      if (
        id === "workbench.view.extension.hermes-studio" ||
        id === "hermesStudio.chat.focus"
      ) {
        await deps.revealSideView?.();
        return;
      }
      if (id === "vscode.diff") {
        const [leftUri, rightUri, title] = args as [
          SimpleUri,
          SimpleUri,
          string,
        ];
        await deps.openDiffInObsidian?.({
          leftUri,
          rightUri,
          title: title ?? "Hermes Diff",
          readContent: (u: SimpleUri) => {
            if (u.scheme === "file") {
              try {
                return fs.readFileSync(u.fsPath, "utf8");
              } catch {
                return "";
              }
            }
            return contentProviders
              .get(u.scheme)
              ?.provideTextDocumentContent(u);
          },
        });
        return;
      }
      if (id === "vscode.open") {
        const [uri, opts] = args;
        return windowObj.showTextDocument(uri, opts);
      }
      if (id === "workbench.action.openSettings") {
        deps.openPluginSettings?.();
        return;
      }
    },
    getRegisteredCommands: () => registeredCommands,
  };

  const languages = {
    registerCodeLensProvider(_selector: any, _provider: any) {
      return { dispose() {} };
    },
    getDiagnostics(): Array<[SimpleUri, any[]]> {
      const probs = deps.getVaultDiagnostics?.() ?? [];
      const byFile = new Map<string, any[]>();
      for (const p of probs) {
        const abs = path.join(deps.vaultBasePath, p.relPath);
        const list = byFile.get(abs) ?? [];
        list.push({
          severity:
            p.severity === "error"
              ? DiagnosticSeverity.Error
              : DiagnosticSeverity.Warning,
          range: new SimpleRange(
            Math.max(0, p.line - 1),
            Math.max(0, p.column - 1),
            Math.max(0, p.line - 1),
            Math.max(0, p.column),
          ),
          message: p.message,
          source: p.source ?? "Obsidian Vault",
        });
        byFile.set(abs, list);
      }
      return [...byFile.entries()].map(([abs, list]) => [
        SimpleUri.file(abs),
        list,
      ]);
    },
  };

  const extensions = {
    getExtension(id: string) {
      if (id === "vscode.git") {
        const gitDir = path.join(deps.vaultBasePath, ".git");
        if (!fs.existsSync(gitDir)) return undefined;
        return {
          isActive: true,
          exports: {
            getAPI: () => ({
              repositories: [
                {
                  rootUri: SimpleUri.file(deps.vaultBasePath),
                  async diff(cached: boolean): Promise<string> {
                    try {
                      const args = cached ? ["diff", "--cached"] : ["diff"];
                      const res = childProcess.spawnSync("git", args, {
                        cwd: deps.vaultBasePath,
                        encoding: "utf8",
                        maxBuffer: 2 * 1024 * 1024,
                      });
                      return res.status === 0 ? res.stdout || "" : "";
                    } catch {
                      return "";
                    }
                  },
                },
              ],
            }),
          },
        };
      }
      return undefined;
    },
  };

  const env = {
    appName: "Obsidian",
    uriScheme: "obsidian",
    async openExternal(target: SimpleUri | string) {
      const href = typeof target === "string" ? target : target.toString();
      if (typeof window !== "undefined" && typeof window.open === "function") {
        window.open(href, "_blank", "noopener,noreferrer");
      }
      return true;
    },
  };

  return {
    Uri,
    EventEmitter: SimpleEventEmitter,
    Position: SimplePosition,
    Range: SimpleRange,
    RelativePattern,
    ThemeColor,
    ThemeIcon,
    TreeItem,
    TreeItemCollapsibleState,
    CodeLens,
    TabInputText,
    TabInputTextDiff,
    ViewColumn,
    DiagnosticSeverity,
    FileType,
    workspace,
    window: windowObj,
    commands,
    languages,
    extensions,
    env,
    // Internal helpers for the Obsidian plugin host
    _internal: {
      fireActiveEditorChanged: () => activeEditorEmitter.fire(makeActiveTextEditor()),
      fireSelectionChanged: () => {
        const ed = makeActiveTextEditor();
        if (ed) selectionChangeEmitter.fire({ textEditor: ed });
      },
      fireConfigChanged: (key?: string) =>
        configChangeEmitter.fire({
          affectsConfiguration: (sec: string) =>
            !key || sec === "hermesStudio" || sec === `hermesStudio.${key}`,
        }),
      fireWindowFocusChanged: (focused: boolean) =>
        windowStateEmitter.fire({ focused }),
      getWebviewViewProvider: () => webviewViewProvider,
      getUriHandler: () => uriHandler,
      getContentProvider: (scheme: string) => contentProviders.get(scheme),
    },
  };
}
