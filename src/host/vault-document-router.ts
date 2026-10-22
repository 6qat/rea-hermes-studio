import fs from "node:fs";
import path from "node:path";

export interface VaultFileItem {
  path: string;
  name?: string;
  basename?: string;
}

export interface DocumentSelection {
  startLine: number;
  endLine: number;
}

export interface DocumentOpenPayload {
  title: string;
  filePath: string;
  content: string;
  selection?: DocumentSelection;
}

export interface VaultRouterHostAdapter {
  getVaultBasePath: () => string;
  getFiles: () => VaultFileItem[];
  getMarkdownFiles?: () => VaultFileItem[];
  getAllLoadedFiles?: () => any[];
  getAbstractFileByPath?: (path: string) => any;
  getFirstLinkpathDest?: (
    linkpath: string,
    sourcePath?: string,
  ) => { path: string } | null | undefined;
  iterateAllLeaves?: (cb: (leaf: any) => void) => void;
  getLeavesOfType?: (type: string) => any[];
  getLeaf?: (type?: any) => any;
  revealLeaf?: (leaf: any) => Promise<void> | void;
  setActiveLeaf?: (leaf: any, params?: any) => void;
  openLinkText?: (
    linktext: string,
    sourcePath: string,
    action?: any,
    openViewState?: any,
  ) => Promise<any> | any;
  leafHost?: {
    reveal(
      viewType: string,
      options?: { placement?: "right" | "tab"; bind?: (view: any) => void },
    ): Promise<void>;
  };
  externalDocumentViewType?: string;
  showInFolder?: (absPath: string) => void;
  openWithDefaultApp?: (absPath: string) => void;
  showNotice?: (message: string) => void;
}

export class VaultDocumentRouter {
  constructor(private readonly host: VaultRouterHostAdapter) {}

  /**
   * Finds a vault file matching a clean target by exact path, basename, filename,
   * trailing subpath (e.g. "Guiga/Guiga"), or appended ".md" extension.
   */
  private findMatchingVaultFile(cleanTarget: string): VaultFileItem | undefined {
    if (!cleanTarget) return undefined;
    const withoutSlash = cleanTarget.replace(/[\\/]+$/, "");
    const lower = cleanTarget.toLowerCase();
    const lowerNoSlash = withoutSlash.toLowerCase();
    const allFiles: VaultFileItem[] = this.host.getFiles() ?? [];

    return allFiles.find((file) => {
      const fileName = file.name?.toLowerCase?.() ?? "";
      const baseName = file.basename?.toLowerCase?.() ?? "";
      const filePath = file.path?.toLowerCase?.() ?? "";
      return (
        fileName === lower ||
        baseName === lower ||
        filePath === lower ||
        fileName === lowerNoSlash ||
        baseName === lowerNoSlash ||
        filePath === lowerNoSlash ||
        filePath === `${lower}.md` ||
        filePath === `${lowerNoSlash}.md` ||
        filePath.endsWith(`/${lower}`) ||
        filePath.endsWith(`/${lower}.md`) ||
        (lowerNoSlash.length > 0 &&
          (filePath.endsWith(`/${lowerNoSlash}`) || filePath.endsWith(`/${lowerNoSlash}.md`)))
      );
    });
  }

  public isPathKnown(targetPath: string): boolean {
    if (!targetPath || typeof targetPath !== "string") return false;
    let clean = targetPath.trim();
    if (clean.startsWith("[[") && clean.endsWith("]]")) {
      clean = clean.slice(2, -2).trim();
    }
    const withoutSlash = clean.replace(/[\\/]+$/, "");

    // 1. Vault relative path
    if (this.host.getAbstractFileByPath?.(clean)) return true;
    if (withoutSlash && this.host.getAbstractFileByPath?.(withoutSlash)) return true;

    // 2. Absolute path on disk
    if (path.isAbsolute(clean)) {
      try {
        if (fs.existsSync(clean)) return true;
      } catch {}
      const base = this.host.getVaultBasePath();
      const rel = path.relative(base, clean).replace(/\\/g, "/");
      if (!rel.startsWith("..") && this.host.getAbstractFileByPath?.(rel)) return true;
    }

    // 3. Relative to base on disk
    try {
      const base = this.host.getVaultBasePath();
      if (fs.existsSync(path.resolve(base, clean))) return true;
      if (withoutSlash && fs.existsSync(path.resolve(base, withoutSlash))) return true;
    } catch {}

    // 4. MetadataCache link destination
    if (this.host.getFirstLinkpathDest?.(clean, "")) return true;
    if (withoutSlash && this.host.getFirstLinkpathDest?.(withoutSlash, "")) return true;

    // 5. Match by file name, basename, path, or trailing subpath across vault files
    if (this.findMatchingVaultFile(clean)) return true;

    // 6. Match folders
    const allLoaded = this.host.getAllLoadedFiles?.() ?? [];
    const lower = clean.toLowerCase();
    const lowerNoSlash = withoutSlash.toLowerCase();
    const folderMatch = allLoaded.some((file: any) => {
      if (!file || file.extension) return false;
      const folderPath = (file.path ?? "").toLowerCase();
      return folderPath === lower || folderPath === lowerNoSlash;
    });
    if (folderMatch) return true;

    return false;
  }

