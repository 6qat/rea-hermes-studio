import { createHash } from "node:crypto";
import path from "node:path";
import { appendExternalSkillDirs } from "./hermes-external-skills";

export const OBSIDIAN_SKILLS_REPO = "obsidianmd/obsidian-skills";
export const OBSIDIAN_SKILLS_TREE_PREFIX = "plugins/obsidian/skills/";
export const AGENTS_SKILLS_DIR = ".agents/skills";
export const CLAUDE_SKILLS_DIR = ".claude/skills";
export const OBSIDIAN_SKILLS_MARKER_REL = `${AGENTS_SKILLS_DIR}/.hermes-studio-obsidian-skills.json`;
export const OBSIDIAN_SKILLS_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

const COMMIT_URL = `https://api.github.com/repos/${OBSIDIAN_SKILLS_REPO}/commits/main`;

export interface VaultSkillStore {
  exists(relPath: string): Promise<boolean>;
  read(relPath: string): Promise<string>;
  write(relPath: string, data: string): Promise<void>;
  mkdir(relPath: string): Promise<void>;
  list(relPath: string): Promise<{ files: string[]; folders: string[] }>;
}

export interface SkillHttp {
  getText(url: string): Promise<string>;
}

export interface SkillMarkerFile {
  dir: string;
  files: Record<string, string>;
}

export interface SkillMarker {
  source: typeof OBSIDIAN_SKILLS_REPO;
  commit: string;
  skills: Record<string, SkillMarkerFile>;
}

export interface SyncObsidianSkillsInput {
  vault: VaultSkillStore;
  http: SkillHttp;
  vaultBasePath: string;
  now: number;
  checkedAt?: number;
  manual?: boolean;
  enabled?: boolean;
  home?: string;
  readConfig: () => Promise<string>;
  writeConfig: (yaml: string) => Promise<void>;
}

export interface SyncObsidianSkillsResult {
  ok: boolean;
  skipped?: "disabled" | "throttled";
  installed: string[];
  updated: string[];
  keptEdits: string[];
  keptExisting: string[];
  filesChanged: boolean;
  configChanged: boolean;
  configOk: boolean;
  notice: string;
  checkedAt?: number;
  error?: string;
}

interface RemoteFile {
  rel: string;
  remotePath: string;
}

interface RemoteCatalog {
  commit: string;
  skills: Map<string, RemoteFile[]>;
}

export function hashSkillText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function createGithubSkillHttp(fetchImpl: typeof fetch = fetch): SkillHttp {
  return {
    async getText(url: string) {
      const response = await fetchImpl(url, {
        headers: {
          Accept: url.includes("api.github.com") ? "application/vnd.github+json" : "text/plain",
          "User-Agent": "hermes-studio",
        },
      });
      if (!response.ok) {
        throw new Error(`GitHub request failed (${response.status})`);
      }
      return response.text();
    },
  };
}

export async function syncObsidianSkills(
  input: SyncObsidianSkillsInput,
): Promise<SyncObsidianSkillsResult> {
  if (input.enabled === false) {
    return result({ skipped: "disabled" });
  }

  const due =
    input.manual === true ||
    input.checkedAt == null ||
    input.now - input.checkedAt >= OBSIDIAN_SKILLS_SYNC_INTERVAL_MS;

  if (!due) {
    const registered = await registerDirs(input, await localSkillDirs(input));
    return result({ skipped: "throttled", ...registered });
  }

  let catalog: RemoteCatalog;
  try {
    catalog = await fetchCatalog(input.http);
  } catch (error) {
    return result({
      ok: false,
      error: errorMessage(error),
      notice: "Could not sync Obsidian skills.",
    });
  }

  try {
    const applied = await applyCatalog(input, catalog);
    const registered = await registerDirs(input, applied.dirs);
    return result({
      ...applied,
      ...registered,
      checkedAt: input.now,
    });
  } catch (error) {
    return result({
      ok: false,
      error: errorMessage(error),
      notice: "Could not sync Obsidian skills.",
    });
  }
}

