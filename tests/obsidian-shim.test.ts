import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createObsidianVscodeShim } from "../src/host/obsidian-shim";
import { VaultNoteTracker, extractWikiLinks } from "../src/host/note-tracker";

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
      resolveWikiLink: (link) =>
        link === "Roadmap" ? "docs/Roadmap.md" : undefined,
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
      resolveWikiLink: (link) =>
        link === "Idea" ? "Notes/Idea.md" : undefined,
    });

    // 1. obsidian://open?vault=TestVault&file=Notes%2FIdea.md
    const obsUri = shim.Uri.parse(
      "obsidian://open?vault=TestVault&file=Notes%2FIdea.md",
    );
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
});
