import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hashSkillText,
  OBSIDIAN_SKILLS_MARKER_REL,
  type SkillHttp,
  type SyncObsidianSkillsResult,
  syncObsidianSkills,
  type VaultSkillStore,
} from "../src/host/obsidian-skills-sync";

const COMMIT_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const COMMIT_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PREFIX = "plugins/obsidian/skills";
const MARKDOWN_V1 = "---\nname: obsidian-markdown\n---\n# Markdown\n";
const MARKDOWN_V2 = "---\nname: obsidian-markdown\n---\n# Markdown v2\n";
const NOTES_V1 = "see the docs\n";
const NOTES_V2 = "see the docs v2\n";
const BASES_V1 = "---\nname: obsidian-bases\n---\n# Bases\n";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("syncObsidianSkills", () => {
  it("installs missing skills under .agents/skills and records hashes", async () => {
    const ctx = createContext({
      [file("obsidian-markdown", "SKILL.md")]: MARKDOWN_V1,
      [file("obsidian-markdown", "notes.md")]: NOTES_V1,
      [file("obsidian-markdown", "references/extra.md")]: "extra\n",
      [file("obsidian-bases", "SKILL.md")]: BASES_V1,
    });

    const result = await sync(ctx, COMMIT_A);

    expect(result.ok).toBe(true);
    expect(result.installed).toEqual(["obsidian-bases", "obsidian-markdown"]);
    expect(read(ctx, ".agents/skills/obsidian-markdown/SKILL.md")).toBe(MARKDOWN_V1);
    expect(read(ctx, ".agents/skills/obsidian-markdown/notes.md")).toBe(NOTES_V1);
    expect(read(ctx, ".agents/skills/obsidian-markdown/references/extra.md")).toBe("extra\n");
    expect(read(ctx, ".agents/skills/obsidian-bases/SKILL.md")).toBe(BASES_V1);
    const marker = JSON.parse(read(ctx, OBSIDIAN_SKILLS_MARKER_REL));
    expect(marker.commit).toBe(COMMIT_A);
    expect(marker.skills["obsidian-markdown"].files["SKILL.md"]).toBe(sha(MARKDOWN_V1));
    expect(marker.skills["obsidian-markdown"].files["notes.md"]).toBe(hashSkillText(NOTES_V1));
    expect(ctx.config()).toContain(`model:\n  default: x`);
    expect(ctx.config()).toContain(path.resolve(ctx.vault, ".agents/skills"));
    expect(ctx.config()).not.toContain(path.resolve(ctx.vault, ".claude/skills"));
    expect(result.notice).toContain(
      "Installed Obsidian skills: obsidian-bases, obsidian-markdown.",
    );
  });

  it("leaves a .claude/skills copy in place and registers that folder", async () => {
    const ctx = createContext({
      [file("obsidian-markdown", "SKILL.md")]: MARKDOWN_V1,
      [file("obsidian-bases", "SKILL.md")]: BASES_V1,
    });
    write(ctx, ".claude/skills/obsidian-markdown/SKILL.md", "USER COPY\n");

    const result = await sync(ctx, COMMIT_A);

    expect(read(ctx, ".claude/skills/obsidian-markdown/SKILL.md")).toBe("USER COPY\n");
    expect(ctx.exists(".agents/skills/obsidian-markdown/SKILL.md")).toBe(false);
    expect(read(ctx, ".agents/skills/obsidian-bases/SKILL.md")).toBe(BASES_V1);
    expect(ctx.config()).toContain(path.resolve(ctx.vault, ".agents/skills"));
    expect(ctx.config()).toContain(path.resolve(ctx.vault, ".claude/skills"));
    expect(result.notice).toContain("Left existing Obsidian skills in place: obsidian-markdown.");
    expect(result.installed).toEqual(["obsidian-bases"]);
  });

  it("does not write files when the remote commit is unchanged", async () => {
    const ctx = createContext({
      [file("obsidian-markdown", "SKILL.md")]: MARKDOWN_V1,
    });
    await sync(ctx, COMMIT_A);
    ctx.writes.length = 0;
    const config = ctx.config();

    const result = await sync(ctx, COMMIT_A, { checkedAt: 0 });

    expect(result.filesChanged).toBe(false);
    expect(ctx.writes).toEqual([]);
    expect(ctx.config()).toBe(config);
    expect(result.notice).toBe("");
  });

  it("replaces an untouched managed file when the remote commit changes", async () => {
    const ctx = createContext({
      [file("obsidian-markdown", "SKILL.md")]: MARKDOWN_V1,
      [file("obsidian-markdown", "notes.md")]: NOTES_V1,
    });
    await sync(ctx, COMMIT_A);
    ctx.files[file("obsidian-markdown", "SKILL.md")] = MARKDOWN_V2;
    ctx.files[file("obsidian-markdown", "notes.md")] = NOTES_V2;

    const result = await sync(ctx, COMMIT_B, { checkedAt: 0 });

    expect(read(ctx, ".agents/skills/obsidian-markdown/SKILL.md")).toBe(MARKDOWN_V2);
    expect(read(ctx, ".agents/skills/obsidian-markdown/notes.md")).toBe(NOTES_V2);
    expect(result.updated).toEqual(["obsidian-markdown"]);
    const marker = JSON.parse(read(ctx, OBSIDIAN_SKILLS_MARKER_REL));
    expect(marker.commit).toBe(COMMIT_B);
    expect(marker.skills["obsidian-markdown"].files["SKILL.md"]).toBe(sha(MARKDOWN_V2));
  });

  it("keeps a locally edited managed file and still updates the untouched sibling", async () => {
    const ctx = createContext({
      [file("obsidian-markdown", "SKILL.md")]: MARKDOWN_V1,
      [file("obsidian-markdown", "notes.md")]: NOTES_V1,
    });
    await sync(ctx, COMMIT_A);
    write(ctx, ".agents/skills/obsidian-markdown/SKILL.md", "EDITED\n");
    ctx.files[file("obsidian-markdown", "SKILL.md")] = MARKDOWN_V2;
    ctx.files[file("obsidian-markdown", "notes.md")] = NOTES_V2;

    const result = await sync(ctx, COMMIT_B, { checkedAt: 0 });

    expect(read(ctx, ".agents/skills/obsidian-markdown/SKILL.md")).toBe("EDITED\n");
    expect(read(ctx, ".agents/skills/obsidian-markdown/notes.md")).toBe(NOTES_V2);
    expect(result.keptEdits).toEqual(["obsidian-markdown"]);
    expect(result.updated).toEqual(["obsidian-markdown"]);
    expect(result.notice).toContain("Left local Obsidian skill edits in place: obsidian-markdown.");
    const marker = JSON.parse(read(ctx, OBSIDIAN_SKILLS_MARKER_REL));
    expect(marker.skills["obsidian-markdown"].files["SKILL.md"]).toBe(sha(MARKDOWN_V1));
    expect(marker.skills["obsidian-markdown"].files["notes.md"]).toBe(sha(NOTES_V2));
  });

  it("leaves the vault and config unchanged when GitHub cannot be reached", async () => {
    const ctx = createContext({});
    write(ctx, "keep.md", "stay\n");
    const http: SkillHttp = {
      async getText() {
        throw new Error("offline");
      },
    };

    const result = await syncObsidianSkills({
      ...input(ctx, http),
      checkedAt: undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.notice).toBe("Could not sync Obsidian skills.");
    expect(ctx.exists(".agents")).toBe(false);
    expect(ctx.config()).toBe("model:\n  default: x\n");
    expect(read(ctx, "keep.md")).toBe("stay\n");
  });
});

function file(skill: string, rel: string): string {
  return `${PREFIX}/${skill}/${rel}`;
}

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

interface Context {
  vault: string;
  configPath: string;
  files: Record<string, string>;
  writes: string[];
  httpCalls: string[];
  config: () => string;
  exists: (rel: string) => boolean;
}

function createContext(files: Record<string, string>): Context {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-skills-sync-"));
  roots.push(root);
  const vault = path.join(root, "vault");
  const configPath = path.join(root, "hermes", "config.yaml");
  fs.mkdirSync(vault, { recursive: true });
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, "model:\n  default: x\n");
  return {
    vault,
    configPath,
    files: { ...files },
    writes: [],
    httpCalls: [],
    config: () => fs.readFileSync(configPath, "utf8"),
    exists: (rel: string) => fs.existsSync(path.join(vault, rel)),
  };
}