async function applyCatalog(
  input: SyncObsidianSkillsInput,
  catalog: RemoteCatalog,
): Promise<{
  installed: string[];
  updated: string[];
  keptEdits: string[];
  keptExisting: string[];
  filesChanged: boolean;
  dirs: string[];
}> {
  const marker = await readMarker(input.vault);
  const commitChanged = marker?.commit !== catalog.commit;
  const installed: string[] = [];
  const toUpdate: string[] = [];
  const keptExisting: string[] = [];
  let agentsPresent = false;
  let claudePresent = false;

  for (const name of [...catalog.skills.keys()].sort()) {
    const inAgents = await input.vault.exists(skillFile(AGENTS_SKILLS_DIR, name));
    const inClaude = await input.vault.exists(skillFile(CLAUDE_SKILLS_DIR, name));
    if (inAgents) agentsPresent = true;
    if (inClaude) claudePresent = true;
    const owned = marker?.skills[name] != null;
    if (!inAgents && !inClaude) {
      installed.push(name);
    } else if (owned && inAgents && commitChanged) {
      toUpdate.push(name);
    } else if (!owned && commitChanged) {
      keptExisting.push(name);
    }
  }

  const downloads = new Map<string, Map<string, string>>();
  for (const name of [...installed, ...toUpdate]) {
    const files = new Map<string, string>();
    for (const file of catalog.skills.get(name) ?? []) {
      files.set(file.rel, await input.http.getText(rawUrl(catalog.commit, file.remotePath)));
    }
    downloads.set(name, files);
  }

  const nextSkills: Record<string, SkillMarkerFile> = {};
  for (const [name, entry] of Object.entries(marker?.skills ?? {})) {
    nextSkills[name] = { dir: entry.dir, files: { ...entry.files } };
  }

  let filesChanged = false;
  for (const name of installed) {
    const files = downloads.get(name) ?? new Map<string, string>();
    const recorded: Record<string, string> = {};
    for (const [rel, text] of files) {
      await writeVaultFile(input.vault, skillPath(name, rel), text);
      recorded[rel] = hashSkillText(text);
      filesChanged = true;
    }
    nextSkills[name] = { dir: `${AGENTS_SKILLS_DIR}/${name}`, files: recorded };
  }

  const updated: string[] = [];
  const keptEdits: string[] = [];
  for (const name of toUpdate) {
    const files = downloads.get(name) ?? new Map<string, string>();
    const recorded = { ...(nextSkills[name]?.files ?? {}) };
    let wrote = false;
    let edited = false;
    for (const [rel, text] of files) {
      const target = skillPath(name, rel);
      const nextHash = hashSkillText(text);
      const exists = await input.vault.exists(target);
      if (!exists) {
        await writeVaultFile(input.vault, target, text);
        recorded[rel] = nextHash;
        wrote = true;
        filesChanged = true;
        continue;
      }
      const current = hashSkillText(await input.vault.read(target));
      const previous = recorded[rel];
      if (previous != null && current !== previous) {
        edited = true;
        continue;
      }
      if (previous == null) {
        if (current === nextHash) recorded[rel] = nextHash;
        continue;
      }
      if (current === nextHash) continue;
      await writeVaultFile(input.vault, target, text);
      recorded[rel] = nextHash;
      wrote = true;
      filesChanged = true;
    }
    nextSkills[name] = { dir: `${AGENTS_SKILLS_DIR}/${name}`, files: recorded };
    if (wrote) updated.push(name);
    if (edited) keptEdits.push(name);
  }

  const shouldWriteMarker =
    catalog.skills.size > 0 && (marker == null || marker.commit !== catalog.commit || filesChanged);
  if (shouldWriteMarker) {
    await writeVaultFile(
      input.vault,
      OBSIDIAN_SKILLS_MARKER_REL,
      serializeMarker({
        source: OBSIDIAN_SKILLS_REPO,
        commit: catalog.commit,
        skills: nextSkills,
      }),
    );
  }

  const dirs: string[] = [];
  if (agentsPresent || installed.length > 0) {
    dirs.push(absoluteSkillDir(input.vaultBasePath, AGENTS_SKILLS_DIR));
  }
  if (claudePresent) {
    dirs.push(absoluteSkillDir(input.vaultBasePath, CLAUDE_SKILLS_DIR));
  }
  return { installed, updated, keptEdits, keptExisting, filesChanged, dirs };
}

