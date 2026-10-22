// @vitest-environment jsdom

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  VaultDocumentRouter,
  type VaultRouterHostAdapter,
} from "../src/host/vault-document-router";

describe("VaultDocumentRouter", () => {
  function createTestHarness() {
    const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), "router-test-vault-"));
    const openedFiles: any[] = [];
    const openLeaves: any[] = [];
    const notices: string[] = [];
    const activeLeaves: any[] = [];

    // Create a real file in tmpVault
    const testNotePath = path.join(tmpVault, "Meus Documentos.md");
    fs.writeFileSync(testNotePath, "# Test Note Content", "utf8");

    const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), "router-ext-dir-"));
    const externalFile = path.join(externalDir, "SKILL.md");
    fs.writeFileSync(externalFile, "# External Skill", "utf8");

    const vaultFiles = [
      { name: "Meus Documentos.md", basename: "Meus Documentos", path: "Meus Documentos.md" },
      {
        name: "Torresminho e Vida - Doutor Churras.md",
        basename: "Torresminho e Vida - Doutor Churras",
        path: "Torresminho e Vida - Doutor Churras.md",
      },
      { name: "To Study.md", basename: "To Study", path: "To Study.md" },
      {
        name: "Hermes to Headless Antigravity (agy).md",
        basename: "Hermes to Headless Antigravity (agy)",
        path: "AI/Hermes to Headless Antigravity (agy).md",
      },
      { name: "AI.md", basename: "AI", path: "AI/AI.md" },
      {
        name: "Guiga.md",
        basename: "Guiga",
        path: "CONTENT_CREATION/Guiga/Guiga.md",
      },
      {
        name: "identidade-1.jpg",
        basename: "identidade-1",
        path: "attachments/identidade-1.jpg",
      },
    ];

    const hostAdapter: VaultRouterHostAdapter = {
      getVaultBasePath: () => tmpVault,
      getFiles: () => vaultFiles,
      getMarkdownFiles: () => vaultFiles.filter((f) => f.path.endsWith(".md")),
      getAllLoadedFiles: () => [
        ...vaultFiles,
        { path: "attachments", children: [{ path: "attachments/identidade-1.jpg" }] },
      ],
      getAbstractFileByPath: (p: string) => {
        const found = vaultFiles.find((f) => f.path === p);
        if (found) return found;
        if (p === "attachments") return { path: "attachments", children: [] };
        return null;
      },
      getFirstLinkpathDest: (p: string) => {
        if (p === "Meus Documentos.md" || p === "Meus Documentos") {
          return { path: "Meus Documentos.md" };
        }
        if (p === "identidade-1.jpg") {
          return { path: "attachments/identidade-1.jpg" };
        }
        return null;
      },
      iterateAllLeaves: (cb: (l: any) => void) => {
        for (const l of openLeaves) cb(l);
      },
      getLeavesOfType: (t: string) => openLeaves.filter((l: any) => l.view?.getViewType?.() === t),
      getLeaf: () => {
        let cursorSet: any = null;
        let scrolledTo: any = null;
        const leaf: any = {
          view: {
            file: null,
            editor: {
              setCursor: (pos: any) => {
                cursorSet = pos;
              },
              scrollIntoView: (range: any) => {
                scrolledTo = range;
              },
            },
          },
          currentMode: "source",
          getViewState: () => ({
            type: "markdown",
            state: { mode: leaf.currentMode, file: leaf.view.file?.path },
          }),
          setViewState: async (vs: any) => {
            if (vs?.state?.mode) leaf.currentMode = vs.state.mode;
          },
          openFile: async (f: any, opts: any) => {
            leaf.view.file = f;
            if (opts?.state?.mode) leaf.currentMode = opts.state.mode;
            openedFiles.push({ file: f, opts });
          },
          getCursor: () => cursorSet,
          getScroll: () => scrolledTo,
        };
        openLeaves.push(leaf);
        return leaf;
      },
      revealLeaf: async () => {},
      setActiveLeaf: (l: any) => {
        activeLeaves.push(l);
      },
      showNotice: (msg: string) => {
        notices.push(msg);
      },
      leafHost: {
        reveal: async (_viewType: string, options?: { bind?: (view: any) => void }) => {
          const view = {
            setDocPayload: (payload: any) => {
              openedFiles.push({ docPayload: payload });
            },
          };
          options?.bind?.(view);
        },
      },
      externalDocumentViewType: "hermes-studio-doc-view",
      openWithDefaultApp: (p) => {
        openedFiles.push({ defaultApp: p });
      },
    };

    const router = new VaultDocumentRouter(hostAdapter);

    return {
      router,
      tmpVault,
      externalFile,
      openedFiles,
      openLeaves,
      notices,
      activeLeaves,
    };
  }

  describe("isPathKnown", () => {
    it("recognizes vault files by relative path, basename, and trailing subpath", () => {
      const { router } = createTestHarness();

      expect(router.isPathKnown("Meus Documentos.md")).toBe(true);
      expect(router.isPathKnown("Meus Documentos")).toBe(true);
      expect(router.isPathKnown("[[Meus Documentos]]")).toBe(true);
      expect(router.isPathKnown("AI/Hermes to Headless Antigravity (agy).md")).toBe(true);
      expect(router.isPathKnown("Hermes to Headless Antigravity (agy)")).toBe(true);
      expect(router.isPathKnown("Guiga/Guiga")).toBe(true);
      expect(router.isPathKnown("attachments")).toBe(true);
      expect(router.isPathKnown("NonExistentNote.md")).toBe(false);
    });

    it("recognizes absolute paths within and outside vault", () => {
      const { router, tmpVault, externalFile } = createTestHarness();
      const inVaultAbs = path.join(tmpVault, "Meus Documentos.md");

      expect(router.isPathKnown(inVaultAbs)).toBe(true);
      expect(router.isPathKnown(externalFile)).toBe(true);
      expect(router.isPathKnown("/definitely/nonexistent/file.md")).toBe(false);
    });
  });

  describe("resolveWikiLink", () => {
    it("resolves direct notes and trailing subpaths", () => {
      const { router } = createTestHarness();

      expect(router.resolveWikiLink("Meus Documentos")).toBe("Meus Documentos.md");
      expect(router.resolveWikiLink("Guiga/Guiga")).toBe("CONTENT_CREATION/Guiga/Guiga.md");
      expect(router.resolveWikiLink("NonExistent")).toBeUndefined();
    });
  });

  describe("linkify & linkifyVaultReferences", () => {
    it("converts [[WikiLinks]] and bullet note references to Reading View links", () => {
      const { router } = createTestHarness();

      const input = `
Here are the notes:
- Meus Documentos
- 10:30 — To Study
- NotANote

And an explicit link [[AI/AI|Artificial Intelligence]] and fenced code:
\`\`\`markdown
- Meus Documentos
\`\`\`
      `;

      const output = router.linkify(input);

      expect(output).toContain("[Meus Documentos](wikilink://Meus%20Documentos.md)");
      expect(output).toContain("[To Study](wikilink://To%20Study.md)");
      expect(output).toContain("[Artificial Intelligence](wikilink://AI%2FAI.md)");
      // Fenced code must remain protected
      expect(output).toContain("```markdown\n- Meus Documentos\n```");
      // Non-existent notes must not be linkified
      expect(output).toContain("- NotANote");

      // Canonical glossary alias
      expect(router.linkifyVaultReferences(input)).toBe(output);
    });
  });

  describe("routeUri", () => {
    it("opens vault document in Reading View mode and reuses existing tab", async () => {
      const { router, openedFiles, openLeaves, activeLeaves } = createTestHarness();

      // First open: creates leaf with mode 'preview'
      const res1 = await router.routeUri("wikilink://Meus%20Documentos");
      expect(res1).toBe(true);
      expect(openedFiles.length).toBe(1);
      expect(openLeaves[0].currentMode).toBe("preview");

      // Second open: reuses existing leaf
      const res2 = await router.routeUri("obsidian://open?file=Meus%20Documentos.md");
      expect(res2).toBe(true);
      expect(activeLeaves.length).toBeGreaterThan(0);
    });

    it("handles line numbers, switches to source mode, and positions cursor", async () => {
      const { router, openLeaves } = createTestHarness();

      const res = await router.routeUri("Meus Documentos.md:42");
      expect(res).toBe(true);
      expect(openLeaves.length).toBe(1);
      expect(openLeaves[0].currentMode).toBe("source");
      expect(openLeaves[0].getCursor()).toEqual({ line: 41, ch: 0 });
    });

    it("opens external files through the leaf host", async () => {
      const { router, externalFile, openedFiles } = createTestHarness();

      const res = await router.routeUri(externalFile);
      expect(res).toBe(true);
      expect(openedFiles.some((f) => f.docPayload?.filePath === externalFile)).toBe(true);
    });

    it("opens large external files (> 2MB) in default app to protect memory", async () => {
      const { router, tmpVault, openedFiles, notices } = createTestHarness();
      const largeFile = path.join(tmpVault, "../large-external-file.log");
      // Create a 2.5MB file
      fs.writeFileSync(largeFile, Buffer.alloc(2.5 * 1024 * 1024, "A"));

      try {
        const res = await router.routeUri(largeFile);
        expect(res).toBe(true);
        expect(openedFiles.some((f) => f.defaultApp === largeFile)).toBe(true);
        expect(notices.some((n) => n.includes("exceeds 2MB preview limit"))).toBe(true);
      } finally {
        fs.rmSync(largeFile, { force: true });
      }
    });
  });
});