function write(ctx: Context, rel: string, text: string): void {
  const abs = path.join(ctx.vault, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function read(ctx: Context, rel: string): string {
  return fs.readFileSync(path.join(ctx.vault, rel), "utf8");
}

function store(ctx: Context): VaultSkillStore {
  const abs = (rel: string) => path.join(ctx.vault, ...rel.split("/"));
  return {
    async exists(rel) {
      return fs.existsSync(abs(rel));
    },
    async read(rel) {
      return fs.readFileSync(abs(rel), "utf8");
    },
    async write(rel, data) {
      ctx.writes.push(rel);
      const file = abs(rel);
      if (!fs.existsSync(path.dirname(file))) throw new Error(`missing parent for ${rel}`);
      fs.writeFileSync(file, data);
    },
    async mkdir(rel) {
      const dir = abs(rel);
      if (fs.existsSync(dir)) throw new Error(`already exists ${rel}`);
      if (!fs.existsSync(path.dirname(dir))) throw new Error(`missing parent for ${rel}`);
      fs.mkdirSync(dir);
    },
    async list(rel) {
      const dir = abs(rel);
      if (!fs.existsSync(dir)) throw new Error(`missing ${rel}`);
      const files: string[] = [];
      const folders: string[] = [];
      for (const name of fs.readdirSync(dir)) {
        const child = `${rel.replace(/\/$/, "")}/${name}`;
        if (fs.statSync(abs(child)).isDirectory()) folders.push(child);
        else files.push(child);
      }
      return { files, folders };
    },
  };
}

function github(ctx: Context, commit: string): SkillHttp {
  return {
    async getText(url: string) {
      ctx.httpCalls.push(url);
      if (url.endsWith("/commits/main")) return JSON.stringify({ sha: commit });
      if (url.includes("/git/trees/")) {
        return JSON.stringify({
          tree: Object.keys(ctx.files).map((remotePath) => ({ path: remotePath, type: "blob" })),
        });
      }
      const marker = `/${commit}/`;
      const index = url.indexOf(marker);
      if (index === -1) throw new Error(`unexpected ${url}`);
      const remotePath = decodeURIComponent(url.slice(index + marker.length));
      const body = ctx.files[remotePath];
      if (body == null) throw new Error(`missing ${remotePath}`);
      return body;
    },
  };
}

function input(ctx: Context, http: SkillHttp) {
  return {
    vault: store(ctx),
    http,
    vaultBasePath: ctx.vault,
    now: 1_700_000_000_000,
    manual: true,
    enabled: true,
    readConfig: async () => fs.readFileSync(ctx.configPath, "utf8"),
    writeConfig: async (yaml: string) => {
      fs.writeFileSync(ctx.configPath, yaml);
    },
  };
}

function sync(
  ctx: Context,
  commit: string,
  extra: { checkedAt?: number } = {},
): Promise<SyncObsidianSkillsResult> {
  return syncObsidianSkills({
    ...input(ctx, github(ctx, commit)),
    checkedAt: extra.checkedAt,
  });
}
