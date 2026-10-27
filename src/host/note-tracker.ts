import path from "node:path";

export interface TrackedSelection {
  startLine: number;
  endLine: number;
  text: string;
}

export interface TrackedNoteState {
  relPath: string;
  absPath: string;
  cursorLine: number;
  selection?: TrackedSelection;
}

export interface VaultNoteTrackerOptions {
  vaultBasePath: string;
  resolveWikiLink?: (linkpath: string, sourcePath?: string) => string | undefined;
  preserveOnViewTypes?: string[];
  onChange?: (state: TrackedNoteState | undefined) => void;
}

/**
 * Extracts Obsidian [[WikiLink]] target paths from markdown/prompt text,
 * stripping optional `#heading` anchors and `|alias` display labels.
 */
export function extractWikiLinks(text: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  const regex = /\[\[([^\]|#\r\n]+)(?:#[^\]|\r\n]*)?(?:\|[^\]\r\n]*)?\]\]/g;
  for (let match = regex.exec(text); match !== null; match = regex.exec(text)) {
    const target = match[1]?.trim();
    if (target && !seen.has(target)) {
      seen.add(target);
      results.push(target);
    }
  }
  return results;
}

const DEFAULT_PRESERVE_VIEWS = new Set([
  "hermes-studio-side-view",
  "hermes-studio-editor-view",
  "hermes-studio-diff-view",
]);

export class VaultNoteTracker {
  private state: TrackedNoteState | undefined;
  private isNotifying = false;
  private readonly vaultBasePath: string;
  private readonly resolveWikiLink?: (linkpath: string, sourcePath?: string) => string | undefined;
  private readonly preserveViews: Set<string>;
  private readonly onChange?: (state: TrackedNoteState | undefined) => void;

  constructor(options: VaultNoteTrackerOptions) {
    this.vaultBasePath = options.vaultBasePath;
    this.resolveWikiLink = options.resolveWikiLink;
    this.preserveViews = new Set(options.preserveOnViewTypes ?? [...DEFAULT_PRESERVE_VIEWS]);
    this.onChange = options.onChange;
  }

  get current(): TrackedNoteState | undefined {
    return this.state;
  }

  updateFromEditor(
    input: {
      relPath: string;
      cursorLine: number;
      selection?: TrackedSelection;
    },
    options?: { silent?: boolean },
  ): void {
    const cleanRel = input.relPath.replace(/\\/g, "/");
    const nextSelection =
      input.selection && input.selection.text.length > 0 ? input.selection : undefined;
    const nextState: TrackedNoteState = {
      relPath: cleanRel,
      absPath: path.join(this.vaultBasePath, cleanRel),
      cursorLine: Math.max(1, input.cursorLine),
      ...(nextSelection ? { selection: nextSelection } : {}),
    };

    const prev = this.state;
    const isSame =
      prev !== undefined &&
      prev.relPath === nextState.relPath &&
      prev.absPath === nextState.absPath &&
      prev.cursorLine === nextState.cursorLine &&
      prev.selection?.startLine === nextState.selection?.startLine &&
      prev.selection?.endLine === nextState.selection?.endLine &&
      prev.selection?.text === nextState.selection?.text;

    this.state = nextState;
    if (!options?.silent && !isSame && !this.isNotifying) {
      this.isNotifying = true;
      try {
        this.onChange?.(this.state);
      } finally {
        this.isNotifying = false;
      }
    }
  }

  onActiveLeafChanged(viewType: string | undefined): void {
    if (viewType && this.preserveViews.has(viewType)) {
      // Preserve last active Markdown note when focus enters Hermes Studio
      return;
    }
    if (viewType && viewType !== "markdown") {
      // Non-markdown leaf that isn't Hermes Studio: keep previous note if open in tabs,
      // mirroring Obsidian Copilot's preserveOnViewTypes behavior
      return;
    }
  }

  clear(): void {
    this.state = undefined;
    this.onChange?.(undefined);
  }

  /**
   * Resolves all [[WikiLinks]] in a user prompt to relative vault paths.
   */
  resolvePromptWikiLinks(promptText: string): string[] {
    if (!this.resolveWikiLink) return [];
    const links = extractWikiLinks(promptText);
    const resolved: string[] = [];
    for (const link of links) {
      const rel = this.resolveWikiLink(link, this.state?.relPath);
      if (rel && !resolved.includes(rel)) {
        resolved.push(rel);
      }
    }
    return resolved;
  }
}