  public resolveWikiLink(linkpath: string, sourcePath = ""): string | undefined {
    const dest = this.host.getFirstLinkpathDest?.(linkpath, sourcePath);
    if (dest?.path) return dest.path;
    const clean = linkpath.trim();
    const matched = this.findMatchingVaultFile(clean);
    return matched?.path;
  }

  /**
   * Canonical domain method for Vault Reference Linkification:
   * Scans markdown text and converts referenced vault notes and WikiLinks
   * into clickable reading-view links.
   */
  public linkifyVaultReferences(markdownText: string): string {
    return this.linkify(markdownText);
  }

  public linkify(markdownText: string): string {
    if (!markdownText || typeof markdownText !== "string") return markdownText;

    const allFiles: VaultFileItem[] = this.host.getFiles() ?? [];
    const exactFileMap = new Map<string, string>();
    const caseSensitiveFileMap = new Map<string, string>();

    for (const file of allFiles) {
      if (!file?.path) continue;
      const filePath = file.path;
      const pathWithoutExt = filePath.replace(/\.md$/i, "");
      const fileName = file.name ?? path.posix.basename(filePath);
      const baseName = file.basename ?? fileName.replace(/\.md$/i, "");

      exactFileMap.set(filePath.toLowerCase(), filePath);
      exactFileMap.set(pathWithoutExt.toLowerCase(), filePath);
      caseSensitiveFileMap.set(filePath, filePath);
      caseSensitiveFileMap.set(pathWithoutExt, filePath);

      // Register trailing 2-segment subpaths (e.g. "Guiga/Guiga" for "CONTENT_CREATION/Guiga/Guiga.md")
      const segments = pathWithoutExt.split("/");
      if (segments.length >= 2) {
        const tail2 = segments.slice(-2).join("/");
        if (!exactFileMap.has(tail2.toLowerCase())) {
          exactFileMap.set(tail2.toLowerCase(), filePath);
        }
        if (!caseSensitiveFileMap.has(tail2)) {
          caseSensitiveFileMap.set(tail2, filePath);
        }
        const tail2Md = `${tail2}.md`;
        if (!exactFileMap.has(tail2Md.toLowerCase())) {
          exactFileMap.set(tail2Md.toLowerCase(), filePath);
        }
        if (!caseSensitiveFileMap.has(tail2Md)) {
          caseSensitiveFileMap.set(tail2Md, filePath);
        }
      }

      if (fileName && !exactFileMap.has(fileName.toLowerCase())) {
        exactFileMap.set(fileName.toLowerCase(), filePath);
      }
      if (fileName && !caseSensitiveFileMap.has(fileName)) {
        caseSensitiveFileMap.set(fileName, filePath);
      }
      if (baseName && !exactFileMap.has(baseName.toLowerCase())) {
        exactFileMap.set(baseName.toLowerCase(), filePath);
      }
      if (baseName && !caseSensitiveFileMap.has(baseName)) {
        caseSensitiveFileMap.set(baseName, filePath);
      }
    }

    const encodeWikiUri = (targetPath: string): string =>
      `wikilink://${encodeURIComponent(targetPath).replace(/\(/g, "%28").replace(/\)/g, "%29")}`;

    const makeWikiLink = (label: string, targetPath: string): string =>
      `[${label}](${encodeWikiUri(targetPath)})`;

    const placeholders: string[] = [];
    const savePlaceholder = (content: string): string => {
      const idx = placeholders.length;
      placeholders.push(content);
      return `@@HERMES_PH_${idx}@@`;
    };

    // 1. Protect fenced code blocks and inline code spans
    let text = markdownText.replace(/```[\s\S]*?```|`[^`\n]+`/g, (m) => savePlaceholder(m));

    // 2. Convert explicit [[WikiLink]] or [[WikiLink|Alias]] into clickable markdown links
    text = text.replace(
      /!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g,
      (_match, rawTarget, alias) => {
        const target = String(rawTarget ?? "").trim();
        const label = String(alias ?? target).trim();
        if (!target) return _match;
        const resolved = exactFileMap.get(target.toLowerCase()) ?? target;
        return savePlaceholder(makeWikiLink(label, resolved));
      },
    );

    // 3. Protect existing markdown links [text](url) and raw https?:// URLs
    text = text.replace(/\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+/g, (m) => savePlaceholder(m));

    if (exactFileMap.size === 0) {
      return text.replace(/@@HERMES_PH_(\d+)@@/g, (_m, i) => placeholders[Number(i)] ?? _m);
    }

    const stripFormatting = (s: string): { leading: string; core: string; trailing: string } => {
      const match = /^(\*\*|\*|["'“”‘’]+)?(.+?)(\*\*|\*|["'“”‘’]+)?$/.exec(s.trim());
      if (!match) return { leading: "", core: s.trim(), trailing: "" };
      return {
        leading: match[1] ?? "",
        core: (match[2] ?? s).trim(),
        trailing: match[3] ?? "",
      };
    };

    const resolveCandidate = (raw: string): { rendered: string } | null => {
      const { leading, core, trailing } = stripFormatting(raw);
      if (!core || core.includes("@@HERMES_PH_")) return null;
      const lookupKey = core.replace(/\.md$/i, "").toLowerCase();
      const matchedPath = exactFileMap.get(core.toLowerCase()) ?? exactFileMap.get(lookupKey);
      if (!matchedPath) return null;
      return {
        rendered: `${leading}${savePlaceholder(makeWikiLink(core, matchedPath))}${trailing}`,
      };
    };

    // 4. Linkify bullet/numbered list items naming notes
    const lines = text.split("\n");
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx] ?? "";
      const listMatch =
        /^(\s*(?:[-*+]|\d+\.)\s+(?:(?:\*\*|\*)?\d{1,2}:\d{2}(?::\d{2})?(?:\*\*|\*)?\s*(?:—|–|-|:)\s*)?)(.+?)\s*$/.exec(
          line,
        );
      if (!listMatch) continue;
      const prefix = listMatch[1] ?? "";
      const remainder = (listMatch[2] ?? "").trim();
      if (!remainder || remainder.includes("@@HERMES_PH_")) continue;

      const direct = resolveCandidate(remainder);
      if (direct) {
        lines[idx] = `${prefix}${direct.rendered}`;
        continue;
      }

      const trailingTimeMatch =
        /^(.+?)\s*((?:—|–|-)\s*\d{1,2}:\d{2}(?::\d{2})?|\(\d{1,2}:\d{2}(?::\d{2})?\))\s*$/.exec(
          remainder,
        );
      if (trailingTimeMatch?.[1] && trailingTimeMatch[2]) {
        const leadingNote = resolveCandidate(trailingTimeMatch[1]);
        if (leadingNote) {
          lines[idx] = `${prefix}${leadingNote.rendered} ${trailingTimeMatch[2]}`;
        }
      }
    }
    text = lines.join("\n");

    // 5. Linkify remaining exact note titles / subpaths (longest first, min 4 chars)
    const multiTokenCandidates: Array<{ key: string; targetPath: string; caseSensitive: boolean }> =
      [];
    const seenKeys = new Set<string>();

    for (const [casedKey, targetPath] of caseSensitiveFileMap.entries()) {
      if (casedKey.length < 4) continue;
      const lowerKey = casedKey.toLowerCase();
      const isMultiWordOrPath = /[\s/.—–-]/.test(casedKey);
      if (isMultiWordOrPath) {
        if (!seenKeys.has(lowerKey)) {
          seenKeys.add(lowerKey);
          multiTokenCandidates.push({ key: lowerKey, targetPath, caseSensitive: false });
        }
      } else {
        multiTokenCandidates.push({ key: casedKey, targetPath, caseSensitive: true });
      }
    }

    multiTokenCandidates.sort((a, b) => b.key.length - a.key.length);

    if (multiTokenCandidates.length > 0) {
      const lowerText = text.toLowerCase();
      const activeCandidates: Array<{
        key: string;
        targetPath: string;
        caseSensitive: boolean;
        regex: RegExp;
      }> = [];

      for (const cand of multiTokenCandidates) {
        const appearsInText = cand.caseSensitive
          ? text.includes(cand.key)
          : lowerText.includes(cand.key);
        if (!appearsInText) continue;

        const escaped = cand.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const flags = cand.caseSensitive ? "g" : "gi";
        const regex = new RegExp(
          `(^|[^\\p{L}\\p{N}_/])(${escaped})(?=$|[^\\p{L}\\p{N}_/])`,
          `${flags}u`,
        );
        activeCandidates.push({ ...cand, regex });
      }

      if (activeCandidates.length > 0) {
        const updatedLines = text.split("\n");
        for (let idx = 0; idx < updatedLines.length; idx++) {
          let line = updatedLines[idx] ?? "";
          if (!line.trim()) continue;
          if (/^\s*(?:#+\s+|\*{2,3}[^*]+\*{2,3}\s*$)/.test(line)) continue;

          for (const cand of activeCandidates) {
            const hasMatch = cand.caseSensitive
              ? line.includes(cand.key)
              : line.toLowerCase().includes(cand.key);
            if (!hasMatch) continue;

            cand.regex.lastIndex = 0;
            line = line.replace(cand.regex, (_full, pre, matchedText) => {
              return `${pre}${savePlaceholder(makeWikiLink(matchedText, cand.targetPath))}`;
            });
          }
          updatedLines[idx] = line;
        }
        text = updatedLines.join("\n");
      }
    }

    // Restore placeholders
    for (let pass = 0; pass < 2; pass++) {
      if (!text.includes("@@HERMES_PH_")) break;
      text = text.replace(/@@HERMES_PH_(\d+)@@/g, (_m, i) => placeholders[Number(i)] ?? _m);
    }
    return text;
  }

  public async routeUri(
    filePathOrLink: string,
    options?: { selection?: DocumentSelection },
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
    let selection = options?.selection;
    if (!selection) {
      const lineMatch = /^(.*?):(\d+)(?::\d+)?$/.exec(target);
      if (lineMatch?.[1] && lineMatch[2]) {
        target = lineMatch[1].trim();
        const targetLine = parseInt(lineMatch[2], 10);
        if (targetLine > 0) selection = { startLine: targetLine, endLine: targetLine };
      }
    }

    const cleanTarget = target.replace(/[\\/]+$/, "");
    const base = this.host.getVaultBasePath();

    let abstractFile: any = null;

    // 3. Check absolute path on disk
    if (path.isAbsolute(target)) {
      const rel = path.relative(base, target).replace(/\\/g, "/");
      if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
        abstractFile = this.host.getAbstractFileByPath?.(rel);
        if (!abstractFile && cleanTarget) {
          const cleanRel = path.relative(base, cleanTarget).replace(/\\/g, "/");
          abstractFile = this.host.getAbstractFileByPath?.(cleanRel);
        }
      } else {
        // External path
        try {
          const targetExists = fs.existsSync(target);
          const cleanExists = cleanTarget ? fs.existsSync(cleanTarget) : false;
          if (targetExists || cleanExists) {
            const resolvedPath = targetExists ? target : cleanTarget;
            const stat = fs.statSync(resolvedPath);
            if (stat.isDirectory()) {
              if (this.host.showInFolder) {
                this.host.showInFolder(resolvedPath);
              } else if (this.host.openWithDefaultApp) {
                this.host.openWithDefaultApp(resolvedPath);
              }
              this.host.showNotice?.(`Opened folder: ${path.basename(resolvedPath)}`);
              return true;
            }
            if (stat.isFile()) {
              const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB preview threshold
              if (stat.size > MAX_FILE_SIZE) {
                if (this.host.openWithDefaultApp) {
                  this.host.openWithDefaultApp(resolvedPath);
                  this.host.showNotice?.(
                    `File exceeds 2MB preview limit; opened in default app: ${path.basename(resolvedPath)}`,
                  );
                  return true;
                }
                this.host.showNotice?.(
                  `File too large to preview (${Math.round(stat.size / 1024 / 1024)}MB): ${path.basename(resolvedPath)}`,
                );
                return false;
              }
              const content = fs.readFileSync(resolvedPath, "utf8");
              const title = path.basename(resolvedPath);
              if (this.host.leafHost && this.host.externalDocumentViewType) {
                await this.host.leafHost.reveal(this.host.externalDocumentViewType, {
                  placement: "tab",
                  bind: (view) => {
                    if (typeof view?.setDocPayload === "function") {
                      view.setDocPayload({
                        title,
                        filePath: resolvedPath,
                        content,
                        selection,
                      });
                    }
                  },
                });
                return true;
              }
              if (this.host.openWithDefaultApp) {
                this.host.openWithDefaultApp(resolvedPath);
                return true;
              }
            }
          } else {
            this.host.showNotice?.(`File not found: ${path.basename(target)}`);
            return false;
          }
        } catch (err) {
          console.error("[VaultDocumentRouter] Failed to open external file:", err);
          this.host.showNotice?.(`Failed to open external file: ${path.basename(target)}`);
          return false;
        }
      }
    }

    // 4. Check relative path in vault
    if (!abstractFile) {
      abstractFile = this.host.getAbstractFileByPath?.(target);
    }
    if (!abstractFile && cleanTarget) {
      abstractFile = this.host.getAbstractFileByPath?.(cleanTarget);
    }

    // 5. Check metadataCache destination
    if (!abstractFile) {
      abstractFile = this.host.getFirstLinkpathDest?.(cleanTarget || target, "") ?? null;
    }

    // 6. Match against vault files by name, basename, path, or trailing subpath
    if (!abstractFile) {
      abstractFile = this.findMatchingVaultFile(cleanTarget || target);
    }

    // 7. Match against vault folders
    if (!abstractFile) {
      const allLoaded = this.host.getAllLoadedFiles?.() ?? [];
      const lower = (cleanTarget || target).toLowerCase();
      const matchedFolder = allLoaded.find((file: any) => {
        if (!file || file.extension) return false;
        const folderPath = (file.path ?? "").toLowerCase();
        return folderPath === lower;
      });
      if (matchedFolder) {
        abstractFile = matchedFolder;
      }
    }

    // 8. Open or reveal in Obsidian
    if (abstractFile) {
      const isFolder = Boolean(abstractFile.children) && !abstractFile.extension;
      if (isFolder) {
        const leaves = this.host.getLeavesOfType?.("file-explorer") ?? [];
        if (leaves.length > 0 && leaves[0]?.view) {
          leaves[0].view.revealInFolder?.(abstractFile);
        }
        return true;
      }

      // When jumping to a specific line, use "source" mode so editor cursor is active;
      // otherwise use Reading View mode ("preview") for clean rendered markdown.
      const targetMode = selection ? "source" : "preview";

      // Check if tab is already open
      let existingLeaf: any;
      if (typeof this.host.iterateAllLeaves === "function") {
        this.host.iterateAllLeaves((l: any) => {
          if (!existingLeaf && l.view?.file?.path === abstractFile.path) {
            existingLeaf = l;
          }
        });
      } else if (typeof this.host.getLeavesOfType === "function") {
        const mdLeaves = this.host.getLeavesOfType("markdown") ?? [];
        for (const l of mdLeaves) {
          if (l.view?.file?.path === abstractFile.path) {
            existingLeaf = l;
            break;
          }
        }
      }

      let leaf: any = existingLeaf;
      if (leaf) {
        this.host.revealLeaf?.(leaf);
        this.host.setActiveLeaf?.(leaf, { focus: true });
      } else {
        leaf = this.host.getLeaf?.("tab") ?? this.host.getLeaf?.(false);
        if (leaf && typeof leaf.openFile === "function") {
          await leaf.openFile(abstractFile, {
            active: true,
            state: { mode: targetMode },
          });
        }
      }

      // Ensure appropriate mode
      if (leaf) {
        try {
          const vs = leaf.getViewState?.();
          if (
            vs &&
            (vs.type === "markdown" ||
              (!vs.type && (abstractFile.path?.endsWith?.(".md") ?? false)))
          ) {
            if (vs.state?.mode !== targetMode) {
              await leaf.setViewState?.({
                ...vs,
                type: "markdown",
                state: {
                  ...(vs.state ?? {}),
                  file: abstractFile.path,
                  mode: targetMode,
                },
              });
            }
          }
        } catch {}

        if (selection) {
          const editor = leaf.view?.editor;
          if (editor) {
            const line = Math.max(0, selection.startLine - 1);
            editor.setCursor?.({ line, ch: 0 });
            editor.scrollIntoView?.({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
          }
        }
        return true;
      }
    }

    // 9. Fallback: try openLinkText
    if (
      !path.isAbsolute(target) &&
      !target.startsWith("/") &&
      !target.startsWith("\\") &&
      this.host.openLinkText
    ) {
      try {
        await this.host.openLinkText(cleanTarget || target, "", false, {
          state: { mode: "preview" },
        });
        return true;
      } catch {}
    }

    return false;
  }
}
