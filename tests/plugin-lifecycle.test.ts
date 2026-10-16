// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileSystemAdapter } from "obsidian";
import HermesStudioPlugin, {
  HERMES_SIDE_VIEW_TYPE,
  HERMES_EDITOR_VIEW_TYPE,
  HERMES_DIFF_VIEW_TYPE,
} from "../src/main";

describe("HermesStudioPlugin lifecycle & views", () => {
  it("registers views, ribbon icon, settings tab, commands, mounts HermesStudioView Shadow DOM, and renders HermesDiffItemView", async () => {
    const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-plugin-test-"));
    const adapter = new (FileSystemAdapter as any)(tmpVault);

    const openedFiles: any[] = [];
    const mockApp: any = {
      vault: {
        adapter,
        getName: () => "PluginTestVault",
        getFiles: () => [
          { name: "Meus Documentos.md", basename: "Meus Documentos", path: "Meus Documentos.md" },
          { name: "identidade-1.jpg", basename: "identidade-1", path: "attachments/identidade-1.jpg" },
        ],
        getMarkdownFiles: () => [
          { name: "Meus Documentos.md", basename: "Meus Documentos", path: "Meus Documentos.md" },
        ],
        getAbstractFileByPath: (p: string) => {
          if (p === "Meus Documentos.md")
            return { name: "Meus Documentos.md", path: "Meus Documentos.md" };
          if (p === "attachments/identidade-1.jpg")
            return { name: "identidade-1.jpg", path: "attachments/identidade-1.jpg" };
          if (p === "attachments")
            return { name: "attachments", path: "attachments" };
          return null;
        },
      },
      metadataCache: {
        getFirstLinkpathDest: (p: string) => {
          if (p === "Meus Documentos.md" || p === "Meus Documentos")
            return { name: "Meus Documentos.md", path: "Meus Documentos.md" };
          if (p === "identidade-1.jpg")
            return { name: "identidade-1.jpg", path: "attachments/identidade-1.jpg" };
          return null;
        },
        unresolvedLinks: {},
      },
      workspace: {
        on: () => ({}),
        getLeavesOfType: () => [],
        getRightLeaf: () => ({
          setViewState: async () => {},
        }),
        getLeaf: () => ({
          setViewState: async () => {},
          openFile: async (file: any) => {
            openedFiles.push(file);
          },
        }),
        revealLeaf: async () => {},
        getActiveViewOfType: () => null,
      },
      setting: {
        open: () => {},
        openTabById: () => {},
      },
    };

    const plugin = new HermesStudioPlugin(mockApp, {
      id: "hermes-studio",
      name: "Hermes Studio",
      version: "0.6.6",
      dir: tmpVault,
    } as any);

    // Avoid spawning external hermes daemon during unit test
    plugin.loadData = async () => ({
      path: "/nonexistent/hermes-binary-for-unit-test",
      autoStart: false,
    });

    await plugin.onload();

    expect((plugin as any).views.has(HERMES_SIDE_VIEW_TYPE)).toBe(true);
    expect((plugin as any).views.has(HERMES_EDITOR_VIEW_TYPE)).toBe(true);
    expect((plugin as any).views.has(HERMES_DIFF_VIEW_TYPE)).toBe(true);
    expect((plugin as any).ribbonIcons.length).toBe(1);
    expect((plugin as any).commands.length).toBeGreaterThanOrEqual(10);

    // 1. Instantiate the side view and verify Shadow DOM Svelte 5 UI mounts
    const sideFactory = (plugin as any).views.get(HERMES_SIDE_VIEW_TYPE);
    const sideView = sideFactory({ app: mockApp });
    document.body.appendChild(sideView.containerEl);
    await sideView.onOpen();

    await new Promise((r) => setTimeout(r, 60));
    expect(sideView.contentEl.shadowRoot).not.toBeNull();
    expect(
      sideView.contentEl.shadowRoot!.getElementById("app"),
    ).not.toBeNull();

    // 2. Instantiate the diff view and verify unified diff rendering
    const diffFactory = (plugin as any).views.get(HERMES_DIFF_VIEW_TYPE);
    const diffView = diffFactory({ app: mockApp });
    document.body.appendChild(diffView.containerEl);
    await diffView.onOpen();
    diffView.setDiffPayload({
      title: "Notes/Idea.md (Hermes Edit)",
      beforeText: "# Old Title\n",
      afterText: "# New Title\nAdded paragraph\n",
      filePath: path.join(tmpVault, "Notes/Idea.md"),
    });
    expect(diffView.contentEl.textContent).toContain("Notes/Idea.md (Hermes Edit)");
    expect(diffView.contentEl.textContent).toContain("Added paragraph");

    // 3. Verify vault document detection and opening
    expect(plugin.isVaultPathKnown("Meus Documentos.md")).toBe(true);
    expect(plugin.isVaultPathKnown("Meus Documentos")).toBe(true);
    expect(plugin.isVaultPathKnown("identidade-1.jpg")).toBe(true);
    expect(plugin.isVaultPathKnown("attachments/")).toBe(true);
    expect(plugin.isVaultPathKnown("nonexistent-document.pdf")).toBe(false);

    const opened1 = await plugin.openVaultFile("Meus Documentos.md");
    expect(opened1).toBe(true);
    expect(openedFiles.some((f) => f.name === "Meus Documentos.md")).toBe(true);

    const opened2 = await plugin.openVaultFile("identidade-1.jpg");
    expect(opened2).toBe(true);
    expect(openedFiles.some((f) => f.name === "identidade-1.jpg")).toBe(true);

    await sideView.onClose();
    sideView.containerEl.remove();
    diffView.containerEl.remove();
    await plugin.onunload();
    fs.rmSync(tmpVault, { recursive: true, force: true });
  });
});
