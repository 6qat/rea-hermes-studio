export interface ExternalSkillsEdit {
  yaml: string;
  changed: boolean;
  ok: boolean;
  reason?: string;
}

export interface AppendExternalSkillDirsOptions {
  home?: string;
}

/**
 * Appends absolute skill directories to `skills.external_dirs` without rewriting
 * the rest of the file. Returns the original text when the edit is not safe.
 */
export function appendExternalSkillDirs(
  yamlText: string,
  dirs: string[],
  options?: AppendExternalSkillDirsOptions,
): ExternalSkillsEdit {
  const incoming = uniqueDirs(dirs);
  if (incoming.length === 0) {
    return { yaml: yamlText, changed: false, ok: true };
  }

  const newline = yamlText.includes("\r\n") ? "\r\n" : "\n";
  const lines = splitLines(yamlText);
  const skillsIndex = findTopLevelSkills(lines);
  if (skillsIndex === "unsafe") {
    return untouched(yamlText, "skills block is not a plain top-level mapping");
  }
  if (skillsIndex === "missing") {
    return {
      yaml: joinLines([...lines, ...skillsBlock(incoming)], newline),
      changed: true,
      ok: true,
    };
  }

  const sectionEnd = findSectionEnd(lines, skillsIndex);
  const edited = editSkillsSection(lines, skillsIndex, sectionEnd, incoming, options?.home);
  if (!edited.ok) return untouched(yamlText, edited.reason);
  if (!edited.changed) return { yaml: yamlText, changed: false, ok: true };
  return { yaml: joinLines(edited.lines, newline), changed: true, ok: true };
}

function untouched(yaml: string, reason: string): ExternalSkillsEdit {
  return { yaml, changed: false, ok: false, reason };
}

function skillsBlock(dirs: string[]): string[] {
  return ["skills:", "  external_dirs:", ...dirs.map((dir) => `    - ${yamlScalar(dir)}`)];
}