async function localSkillDirs(input: SyncObsidianSkillsInput): Promise<string[]> {
  const dirs: string[] = [];
  if (await directoryHasSkill(input.vault, AGENTS_SKILLS_DIR)) {
    dirs.push(absoluteSkillDir(input.vaultBasePath, AGENTS_SKILLS_DIR));
  }
  if (await directoryHasSkill(input.vault, CLAUDE_SKILLS_DIR)) {
    dirs.push(absoluteSkillDir(input.vaultBasePath, CLAUDE_SKILLS_DIR));
  }
  return dirs;
}

async function directoryHasSkill(vault: VaultSkillStore, dir: string): Promise<boolean> {
  let listed: { files: string[]; folders: string[] };
  try {
    listed = await vault.list(dir);
  } catch {
    return false;
  }
  for (const folder of listed.folders) {
    const normalized = folder.replace(/\\/g, "/").replace(/\/+$/, "");
    const name = normalized.slice(normalized.lastIndexOf("/") + 1);
    if (!safeName(name)) continue;
    if (await vault.exists(`${dir}/${name}/SKILL.md`)) return true;
  }
  return false;
}

async function registerDirs(
  input: SyncObsidianSkillsInput,
  dirs: string[],
): Promise<{ configChanged: boolean; configOk: boolean }> {
  if (dirs.length === 0) return { configChanged: false, configOk: true };
  let original = "";
  try {
    original = await input.readConfig();
  } catch {
    return { configChanged: false, configOk: false };
  }
  const edited = appendExternalSkillDirs(original, dirs, { home: input.home });
  if (!edited.ok) return { configChanged: false, configOk: false };
  if (!edited.changed) return { configChanged: false, configOk: true };
  try {
    await input.writeConfig(edited.yaml);
  } catch {
    return { configChanged: false, configOk: false };
  }
  return { configChanged: true, configOk: true };
}

async function fetchCatalog(http: SkillHttp): Promise<RemoteCatalog> {
  const commitBody = JSON.parse(await http.getText(COMMIT_URL)) as { sha?: unknown };
  const commit = commitBody.sha;
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error("GitHub commit response did not include a sha");
  }
  const treeUrl = `https://api.github.com/repos/${OBSIDIAN_SKILLS_REPO}/git/trees/${commit}?recursive=1`;
  const treeBody = JSON.parse(await http.getText(treeUrl)) as {
    truncated?: boolean;
    tree?: Array<{ path?: string; type?: string }>;
  };
  if (treeBody.truncated) throw new Error("GitHub skill tree was truncated");
  const skills = new Map<string, RemoteFile[]>();
  for (const entry of treeBody.tree ?? []) {
    if (entry.type !== "blob" || typeof entry.path !== "string") continue;
    if (!entry.path.startsWith(OBSIDIAN_SKILLS_TREE_PREFIX)) continue;
    const rest = entry.path.slice(OBSIDIAN_SKILLS_TREE_PREFIX.length);
    const slash = rest.indexOf("/");
    if (slash <= 0) continue;
    const name = rest.slice(0, slash);
    const rel = rest.slice(slash + 1);
    if (!safeName(name) || !safeRel(rel)) continue;
    const files = skills.get(name) ?? [];
    files.push({ rel, remotePath: entry.path });
    skills.set(name, files);
  }
  for (const [name, files] of skills) {
    if (!files.some((file) => file.rel === "SKILL.md")) skills.delete(name);
  }
  return { commit, skills };
}

async function readMarker(vault: VaultSkillStore): Promise<SkillMarker | null> {
  if (!(await vault.exists(OBSIDIAN_SKILLS_MARKER_REL))) return null;
  let text = "";
  try {
    text = await vault.read(OBSIDIAN_SKILLS_MARKER_REL);
  } catch {
    return null;
  }
  return parseMarker(text);
}

