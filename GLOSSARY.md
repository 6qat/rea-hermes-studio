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