function editSkillsSection(
  lines: string[],
  skillsIndex: number,
  sectionEnd: number,
  dirs: string[],
  home: string | undefined,
): { ok: true; changed: boolean; lines: string[] } | { ok: false; reason: string } {
  for (let i = skillsIndex + 1; i < sectionEnd; i++) {
    if (lines[i].includes("\t")) {
      return { ok: false, reason: "skills block uses tabs" };
    }
  }

  const hits: number[] = [];
  const childIndent = childKeyIndent(lines, skillsIndex, sectionEnd);
  for (let i = skillsIndex + 1; i < sectionEnd; i++) {
    const match = /^([ ]*)external_dirs\s*:(.*)$/.exec(lines[i]);
    if (!match) continue;
    if (match[1].length === childIndent) hits.push(i);
  }
  if (hits.length > 1) {
    return { ok: false, reason: "skills.external_dirs is duplicated" };
  }

  if (hits.length === 0) {
    const next = lines.slice();
    const block = externalDirsBlock(childIndent, dirs);
    next.splice(skillsIndex + 1, 0, ...block);
    return { ok: true, changed: true, lines: next };
  }

  const keyIndex = hits[0];
  const keyLine = lines[keyIndex];
  const keyMatch = /^([ ]*external_dirs\s*:)(.*)$/.exec(keyLine);
  if (!keyMatch) return { ok: false, reason: "skills.external_dirs could not be parsed" };
  const parsed = valueAndComment(keyMatch[2]);
  if (!parsed) return { ok: false, reason: "skills.external_dirs value is not a single line" };

  const value = parsed.value;
  if (/^[{&*!|>]/.test(value)) {
    return { ok: false, reason: "skills.external_dirs is not a list" };
  }

  if (value.startsWith("[")) {
    const items = parseFlowList(value);
    if (!items) return { ok: false, reason: "skills.external_dirs flow list could not be parsed" };
    const additions = missingDirs(items, dirs, home);
    if (additions.length === 0) return { ok: true, changed: false, lines };
    const rendered = [
      ...items.map((item) => item.raw),
      ...additions.map((dir) => JSON.stringify(dir)),
    ];
    const comment = parsed.comment ? ` ${parsed.comment}` : "";
    const next = lines.slice();
    next[keyIndex] = `${keyMatch[1]} [${rendered.join(", ")}]${comment}`;
    return { ok: true, changed: true, lines: next };
  }

  if (value !== "" && value !== "~" && value !== "null" && value !== "Null" && value !== "NULL") {
    const scalar = unquote(value);
    if (scalar == null)
      return { ok: false, reason: "skills.external_dirs scalar could not be parsed" };
    const additions = missingDirs([{ raw: value, text: scalar }], dirs, home);
    if (additions.length === 0) return { ok: true, changed: false, lines };
    const indent = leadingSpaces(keyLine) ?? 0;
    const itemIndent = indent + 2;
    const comment = parsed.comment ? ` ${parsed.comment}` : "";
    const block = [
      `${" ".repeat(indent)}external_dirs:${comment}`,
      `${" ".repeat(itemIndent)}- ${yamlScalar(scalar)}`,
      ...additions.map((dir) => `${" ".repeat(itemIndent)}- ${yamlScalar(dir)}`),
    ];
    const next = lines.slice();
    next.splice(keyIndex, 1, ...block);
    return { ok: true, changed: true, lines: next };
  }

  const scanned = scanBlockList(lines, keyIndex, sectionEnd);
  if (!scanned.ok) return scanned;
  const existing = scanned.items;
  const additions = missingDirs(existing, dirs, home);
  if (additions.length === 0) return { ok: true, changed: false, lines };
  const itemIndent = scanned.itemIndent ?? (leadingSpaces(keyLine) ?? 0) + 2;
  const inserted = additions.map((dir) => `${" ".repeat(itemIndent)}- ${yamlScalar(dir)}`);
  const next = lines.slice();
  next.splice(scanned.insertAt, 0, ...inserted);
  return { ok: true, changed: true, lines: next };
}

interface ListedPath {
  raw: string;
  text: string;
}

function scanBlockList(
  lines: string[],
  keyIndex: number,
  sectionEnd: number,
):
  | { ok: true; items: ListedPath[]; itemIndent: number | null; insertAt: number }
  | { ok: false; reason: string } {
  const keyIndent = leadingSpaces(lines[keyIndex]) ?? 0;
  const items: ListedPath[] = [];
  let itemIndent: number | null = null;
  let lastItem = keyIndex;
  for (let i = keyIndex + 1; i < sectionEnd; i++) {
    const line = lines[i];
    const trim = line.trim();
    if (trim === "" || trim.startsWith("#")) continue;
    const indent = leadingSpaces(line);
    if (indent == null) return { ok: false, reason: "skills.external_dirs uses tabs" };
    if (indent <= keyIndent) break;
    if (trim.startsWith("- ")) {
      if (itemIndent == null) itemIndent = indent;
      if (indent > itemIndent) continue;
      if (indent !== itemIndent) {
        return { ok: false, reason: "skills.external_dirs list indent is inconsistent" };
      }
      const raw = trim.slice(2).trim();
      const text = unquote(raw);
      if (text == null)
        return { ok: false, reason: "skills.external_dirs item could not be parsed" };
      items.push({ raw, text });
      lastItem = i;
      continue;
    }
    if (itemIndent != null && indent > itemIndent) continue;
    return { ok: false, reason: "skills.external_dirs is not a list" };
  }
  return { ok: true, items, itemIndent, insertAt: lastItem + 1 };
}

function childKeyIndent(lines: string[], skillsIndex: number, sectionEnd: number): number {
  let indent: number | null = null;
  for (let i = skillsIndex + 1; i < sectionEnd; i++) {
    const line = lines[i];
    const trim = line.trim();
    if (trim === "" || trim.startsWith("#")) continue;
    const width = leadingSpaces(line);
    if (width == null || width === 0) continue;
    if (indent == null || width < indent) indent = width;
  }
  return indent ?? 2;
}

function externalDirsBlock(indent: number, dirs: string[]): string[] {
  const keyPad = " ".repeat(indent);
  const itemPad = " ".repeat(indent + 2);
  return [`${keyPad}external_dirs:`, ...dirs.map((dir) => `${itemPad}- ${yamlScalar(dir)}`)];
}

function missingDirs(existing: ListedPath[], dirs: string[], home: string | undefined): string[] {
  return dirs.filter((dir) => !existing.some((entry) => samePath(entry.text, dir, home)));
}

function findTopLevelSkills(lines: string[]): number | "missing" | "unsafe" {
  let found: number | "missing" = "missing";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trim = line.trim();
    if (trim === "" || trim.startsWith("#")) continue;
    const match = /^([ ]*)([A-Za-z_][\w-]*)\s*:(.*)$/.exec(line);
    if (match == null) continue;
    if (match[2] !== "skills") continue;
    if (match[1].length !== 0) return "unsafe";
    const parsed = valueAndComment(match[3]);
    if (parsed == null) return "unsafe";
    if (parsed.value !== "") return "unsafe";
    if (found !== "missing") return "unsafe";
    found = i;
  }
  return found;
}