function parseMarker(text: string): SkillMarker | null {
  try {
    const json = JSON.parse(text) as { commit?: unknown; skills?: unknown };
    if (typeof json.commit !== "string" || !json.skills || typeof json.skills !== "object") {
      return null;
    }
    const skills: Record<string, SkillMarkerFile> = {};
    for (const [name, entry] of Object.entries(json.skills as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as { dir?: unknown; files?: unknown };
      if (typeof record.dir !== "string" || !record.files || typeof record.files !== "object") {
        continue;
      }
      const files: Record<string, string> = {};
      for (const [rel, hash] of Object.entries(record.files as Record<string, unknown>)) {
        if (typeof hash === "string") files[rel] = hash;
      }
      skills[name] = { dir: record.dir, files };
    }
    return { source: OBSIDIAN_SKILLS_REPO, commit: json.commit, skills };
  } catch {
    return null;
  }
}

function serializeMarker(marker: SkillMarker): string {
  const skills: SkillMarker["skills"] = {};
  for (const name of Object.keys(marker.skills).sort()) {
    const files: Record<string, string> = {};
    for (const rel of Object.keys(marker.skills[name].files).sort()) {
      files[rel] = marker.skills[name].files[rel];
    }
    skills[name] = { dir: marker.skills[name].dir, files };
  }
  return `${JSON.stringify({ source: marker.source, commit: marker.commit, skills }, null, 2)}\n`;
}

async function writeVaultFile(vault: VaultSkillStore, rel: string, text: string): Promise<void> {
  const parent = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
  if (parent) await ensureDir(vault, parent);
  await vault.write(rel, text);
}

async function ensureDir(vault: VaultSkillStore, rel: string): Promise<void> {
  const parts = rel.split("/").filter((part) => part.length > 0);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (await vault.exists(current)) continue;
    await vault.mkdir(current);
  }
}

function skillFile(root: string, name: string): string {
  return `${root}/${name}/SKILL.md`;
}

function skillPath(name: string, rel: string): string {
  return `${AGENTS_SKILLS_DIR}/${name}/${rel}`;
}

function absoluteSkillDir(vaultBasePath: string, rel: string): string {
  return path.resolve(vaultBasePath, ...rel.split("/"));
}

function rawUrl(commit: string, remotePath: string): string {
  const encoded = remotePath.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/obsidianmd/obsidian-skills/${commit}/${encoded}`;
}

function safeName(name: string): boolean {
  return name.length > 0 && name !== "." && name !== ".." && !/[/\\]/.test(name);
}

function safeRel(rel: string): boolean {
  if (!rel || rel.startsWith("/") || rel.includes("\\")) return false;
  return rel.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function result(
  partial: Partial<SyncObsidianSkillsResult> & { notice?: string },
): SyncObsidianSkillsResult {
  const installed = partial.installed ?? [];
  const updated = partial.updated ?? [];
  const keptEdits = partial.keptEdits ?? [];
  const keptExisting = partial.keptExisting ?? [];
  const configOk = partial.configOk ?? true;
  const configChanged = partial.configChanged ?? false;
  const notice =
    partial.notice ??
    buildNotice({ installed, updated, keptEdits, keptExisting, configOk, configChanged });
  return {
    ok: partial.ok ?? true,
    skipped: partial.skipped,
    installed,
    updated,
    keptEdits,
    keptExisting,
    filesChanged: partial.filesChanged ?? false,
    configChanged,
    configOk,
    notice,
    checkedAt: partial.checkedAt,
    error: partial.error,
  };
}

function buildNotice(parts: {
  installed: string[];
  updated: string[];
  keptEdits: string[];
  keptExisting: string[];
  configOk: boolean;
  configChanged: boolean;
}): string {
  const sentences: string[] = [];
  if (parts.installed.length > 0) {
    sentences.push(`Installed Obsidian skills: ${parts.installed.join(", ")}.`);
  }
  if (parts.updated.length > 0) {
    sentences.push(`Updated Obsidian skills: ${parts.updated.join(", ")}.`);
  }
  if (parts.keptEdits.length > 0) {
    sentences.push(`Left local Obsidian skill edits in place: ${parts.keptEdits.join(", ")}.`);
  }
  if (parts.keptExisting.length > 0) {
    sentences.push(`Left existing Obsidian skills in place: ${parts.keptExisting.join(", ")}.`);
  }
  if (!parts.configOk) {
    sentences.push("Could not register Obsidian skill folders in Hermes config.");
  } else if (
    parts.configChanged &&
    parts.installed.length === 0 &&
    parts.updated.length === 0 &&
    parts.keptEdits.length === 0 &&
    parts.keptExisting.length === 0
  ) {
    sentences.push("Registered Obsidian skill folders with Hermes.");
  }
  return sentences.join(" ");
}
