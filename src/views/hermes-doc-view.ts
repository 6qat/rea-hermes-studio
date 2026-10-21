import path from "node:path";
import { ItemView, MarkdownRenderer, Notice, type WorkspaceLeaf } from "obsidian";
import type HermesStudioPlugin from "../main";

export const HERMES_DOC_VIEW_TYPE = "hermes-studio-doc-view";

export interface DocViewPayload {
  title: string;
  filePath: string;
  content: string;
  selection?: { startLine: number; endLine: number };
}

/**
 * An Obsidian ItemView that displays documents residing outside the vault
 * (such as ~/.hermes/skills/.../SKILL.md or memories) with native Markdown rendering
 * and dark theme styling, plus a quick action to open in the system default editor.
 */
export class HermesDocItemView extends ItemView {
  private currentPayload: DocViewPayload | undefined;

  constructor(
    leaf: WorkspaceLeaf,
    public readonly plugin: HermesStudioPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return HERMES_DOC_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.currentPayload?.title || "Hermes Document";
  }

  getIcon(): string {
    return "file-text";
  }

  setDocPayload(payload: DocViewPayload): void {
    this.currentPayload = payload;
    (this.leaf as any)?.updateHeader?.();
    void this.renderView();
  }

  async onOpen(): Promise<void> {
    await this.renderView();
  }

  private async renderView(): Promise<void> {
    const container = this.contentEl;
    if (!container) return;

    if (typeof container.empty === "function") {
      container.empty();
    } else {
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    }

    if (!this.currentPayload) return;

    const doc = container.ownerDocument || document;
    container.className = "hermes-doc-container";

    // Header bar
    const header = doc.createElement("div");
    header.className = "hermes-doc-header";

    const left = doc.createElement("div");
    left.className = "hermes-doc-header-left";

    const titleEl = doc.createElement("span");
    titleEl.textContent = this.currentPayload.title;
    titleEl.className = "hermes-doc-title";
    left.appendChild(titleEl);

    const isSkill = this.currentPayload.filePath.includes("skills");
    const badgeEl = doc.createElement("span");
    badgeEl.textContent = isSkill ? "Hermes Skill" : "External File";
    badgeEl.className = `hermes-doc-badge ${isSkill ? "hermes-doc-badge-skill" : "hermes-doc-badge-file"}`;
    left.appendChild(badgeEl);

    const right = doc.createElement("div");
    right.className = "hermes-doc-header-right";

    const pathEl = doc.createElement("span");
    pathEl.textContent = this.currentPayload.filePath;
    pathEl.className = "hermes-doc-path";
    pathEl.title = this.currentPayload.filePath;
    right.appendChild(pathEl);

    const openExternalBtn = doc.createElement("button");
    openExternalBtn.type = "button";
    openExternalBtn.textContent = "Open in Default App";
    openExternalBtn.className = "hermes-doc-open-btn";

    const targetPath = this.currentPayload.filePath;
    openExternalBtn.addEventListener("click", () => {
      const app = this.app as any;
      if (typeof app?.openWithDefaultApp === "function") {
        app.openWithDefaultApp(targetPath);
      } else if (typeof app?.showInFolder === "function") {
        app.showInFolder(targetPath);
      }
      new Notice(`Opening in default app: ${path.basename(targetPath)}`);
    });
    right.appendChild(openExternalBtn);

    header.appendChild(left);
    header.appendChild(right);
    container.appendChild(header);

    // Scrollable content area
    const scrollArea = doc.createElement("div");
    scrollArea.className = "hermes-doc-scroll";

    const bodyEl = doc.createElement("div");
    bodyEl.className =
      "markdown-rendered markdown-preview-view markdown-rendered-external hermes-doc-body";

    if (typeof MarkdownRenderer !== "undefined" && typeof MarkdownRenderer.render === "function") {
      try {
        await MarkdownRenderer.render(
          this.app,
          this.currentPayload.content,
          bodyEl,
          this.currentPayload.filePath,
          this,
        );
      } catch {
        const pre = doc.createElement("pre");
        pre.className = "hermes-doc-pre";
        pre.textContent = this.currentPayload.content;
        bodyEl.appendChild(pre);
      }
    } else {
      const pre = doc.createElement("pre");
      pre.className = "hermes-doc-pre";
      pre.textContent = this.currentPayload.content;
      bodyEl.appendChild(pre);
    }

    scrollArea.appendChild(bodyEl);
    container.appendChild(scrollArea);
  }
}
