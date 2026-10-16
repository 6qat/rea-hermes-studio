import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractWikiLinks, VaultNoteTracker } from "../src/host/note-tracker";
import { createObsidianVscodeShim } from "../src/host/obsidian-shim";

describe("extractWikiLinks & VaultNoteTracker", () => {
  it("extracts [[WikiLinks]] with optional aliases and headings from prompt text", () => {
    const links = extractWikiLinks(
      "Please summarize [[Architecture Overview#ACP Protocol|the architecture]] and compare with [[Daily/2026-10-16]].",
    );
    expect(links).toEqual(["Architecture Overview", "Daily/2026-10-16"]);
  });

  it("preserves the last active Markdown note and selection when focus moves to Hermes Studio view", () => {
    const tracker = new VaultNoteTracker({
      vaultBasePath: "/vault",
      resolveWikiLink: (link) => (link === "Roadmap" ? "docs/Roadmap.md" : undefined),
    });

    tracker.updateFromEditor({
      relPath: "notes/Meeting.md",
      cursorLine: 11,
      selection: {
        startLine: 10,
        endLine: 14,
        text: "Action items:\n- Ship Obsidian plugin",
      },
    });

    // Simulate switching focus to Hermes Studio sidebar leaf
    tracker.onActiveLeafChanged("hermes-studio-side-view");
    expect(tracker.current?.relPath).toBe("notes/Meeting.md");
    expect(tracker.current?.selection?.startLine).toBe(10);

    // Resolve WikiLinks in user prompt
    const resolved = tracker.resolvePromptWikiLinks("Check [[Roadmap]] please");
    expect(resolved).toEqual(["docs/Roadmap.md"]);
  });
});

describe("createObsidianVscodeShim", () => {
  it("resolves file://, obsidian://open, and wikilink:// URIs into vault filesystem paths", async () => {
    const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-vault-"));
    fs.mkdirSync(path.join(tmpVault, "Notes"), { recursive: true });
    const notePath = path.join(tmpVault, "Notes", "Idea.md");
    fs.writeFileSync(notePath, "# My Idea\nHello Hermes!", "utf8");

    const shim = createObsidianVscodeShim({
      vaultBasePath: tmpVault,
      vaultName: "TestVault",
      getSettings: () => ({
        path: "",
        environment: {},
        autoStart: true,
        notifications: "all",
      }),
      resolveWikiLink: (link) => (link === "Idea" ? "Notes/Idea.md" : undefined),
    });

    // 1. obsidian://open?vault=TestVault&file=Notes%2FIdea.md
    const obsUri = shim.Uri.parse("obsidian://open?vault=TestVault&file=Notes%2FIdea.md");
    expect(obsUri.scheme).toBe("file");
    expect(obsUri.fsPath).toBe(notePath);
    expect(shim.workspace.asRelativePath(obsUri, false)).toBe("Notes/Idea.md");

    // 2. wikilink://Idea
    const wikiUri = shim.Uri.parse("wikilink://Idea");
    expect(wikiUri.scheme).toBe("file");
    expect(wikiUri.fsPath).toBe(notePath);

    // 3. workspace.fs.stat & readFile
    const stat = await shim.workspace.fs.stat(obsUri);
    expect((stat.type & shim.FileType.File) !== 0).toBe(true);
    const bytes = await shim.workspace.fs.readFile(obsUri);
    expect(Buffer.from(bytes).toString("utf8")).toContain("Hello Hermes!");

    // 4. EventEmitter
    const emitter = new shim.EventEmitter<number>();
    const received: number[] = [];
    const sub = emitter.event((v) => received.push(v));
    emitter.fire(42);
    sub.dispose();
    emitter.fire(99);
    expect(received).toEqual([42]);

    fs.rmSync(tmpVault, { recursive: true, force: true });
  });

  it("uses Obsidian Vault and DataAdapter APIs for in-vault file operations without node fs", async () => {
    let adapterStatCalled = false;
    let adapterReadBinaryCalled = false;
    let adapterListCalled = false;
    const vaultEvents: string[] = [];

    const mockVault: any = {
      getFiles: () => [{ path: "Notes/Idea.md" }],
      getAbstractFileByPath: (p: string) =>
        p === "Notes/Idea.md" ? { path: "Notes/Idea.md" } : null,
      read: async () => "# From Vault API",
      readBinary: async () => {
        adapterReadBinaryCalled = true;
        return new TextEncoder().encode("# From Vault Binary").buffer;
      },
      on: (ev: string, _cb: any) => {
        vaultEvents.push(ev);
        return { ev };
      },
      offref: () => {},
    };

    const mockAdapter: any = {
      exists: async () => true,
      stat: async (_p: string) => {
        adapterStatCalled = true;
        return { ctime: 1234, mtime: 5678, size: 42, type: "file" };
      },
      read: async () => "# From Adapter",
      readBinary: async () => {
        adapterReadBinaryCalled = true;
        return new TextEncoder().encode("# From Adapter Binary").buffer;
      },
      list: async (_p: string) => {
        adapterListCalled = true;
        return { files: ["Notes/Idea.md"], folders: ["Notes"] };
      },
    };

    const shim = createObsidianVscodeShim({
      vaultBasePath: "/mock/vault",
      vaultName: "MockVault",
      vault: mockVault,
      adapter: mockAdapter,
      hasGit: () => true,
      getSettings: () => ({
        path: "",
        environment: {},
        autoStart: false,
        notifications: "all",
      }),
    });

    const noteUri = shim.Uri.file("/mock/vault/Notes/Idea.md");

    // 1. stat uses adapter.stat
    const stat = await shim.workspace.fs.stat(noteUri);
    expect(adapterStatCalled).toBe(true);
    expect((stat.type & shim.FileType.File) !== 0).toBe(true);
    expect(stat.size).toBe(42);

    // 2. readFile uses vault.readBinary
    const bytes = await shim.workspace.fs.readFile(noteUri);
    expect(adapterReadBinaryCalled).toBe(true);
    expect(new TextDecoder().decode(bytes)).toContain("# From Vault Binary");

    // 3. readDirectory uses adapter.list
    const dirList = await shim.workspace.fs.readDirectory(shim.Uri.file("/mock/vault/Notes"));
    expect(adapterListCalled).toBe(true);
    expect(dirList.length).toBeGreaterThan(0);

    // 4. openTextDocument uses vault.read
    const doc = await shim.workspace.openTextDocument(noteUri);
    expect(doc.getText()).toBe("# From Vault API");

    // 5. createFileSystemWatcher binds to vault.on
    const watcher = shim.workspace.createFileSystemWatcher("/mock/vault");
    expect(vaultEvents).toContain("create");
    expect(vaultEvents).toContain("modify");
    expect(vaultEvents).toContain("delete");
    expect(vaultEvents).toContain("rename");
    watcher.dispose();

    // 6. findFiles uses vault.getFiles()
    const files = await shim.workspace.findFiles("**/*.md");
    expect(files.length).toBe(1);
    expect(files[0].fsPath).toBe("/mock/vault/Notes/Idea.md");

    // 7. git extension uses deps.hasGit()
    const gitExt = shim.extensions.getExtension("vscode.git");
    expect(gitExt).toBeDefined();
    expect(gitExt?.isActive).toBe(true);
  });
});
