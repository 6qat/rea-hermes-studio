// @vitest-environment jsdom

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileSystemAdapter } from "obsidian";
import { describe, expect, it } from "vitest";
import HermesStudioPlugin, {
  HERMES_DIFF_VIEW_TYPE,
  HERMES_DOC_VIEW_TYPE,
  HERMES_EDITOR_VIEW_TYPE,
  HERMES_SIDE_VIEW_TYPE,
} from "../src/main";

describe("HermesStudioPlugin lifecycle & views", () => {
  it("registers views, ribbon icon, settings tab, commands, mounts HermesStudioView Shadow DOM, and renders HermesDiffItemView", async () => {
    const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-plugin-test-"));
    const adapter = new (FileSystemAdapter as any)(tmpVault);

    const openedFiles: any[] = [];
    const openLeaves: any[] = [];
    const setActiveLeafCalls: any[] = [];
    const workspaceListeners = new Map<string, Array<(...args: any[]) => void>>();
    let currentActiveMdView: any = null;
    const mockApp: any = {
      vault: {
        adapter,
        getName: () => "PluginTestVault",
        getFiles: () => [
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
          { name: "v1.3.2-v1.3.6.md", basename: "v1.3.2-v1.3.6", path: "AI/v1.3.2-v1.3.6.md" },
          {
            name: "Receita Cardiológica - SOS Cardio (junho 2026).md",
            basename: "Receita Cardiológica - SOS Cardio (junho 2026)",
            path: "SAÚDE/Receita Cardiológica - SOS Cardio (junho 2026).md",
          },
          {
            name: "Guiga.md",
            basename: "Guiga",
            path: "CONTENT_CREATION/Guiga/Guiga.md",
          },
          {
            name: "Daily Research Digest.md",
            basename: "Daily Research Digest",
            path: "CRON_JOBS/Daily Research Digest.md",
          },
          {
            name: "identidade-1.jpg",
            basename: "identidade-1",
            path: "attachments/identidade-1.jpg",
          },
        ],
        getMarkdownFiles: () => [
          { name: "Meus Documentos.md", basename: "Meus Documentos", path: "Meus Documentos.md" },
        ],
        getAbstractFileByPath: (p: string) => {
          if (p === "Meus Documentos.md")
            return { name: "Meus Documentos.md", path: "Meus Documentos.md" };
          if (p === "attachments/identidade-1.jpg")
            return { name: "identidade-1.jpg", path: "attachments/identidade-1.jpg" };
          if (p === "attachments") return { name: "attachments", path: "attachments" };
          return null;
        },
        on: () => ({}),
        offref: () => {},
        read: async () => "",
        readBinary: async () => new ArrayBuffer(0),
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
        on: (event: string, cb: (...args: any[]) => void) => {
          const list = workspaceListeners.get(event) ?? [];
          list.push(cb);
          workspaceListeners.set(event, list);
          return {};
        },
        getLeavesOfType: (t: string) =>
          openLeaves.filter((l: any) => l.view?.getViewType?.() === t),
        iterateAllLeaves: (cb: (l: any) => void) => {
          for (const l of openLeaves) cb(l);
        },
        setActiveLeaf: (l: any) => {
          setActiveLeafCalls.push(l);
        },
        revealLeaf: async () => {},
        getRightLeaf: () => ({
          setViewState: async () => {},
        }),
        getLeaf: () => {
          const l: any = {
            view: { file: null },
            currentMode: "source",
            getViewState: () => ({
              type: "markdown",
              state: { mode: l.currentMode, file: l.view.file?.path },
            }),
            setViewState: async (vs: any) => {
              if (vs?.type) {
                const factory = (plugin as any).views.get(vs.type);
                if (factory) {
                  l.view = factory(l);
                  if (typeof l.view.onOpen === "function") await l.view.onOpen();
                }
              }
              if (vs?.state?.mode) l.currentMode = vs.state.mode;
            },
            openFile: async (file: any, opts?: any) => {
              l.view.file = file;
              if (opts?.state?.mode) l.currentMode = opts.state.mode;
              openedFiles.push(file);
            },
          };
          openLeaves.push(l);
          return l;
        },
        openLinkText: async (target: string) => {
          if (target.startsWith("/") || target.startsWith("\\")) {
            throw new Error("Folder already exists");
          }
          return true;
        },
        getActiveViewOfType: () => currentActiveMdView,
      },
      setting: {
        open: () => {},
        openTabById: () => {},
      },
    };

    const plugin = new HermesStudioPlugin(mockApp, {
      id: "hermes-studio",
      name: "Hermes Studio",
      version: "0.6.9",
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
    expect(sideView.contentEl.shadowRoot!.getElementById("app")).not.toBeNull();

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
    expect(openLeaves.length).toBe(1);
    expect(openLeaves[0].currentMode).toBe("preview");

    // Second click on the same document: reuses the existing tab and does not create a new one
    const openedAgain = await plugin.openVaultFile("Meus Documentos.md");
    expect(openedAgain).toBe(true);
    expect(openLeaves.length).toBe(1);
    expect(setActiveLeafCalls.length).toBe(2);
    expect(setActiveLeafCalls[1]).toBe(openLeaves[0]);
    expect(openLeaves[0].currentMode).toBe("preview");

    // Opening another document replaces the note in the active leaf (no new tab)
    const opened2 = await plugin.openVaultFile("identidade-1.jpg");
    expect(opened2).toBe(true);
    expect(openedFiles.some((f) => f.name === "identidade-1.jpg")).toBe(true);
    expect(openLeaves.length).toBe(1);
    expect(openLeaves[0].view.file.name).toBe("identidade-1.jpg");

    // 4. Verify opening external documents (e.g. skills in ~/.hermes/skills/.../SKILL.md)
    expect((plugin as any).views.has(HERMES_DOC_VIEW_TYPE)).toBe(true);

    const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-skill-test-"));
    const skillPath = path.join(externalDir, "SKILL.md");
    fs.writeFileSync(skillPath, "# Test Skill\nInstructions for test skill.", "utf8");

    const openedSkill = await plugin.openVaultFile(skillPath);
    expect(openedSkill).toBe(true);

    const docLeaf = openLeaves.find((l: any) => l.view?.getViewType?.() === HERMES_DOC_VIEW_TYPE);
    expect(docLeaf).toBeDefined();
    expect(docLeaf.view.contentEl.textContent).toContain("SKILL.md");
    expect(docLeaf.view.contentEl.textContent).toContain("Test Skill");

    // Non-existent external file does not trigger openLinkText or throw "Folder already exists"
    const openedNonExistent = await plugin.openVaultFile("/nonexistent/external/SKILL.md");
    expect(openedNonExistent).toBe(false);

    fs.rmSync(externalDir, { recursive: true, force: true });

    // 5. Verify plain-text vault note lists in assistant chat messages are linkified and open in Reading View mode
    const chatMarkdown = [
      "Aqui estão as notas modificadas hoje (16/04/2026), agrupadas por pasta:",
      "",
      "**Raiz**",
      "- 13:12 — Torresminho e Vida - Doutor Churras",
      "- 14:44 — To Study",
      "",
      "***AI***",
      "- 12:24 — Hermes to Headless Antigravity (agy)",
      "- 16:40 — AI",
      "- 18:10 — v1.3.2-v1.3.6",
      "",
      "***SAÚDE***",
      "- 13:30 — Receita Cardiológica - SOS Cardio (junho 2026)",
      "",
      "***CONTENT_CREATION***",
      "- 10:03 — Guiga/Guiga",
      "",
      "***CRON_JOBS***",
      "- 00:01 — Daily Research Digest",
    ].join("\n");

    const linkified = plugin.linkifyVaultReferences(chatMarkdown);
    expect(linkified).toContain(
      "[Torresminho e Vida - Doutor Churras](wikilink://Torresminho%20e%20Vida%20-%20Doutor%20Churras.md)",
    );
    expect(linkified).toContain("[To Study](wikilink://To%20Study.md)");
    expect(linkified).toContain(
      "[Hermes to Headless Antigravity (agy)](wikilink://AI%2FHermes%20to%20Headless%20Antigravity%20%28agy%29.md)",
    );
    expect(linkified).toContain("[AI](wikilink://AI%2FAI.md)");
    expect(linkified).toContain("[v1.3.2-v1.3.6](wikilink://AI%2Fv1.3.2-v1.3.6.md)");
    expect(linkified).toContain(
      "[Receita Cardiológica - SOS Cardio (junho 2026)](wikilink://SA%C3%9ADE%2FReceita%20Cardiol%C3%B3gica%20-%20SOS%20Cardio%20%28junho%202026%29.md)",
    );
    expect(linkified).toContain("[Guiga/Guiga](wikilink://CONTENT_CREATION%2FGuiga%2FGuiga.md)");
    expect(linkified).toContain(
      "[Daily Research Digest](wikilink://CRON_JOBS%2FDaily%20Research%20Digest.md)",
    );

    // Send assistant message with this list into the mounted chat webview and verify clickable <a data-href> links
    const webviewAdapter = sideView.toVscodeWebviewAdapter();
    await webviewAdapter.webview.postMessage({
      type: "init",
      model: {
        items: [
          { id: "1", kind: "user", turn: 1, text: "Quais notas foram modificadas hoje?" },
          { id: "2", kind: "assistant", turn: 1, text: chatMarkdown },
        ],
        meta: {
          connection: { state: "ready" },
          busy: false,
          turn: 1,
          queued: [],
          models: [],
          model: "anthropic/claude-sonnet-4",
          modes: [],
          skills: [],
          folder: "PluginTestVault",
        },
      },
    });
    await new Promise((r) => setTimeout(r, 40));

    // `sideView` comes from an untyped factory (`(plugin as any).views.get(...)`), so its
    // `shadowRoot` is `any`; type it as ShadowRoot so querySelectorAll accepts a type argument.
    const shadowRoot = sideView.contentEl.shadowRoot as ShadowRoot;
    const links = Array.from(shadowRoot.querySelectorAll<HTMLElement>("a[data-href]"));
    expect(links.length).toBe(8);

    // Click the link with parentheses ("Receita Cardiológica - SOS Cardio (junho 2026)") and the nested subpath link ("Guiga/Guiga")
    const receitaLink = links.find((el) => el.textContent?.includes("Receita Cardiológica"));
    const guigaLink = links.find((el) => el.textContent?.trim() === "Guiga/Guiga");
    expect(receitaLink).toBeDefined();
    expect(guigaLink).toBeDefined();

    (receitaLink as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 25));
    const receitaLeaf = openLeaves.find(
      (l: any) => l.view?.file?.path === "SAÚDE/Receita Cardiológica - SOS Cardio (junho 2026).md",
    );
    expect(receitaLeaf).toBeDefined();
    expect(receitaLeaf.currentMode).toBe("preview");
    expect(shadowRoot.querySelector(".ctx-chip")?.textContent).toContain("Receita Cardiológica");

    (guigaLink as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 25));
    const guigaLeaf = openLeaves.find(
      (l: any) => l.view?.file?.path === "CONTENT_CREATION/Guiga/Guiga.md",
    );
    expect(guigaLeaf).toBeDefined();
    expect(guigaLeaf.currentMode).toBe("preview");
    expect(shadowRoot.querySelector(".ctx-chip")?.textContent).toContain("Guiga.md");

    // 6. Verify active note chip updates when user selects another note via active-leaf-change (with live MarkdownView)
    currentActiveMdView = {
      file: { path: "To Study.md", name: "To Study.md" },
      editor: {
        getCursor: () => ({ line: 4, ch: 0 }),
        getSelection: () => "",
      },
      getViewType: () => "markdown",
    };
    for (const cb of workspaceListeners.get("active-leaf-change") ?? []) {
      cb({ view: currentActiveMdView });
    }
    await new Promise((r) => setTimeout(r, 25));
    expect(plugin.noteTracker.current?.relPath).toBe("To Study.md");
    expect(shadowRoot.querySelector(".ctx-chip")?.textContent).toContain("To Study.md");

    // 7. Verify active note chip updates when user selects another note in File Explorer (file-open event while focus is in sidebar)
    currentActiveMdView = null;
    for (const cb of workspaceListeners.get("file-open") ?? []) {
      cb({ path: "AI/AI.md", name: "AI.md" });
    }
    await new Promise((r) => setTimeout(r, 25));
    expect(plugin.noteTracker.current?.relPath).toBe("AI/AI.md");
    expect(shadowRoot.querySelector(".ctx-chip")?.textContent).toContain("AI.md");

    await sideView.onClose();
    sideView.containerEl.remove();
    diffView.containerEl.remove();
    await plugin.onunload();
    fs.rmSync(tmpVault, { recursive: true, force: true });
  });
});
