export interface UnifiedDiffRow {
  kind: "ctx" | "add" | "del";
  oldLine?: number;
  newLine?: number;
  text: string;
}

export interface DiffViewPayload {
  title: string;
  beforeText: string;
  afterText: string;
  filePath?: string;
  onOpenFile?: (filePath: string, line?: number) => void;
}

/**
 * Computes a line-by-line unified diff between `before` and `after` using LCS.
 */
export function computeUnifiedDiffLines(
  before: string,
  after: string,
): UnifiedDiffRow[] {
  const splitLines = (s: string) => {
    if (!s) return [];
    const lines = s.split(/\r?\n/);
    if (lines.length > 0 && lines.at(-1) === "") lines.pop();
    return lines;
  };

  const a = splitLines(before);
  const b = splitLines(after);
  const n = a.length;
  const m = b.length;

  // Guard against huge files by falling back to simple prefix/suffix + changed block
  if (n * m > 2_500_000) {
    let p = 0;
    while (p < n && p < m && a[p] === b[p]) p++;
    let s = 0;
    while (s < n - p && s < m - p && a[n - 1 - s] === b[m - 1 - s]) s++;
    const rows: UnifiedDiffRow[] = [];
    for (let i = 0; i < p; i++) {
      rows.push({ kind: "ctx", oldLine: i + 1, newLine: i + 1, text: a[i] });
    }
    for (let i = p; i < n - s; i++) {
      rows.push({ kind: "del", oldLine: i + 1, text: a[i] });
    }
    for (let j = p; j < m - s; j++) {
      rows.push({ kind: "add", newLine: j + 1, text: b[j] });
    }
    for (let k = 0; k < s; k++) {
      rows.push({
        kind: "ctx",
        oldLine: n - s + k + 1,
        newLine: m - s + k + 1,
        text: a[n - s + k],
      });
    }
    return rows;
  }

  const dp = new Int32Array((n + 1) * (m + 1));
  const width = m + 1;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i * width + j] = dp[(i + 1) * width + (j + 1)] + 1;
      } else {
        const down = dp[(i + 1) * width + j];
        const right = dp[i * width + (j + 1)];
        dp[i * width + j] = down >= right ? down : right;
      }
    }
  }

  const rows: UnifiedDiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({
        kind: "ctx",
        oldLine: i + 1,
        newLine: j + 1,
        text: a[i],
      });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      rows.push({ kind: "del", oldLine: i + 1, text: a[i] });
      i++;
    } else {
      rows.push({ kind: "add", newLine: j + 1, text: b[j] });
      j++;
    }
  }
  while (i < n) {
    rows.push({ kind: "del", oldLine: i + 1, text: a[i] });
    i++;
  }
  while (j < m) {
    rows.push({ kind: "add", newLine: j + 1, text: b[j] });
    j++;
  }
  return rows;
}

/**
 * Renders a dark-themed unified diff view inside an Obsidian leaf container.
 */
export function renderDiffIntoContainer(
  container: HTMLElement,
  payload: DiffViewPayload,
): void {
  const doc = container.ownerDocument || document;
  container.innerHTML = "";

  const wrapper = doc.createElement("div");
  wrapper.className = "hermes-diff-leaf";
  wrapper.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "height:100%",
    "background:var(--background-primary, #0b0f19)",
    "color:var(--text-normal, #e2e8f0)",
    "font-family:var(--font-interface, sans-serif)",
    "overflow:hidden",
  ].join(";");

  const header = doc.createElement("div");
  header.style.cssText = [
    "display:flex",
    "align-items:center",
    "justify-content:space-between",
    "gap:12px",
    "padding:10px 16px",
    "background:var(--background-secondary, #0f172a)",
    "border-bottom:1px solid var(--background-modifier-border, #1e293b)",
    "flex-shrink:0",
  ].join(";");

  const titleEl = doc.createElement("div");
  titleEl.style.cssText = "font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
  titleEl.textContent = payload.title;
  header.appendChild(titleEl);

  const rows = computeUnifiedDiffLines(payload.beforeText, payload.afterText);
  const addedCount = rows.filter((r) => r.kind === "add").length;
  const deletedCount = rows.filter((r) => r.kind === "del").length;

  const rightBar = doc.createElement("div");
  rightBar.style.cssText = "display:flex;align-items:center;gap:10px;font-size:12px;flex-shrink:0;";

  const statsEl = doc.createElement("span");
  statsEl.innerHTML = `<span style="color:#10b981;font-weight:600">+${addedCount}</span> <span style="color:#ef4444;font-weight:600">-${deletedCount}</span>`;
  rightBar.appendChild(statsEl);

  if (payload.filePath && payload.onOpenFile) {
    const openBtn = doc.createElement("button");
    openBtn.type = "button";
    openBtn.textContent = "Open file";
    openBtn.style.cssText = [
      "background:var(--interactive-accent, #6366f1)",
      "color:var(--text-on-accent, #ffffff)",
      "border:none",
      "border-radius:5px",
      "padding:4px 10px",
      "font-size:12px",
      "cursor:pointer",
    ].join(";");
    const firstChanged = rows.find((r) => r.kind !== "ctx");
    openBtn.addEventListener("click", () => {
      payload.onOpenFile?.(
        payload.filePath!,
        firstChanged?.newLine ?? firstChanged?.oldLine ?? 1,
      );
    });
    rightBar.appendChild(openBtn);
  }

  header.appendChild(rightBar);
  wrapper.appendChild(header);

  const scrollArea = doc.createElement("div");
  scrollArea.style.cssText = "flex:1;overflow:auto;padding:8px 0;";

  const table = doc.createElement("table");
  table.style.cssText = [
    "width:100%",
    "border-collapse:collapse",
    "font-family:var(--font-monospace, monospace)",
    "font-size:12.5px",
    "line-height:1.5",
  ].join(";");

  const tbody = doc.createElement("tbody");
  for (const row of rows) {
    const tr = doc.createElement("tr");
    if (row.kind === "add") {
      tr.style.background = "rgba(16, 185, 129, 0.14)";
    } else if (row.kind === "del") {
      tr.style.background = "rgba(239, 68, 68, 0.14)";
    }

    const tdOld = doc.createElement("td");
    tdOld.style.cssText =
      "width:44px;text-align:right;padding:0 8px;color:var(--text-muted, #64748b);user-select:none;";
    tdOld.textContent = row.oldLine !== undefined ? String(row.oldLine) : "";

    const tdNew = doc.createElement("td");
    tdNew.style.cssText =
      "width:44px;text-align:right;padding:0 8px;color:var(--text-muted, #64748b);user-select:none;";
    tdNew.textContent = row.newLine !== undefined ? String(row.newLine) : "";

    const tdSign = doc.createElement("td");
    tdSign.style.cssText = "width:20px;text-align:center;user-select:none;font-weight:600;";
    tdSign.textContent = row.kind === "add" ? "+" : row.kind === "del" ? "-" : " ";
    if (row.kind === "add") tdSign.style.color = "#10b981";
    if (row.kind === "del") tdSign.style.color = "#ef4444";

    const tdCode = doc.createElement("td");
    tdCode.style.cssText = "white-space:pre-wrap;word-break:break-word;padding:0 12px 0 4px;";
    tdCode.textContent = row.text;

    tr.append(tdOld, tdNew, tdSign, tdCode);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  scrollArea.appendChild(table);
  wrapper.appendChild(scrollArea);
  container.appendChild(wrapper);
}
