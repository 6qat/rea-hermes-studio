# rea-hermes-studio

Hermes Studio plugin for Obsidian, bringing an autonomous AI coding assistant and agent environment into Obsidian vaults with full VS Code parity.

## Language

**VaultDocumentRouter**:
The central module that resolves vault paths, handles specialized URI schemes (`obsidian://`, `wikilink://`, `file://`), and navigates Obsidian workspace leaves into Reading View mode.
_Avoid_: PathHelper, FileOpener, LinkService

**Vault Reference Linkification**:
The transformation of plain-text note titles and `[[WikiLinks]]` in assistant markdown output into clickable links that open target notes in Reading View mode.
_Avoid_: MarkdownEnhancer, AutoLinker, TextTransformer

**Reading View Mode**:
Obsidian's rendered Markdown preview mode (`mode: "preview"`), ensuring notes opened from assistant responses are rendered cleanly without raw markdown source syntax.
_Avoid_: PreviewMode, DisplayMode, RenderedView

**ObsidianHostBridge**:
The consolidated host seam that packages filesystem, UI dialogs, editor state, and settings into cohesive adapters feeding the VS Code emulation engine.
_Avoid_: DependencyBag, HostConfig, ShimOptions

**VaultFileSystem**:
The adapter handling vault-compliant and disk-fallback file inspection, reading, directory listing, and file watcher events for the VS Code workspace.
_Avoid_: FsHelper, StorageService

**WorkspaceUi**:
The adapter encapsulating Obsidian modal pickers, notices, diff views, and sidebar tab activations.
_Avoid_: DialogManager, UiService

**EditorSession**:
The adapter tracking active note metadata, cursor positions, document selections, and vault diagnostics.
_Avoid_: EditorTracker, SessionState

**SettingsAdapter**:
The adapter handling retrieval and asynchronous persistence of extension configuration and user settings.
_Avoid_: ConfigManager, SettingsStore

**Vault Click Port**:
The module that decides whether a webview navigation message is handled by VaultDocumentRouter or forwarded to the core. `checkPaths` is answered here and is not forwarded.
_Avoid_: MessageFilter, LinkDispatcher, ClickHandler

**Workspace Leaf Host**:
The module that reuses or creates one workspace leaf for a view type, reveals it, and binds a payload. Side, editor, diff, and external-document opens share this module.
_Avoid_: LeafManager, ViewService, TabHelper

**Prompt History Buffer**:
The bounded, persisted queue of sent user chat prompts navigable in the composer input field via `ArrowUp` and `ArrowDown`.
_Avoid_: CommandHistory, InputStack, ChatRecallQueue
