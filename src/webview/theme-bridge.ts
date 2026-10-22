import { HERMES_WEBVIEW_BASE_CSS } from "./webview-base-css";

export { HERMES_WEBVIEW_BASE_CSS };

/**
 * Maps every --vscode-* variable referenced in Hermes Studio's Tailwind v4
 * webview.css to Obsidian's native CSS custom properties, with dark-theme
 * slate/indigo fallbacks so the UI looks identical to VSCode Hermes Studio.
 */
export const THEME_BRIDGE_CSS = `
:host, :root, #hermes-studio-root, #app {
  /* Typography */
  --vscode-font-family: var(--font-interface, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
  --vscode-editor-font-family: var(--font-monospace, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  --vscode-font-size: var(--font-ui-small, 13px);
  --vscode-editor-font-size: var(--font-smaller, 12.5px);
  --vscode-font-weight: var(--font-normal, 400);

  /* Core Surfaces & Text (Dark-first palette) */
  --vscode-foreground: var(--text-normal, #e2e8f0);
  --vscode-descriptionForeground: var(--text-muted, #94a3b8);
  --vscode-sideBar-background: var(--background-secondary, #0f172a);
  --vscode-editor-background: var(--background-primary, #0b0f19);
  --vscode-editorWidget-background: var(--background-secondary-alt, #1e293b);
  --vscode-editorWidget-border: var(--background-modifier-border, #334155);
  --vscode-panel-border: var(--background-modifier-border, #1e293b);
  --vscode-widget-border: var(--background-modifier-border, #334155);
  --vscode-widget-shadow: rgba(0, 0, 0, 0.45);
  --vscode-contrastBorder: transparent;
  --vscode-contrastActiveBorder: var(--interactive-accent, #6366f1);
  --vscode-focusBorder: var(--interactive-accent, #6366f1);

  /* Inputs */
  --vscode-input-background: var(--background-modifier-form-field, #0f172a);
  --vscode-input-foreground: var(--text-normal, #f1f5f9);
  --vscode-input-border: var(--background-modifier-border, #334155);
  --vscode-input-placeholderForeground: var(--text-faint, #64748b);

  /* Buttons */
  --vscode-button-background: var(--interactive-accent, #6366f1);
  --vscode-button-foreground: var(--text-on-accent, #ffffff);
  --vscode-button-hoverBackground: var(--interactive-accent-hover, #4f46e5);
  --vscode-button-border: transparent;
  --vscode-button-secondaryBackground: var(--background-modifier-hover, #1e293b);
  --vscode-button-secondaryForeground: var(--text-normal, #e2e8f0);
  --vscode-button-secondaryHoverBackground: var(--background-modifier-active-hover, #334155);

  /* Lists, Toolbars, Tabs & Badges */
  --vscode-toolbar-hoverBackground: var(--background-modifier-hover, rgba(255, 255, 255, 0.06));
  --vscode-list-hoverBackground: var(--background-modifier-hover, rgba(255, 255, 255, 0.06));
  --vscode-list-activeSelectionBackground: var(--background-modifier-active-hover, rgba(99, 102, 241, 0.22));
  --vscode-list-activeSelectionForeground: var(--text-normal, #f8fafc);
  --vscode-panelTitle-activeForeground: var(--text-normal, #f8fafc);
  --vscode-panelTitle-inactiveForeground: var(--text-muted, #94a3b8);
  --vscode-panelTitle-activeBorder: var(--interactive-accent, #6366f1);
  --vscode-activityBarBadge-background: var(--interactive-accent, #6366f1);
  --vscode-activityBarBadge-foreground: var(--text-on-accent, #ffffff);
  --vscode-badge-background: var(--interactive-accent, #6366f1);
  --vscode-badge-foreground: var(--text-on-accent, #ffffff);

  /* Links, Code, Quotes & Tables */
  --vscode-textLink-foreground: var(--link-color, #818cf8);
  --vscode-textLink-activeForeground: var(--link-color-hover, #a5b4fc);
  --vscode-textCodeBlock-background: var(--code-background, #0f172a);
  --vscode-textBlockQuote-background: rgba(148, 163, 184, 0.08);
  --vscode-textBlockQuote-border: var(--blockquote-border-color, #475569);
  --vscode-keybindingTable-headerBackground: rgba(255, 255, 255, 0.04);

  /* Chat Bubbles */
  --vscode-chat-requestBubbleBackground: var(--background-secondary-alt, #1e293b);
  --vscode-chat-requestBackground: var(--background-secondary-alt, #1e293b);
  --vscode-chat-requestBorder: var(--background-modifier-border, #334155);

  /* Status, Alerts & Hermes Brand Accent */
  --vscode-charts-yellow: var(--color-yellow, #f59e0b);
  --vscode-charts-green: var(--color-green, #10b981);
  --vscode-testing-iconPassed: var(--color-green, #10b981);
  --vscode-errorForeground: var(--text-error, #ef4444);
  --vscode-editorError-foreground: var(--text-error, #ef4444);
  --vscode-editorWarning-foreground: var(--color-orange, #f59e0b);
  --vscode-editorInfo-foreground: var(--color-blue, #3b82f6);
  --vscode-progressBar-background: var(--interactive-accent, #6366f1);
  --vscode-statusBarItem-errorBackground: var(--background-modifier-error, #dc2626);
  --vscode-statusBarItem-errorForeground: #ffffff;

  /* Diff Colors */
  --vscode-diffEditor-insertedLineBackground: rgba(16, 185, 129, 0.16);
  --vscode-diffEditor-insertedTextBackground: rgba(16, 185, 129, 0.24);
  --vscode-diffEditor-removedLineBackground: rgba(239, 68, 68, 0.16);
  --vscode-diffEditor-removedTextBackground: rgba(239, 68, 68, 0.24);

  /* Syntax Highlighting & Debug Tokens */
  --vscode-symbolIcon-variableForeground: var(--color-cyan, #38bdf8);
  --vscode-symbolIcon-functionForeground: var(--color-purple, #c084fc);
  --vscode-symbolIcon-classForeground: var(--color-yellow, #fbbf24);
  --vscode-debugTokenExpression-string: var(--color-green, #34d399);
  --vscode-debugTokenExpression-number: var(--color-orange, #fb923c);
  --vscode-debugTokenExpression-boolean: var(--color-blue, #60a5fa);
  --vscode-debugTokenExpression-name: var(--color-purple, #a78bfa);
}

#hermes-studio-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--hs-surface, var(--vscode-sideBar-background));
  color: var(--vscode-foreground);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  line-height: 1.4;
  overflow: hidden;
  user-select: text;
  -webkit-user-select: text;
}

#hermes-studio-root[data-place="editor"] {
  --hs-surface: var(--vscode-editor-background);
}

#app {
  width: 100%;
  height: 100%;
  user-select: text;
  -webkit-user-select: text;
}

/* Ensure messages, user bubbles, assistant text, and code are copyable & selectable */
.bg-user-bubble,
.user-foot,
.md,
.code-block,
pre,
code,
p,
span,
[role="log"],
[role="tabpanel"] {
  user-select: text !important;
  -webkit-user-select: text !important;
}

/* Control elements remain non-selectable */
button,
[role="tab"],
[role="button"],
.btn,
.icon-btn,
.plus-btn,
.reply-act,
.user-copy-btn {
  user-select: none !important;
  -webkit-user-select: none !important;
}

/* User message copy button styling */
.user-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  color: var(--color-muted);
  font-size: 11.5px;
  margin-top: 2px;
}

.user-copy-btn {
  height: 20px;
  color: var(--color-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 4px;
  align-items: center;
  gap: 4px;
  padding: 0 5px;
  display: inline-flex;
  opacity: 0.85;
  transition: opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease;
}

.user-copy-btn:hover {
  background: var(--color-toolbar-hover);
  color: var(--color-fg);
  opacity: 1;
}

/* Effort slider unsupported state */
.effort-slider.is-unsupported {
  opacity: 0.35 !important;
  cursor: not-allowed !important;
  pointer-events: none !important;
}
`;
