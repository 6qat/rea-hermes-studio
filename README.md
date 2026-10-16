# Hermes Studio for Obsidian (`rea-hermes-studio`)

> **Hermes Studio** AI chat, workspace assistant, and diff workbench brought seamlessly into **Obsidian.md**.

A reverse-engineered, standalone port of the VSCode [Hermes Studio](https://marketplace.visualstudio.com/items?itemName=jefuriiij.hermes-studio) extension to Obsidian, engineered using patterns extracted from both Hermes Studio and Obsidian Copilot.

---

## ✨ Features

- **Obsidian Theme Harmony:** Seamlessly adapts to Obsidian's active theme (dark/light, accent colors, typography, background variables) via dynamic CSS variable injection into an isolated Shadow DOM.
- **Svelte 5 Reactive Webview:** Fast, fluid, modern UI architecture mounted inside an Obsidian View or floating Modal dialog.
- **VSCode API Bridge for Obsidian:** Complete compatibility shim that maps VSCode editor and workspace primitives to Obsidian's `App`, `Vault`, and `WorkspaceLeaf`:
  - Active note tracking and real-time selection updates.
  - Contextual markdown insertions and active editor line navigation.
  - Bidirectional WikiLink (`[[Note]]`) and Obsidian URL scheme (`obsidian://open?vault=...&file=...`) generation.
- **Unified Diff Engine & Workbench:** Side-by-side and unified diff visualization for AI-generated code and note edits before applying changes.
- **Dual Display Modes:**
  - **Sidebar / Right Leaf View:** Keep Hermes Studio docked alongside your notes for persistent conversational context and references.
  - **Floating Modal View:** Quick pop-out assistant callable anytime with a hotkey command (`Hermes Studio: Open assistant modal`).
- **Flexible AI Endpoint Integration:** Configurable server host and port (defaulting to `http://localhost:8080`), API keys, model selections, and custom temperature settings.

---

## 🏗️ Architecture

```
src/
├── core/
│   ├── hermes-bridge.ts         # Bidirectional postMessage event protocol
│   ├── hermes-core.ts           # State machine, chat history & engine
│   └── unified-diff-view.ts     # LCS / Line diff visualizer & chunk applicator
├── host/
│   ├── note-tracker.ts          # Active file watcher & selection listener
│   ├── obsidian-host.ts         # VSCode Workspace/Window API shim for Obsidian
│   └── wikilink-resolver.ts     # Markdown link & Obsidian URI handler
├── plugin/
│   ├── hermes-modal.ts          # Floating pop-out modal view
│   ├── hermes-view.ts           # Dockable Sidebar WorkspaceLeaf view
│   └── settings-tab.ts          # Plugin settings UI in Obsidian options
├── webview/
│   ├── obsidian-theme-bridge.ts # Syncs Obsidian CSS vars into Webview Shadow DOM
│   └── svelte-mount.ts          # Svelte 5 Webview component lifecycle mount
├── main.ts                      # Plugin entrypoint & lifecycle manager
└── types.ts                     # Protocol and Host type definitions
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Obsidian](https://obsidian.md/) (v1.5.0+)

### Building from Source

1. Clone this repository:
   ```bash
   git clone https://github.com/6qat/rea-hermes-studio.git
   cd rea-hermes-studio
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the plugin:
   ```bash
   npm run build
   ```

4. Run unit and integration tests:
   ```bash
   npm test
   ```

---

## 📥 Installation in Obsidian

1. Create a `hermes-studio` folder in your Obsidian vault's plugin directory:
   ```bash
   mkdir -p /path/to/your/vault/.obsidian/plugins/hermes-studio
   ```
2. Copy `main.js`, `manifest.json`, and `styles.css` into that directory:
   ```bash
   cp main.js manifest.json styles.css /path/to/your/vault/.obsidian/plugins/hermes-studio/
   ```
3. Open Obsidian, go to **Settings → Community Plugins**, reload plugins, and enable **Hermes Studio**.

---

## ⌨️ Commands

- `Hermes Studio: Open sidebar view` - Opens or focuses the Hermes Studio assistant in the right sidebar.
- `Hermes Studio: Open assistant modal` - Displays the assistant in a modal overlay over your active note.
- `Hermes Studio: Insert active note context` - Sends current file content and highlighted text into the assistant session.

---

## 🧪 Testing

Comprehensive test suites verify the host API shim, note tracking, diff generation, and WikiLink resolution:

```bash
npm test
```

All 10 tests across all 4 suites are automated with Vitest.

---

## 📜 License

MIT License. Designed and reverse-engineered with REA.
