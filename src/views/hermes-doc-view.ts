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
      container.innerHTML = "";
    }

    if (!this.currentPayload) return;

    const doc = container.ownerDocument || document;

    container.style.cssText = [
      "display:flex",
      "flex-direction:column",
      "height:100%",
      "background:var(--background-primary, #0b0f19)",
      "color:var(--text-normal, #e2e8f0)",
      "font-family:var(--font-interface, sans-serif)",
      "overflow:hidden",
    ].join(";");

    // Header bar
    const header = doc.createElement("div");
    header.className = "hermes-doc-header";
    header.style.cssText = [
      "display:flex",
      "align-items:center",
      "justify-content:space-between",
      "gap:12px",
      "padding:10px 16px",
      "background:var(--background-secondary, #0f172a)",
      "border-bottom:1px solid var(--background-modifier-border, #1e293b)",
      "flex-shrink:0",
    ].join(";");

    const left = doc.createElement("div");
    left.style.cssText = "display:flex;align-items:center;gap:8px;min-width:0;overflow:hidden;";

    const titleEl = doc.createElement("span");
    titleEl.textContent = this.currentPayload.title;
    titleEl.style.cssText =
      "font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    left.appendChild(titleEl);

    const isSkill = this.currentPayload.filePath.includes("skills");
    const badgeEl = doc.createElement("span");
    badgeEl.textContent = isSkill ? "Hermes Skill" : "External File";
    badgeEl.style.cssText = [
      "font-size:10px",
      "font-weight:600",
      "text-transform:uppercase",
      "letter-spacing:0.05em",
      "padding:2px 6px",
      "border-radius:4px",
      isSkill
        ? "background:rgba(217,119,6,0.18);color:#fbbf24"
        : "background:rgba(99,102,241,0.2);color:#818cf8",
      "white-space:nowrap",
      "flex-shrink:0",
    ].join(";");
    left.appendChild(badgeEl);

    const right = doc.createElement("div");
    right.style.cssText = "display:flex;align-items:center;gap:8px;flex-shrink:0;";

    const pathEl = doc.createElement("span");
    pathEl.textContent = this.currentPayload.filePath;
    pathEl.style.cssText = [
      "font-size:11px",
      "color:var(--text-muted, #94a3b8)",
      "max-width:320px",
      "overflow:hidden",
      "text-overflow:ellipsis",
      "white-space:nowrap",
    ].join(";");
    pathEl.title = this.currentPayload.filePath;
    right.appendChild(pathEl);

    const openExternalBtn = doc.createElement("button");
    openExternalBtn.type = "button";
    openExternalBtn.textContent = "Open in Default App";
    openExternalBtn.style.cssText = [
      "background:var(--interactive-normal, #1e293b)",
      "color:var(--text-normal, #e2e8f0)",
      "border:1px solid var(--background-modifier-border, #334155)",
      "border-radius:5px",
      "padding:4px 10px",
      "font-size:11px",
      "cursor:pointer",
    ].join(";");

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
    scrollArea.style.cssText = "flex:1;overflow:auto;padding:20px 28px;";

    const bodyEl = doc.createElement("div");
    bodyEl.className = "markdown-rendered markdown-preview-view markdown-rendered-external";
    bodyEl.style.cssText = [
      "max-width:850px",
      "margin:0 auto",
      "line-height:1.65",
      "font-size:14px",
      "color:var(--text-normal, #e2e8f0)",
    ].join(";");

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
        pre.style.cssText = "white-space:pre-wrap;word-break:break-word;font-family:monospace;";
        pre.textContent = this.currentPayload.content;
        bodyEl.appendChild(pre);
      }
    } else {
      const pre = doc.createElement("pre");
      pre.style.cssText = "white-space:pre-wrap;word-break:break-word;font-family:monospace;";
      pre.textContent = this.currentPayload.content;
      bodyEl.appendChild(pre);
    }

    scrollArea.appendChild(bodyEl);
    container.appendChild(scrollArea);
  }
}