function findSectionEnd(lines: string[], skillsIndex: number): number {
  for (let i = skillsIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (!line.startsWith(" ") && !line.startsWith("\t")) return i;
  }
  return lines.length;
}

function valueAndComment(rest: string): { value: string; comment: string } | null {
  let i = 0;
  while (i < rest.length && (rest[i] === " " || rest[i] === "\t")) i++;
  const after = rest.slice(i);
  if (after === "") return { value: "", comment: "" };
  if (after.startsWith("#")) return { value: "", comment: after };

  if (after[0] === '"' || after[0] === "'") {
    const quote = after[0];
    let j = 1;
    while (j < after.length) {
      if (after[j] === "\\" && quote === '"') {
        j += 2;
        continue;
      }
      if (after[j] === quote) {
        j++;
        break;
      }
      j++;
    }
    if (j > after.length || after[j - 1] !== quote) return null;
    const value = after.slice(0, j).trim();
    const tail = after.slice(j).trim();
    if (tail === "") return { value, comment: "" };
    if (tail.startsWith("#")) return { value, comment: tail };
    return null;
  }

  const hash = after.search(/(^|\s)#/);
  if (hash === -1) return { value: after.trim(), comment: "" };
  const commentAt = after[hash] === "#" ? hash : hash + 1;
  return { value: after.slice(0, commentAt).trim(), comment: after.slice(commentAt).trim() };
}

function parseFlowList(value: string): ListedPath[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (inner === "") return [];
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (quote) {
      current += char;
      if (char === "\\" && quote === '"') {
        current += inner[i + 1] ?? "";
        i++;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "[" || char === "]" || char === "{" || char === "}") return null;
    if (char === ",") {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (quote) return null;
  parts.push(current.trim());
  const items: ListedPath[] = [];
  for (const raw of parts) {
    if (raw === "") return null;
    const text = unquote(raw);
    if (text == null) return null;
    items.push({ raw, text });
  }
  return items;
}

function unquote(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return null;
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try {
      const parsed = JSON.parse(text);
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return null;
    }
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (/[#:{}[\],&*!|>%@`]/.test(text)) return null;
  return text;
}

function yamlScalar(value: string): string {
  if (/^[A-Za-z0-9_./~-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function samePath(entry: string, dir: string, home: string | undefined): boolean {
  const left = normalizePath(entry);
  const right = normalizePath(dir);
  if (left === right) return true;
  if (!home) return false;
  if (left === "~") return normalizePath(home) === right;
  if (left.startsWith("~/")) return normalizePath(`${home}/${left.slice(2)}`) === right;
  return false;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function uniqueDirs(dirs: string[]): string[] {
  const out: string[] = [];
  for (const dir of dirs) {
    const trimmed = dir.trim();
    if (!trimmed) continue;
    if (out.some((existing) => samePath(existing, trimmed, undefined))) continue;
    out.push(trimmed);
  }
  return out;
}

function leadingSpaces(line: string): number | null {
  if (line.includes("\t")) return null;
  let count = 0;
  while (line[count] === " ") count++;
  return count;
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function joinLines(lines: string[], newline = "\n"): string {
  if (lines.length === 0) return "";
  return `${lines.join(newline)}${newline}`;
}
