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
export function computeUnifiedDiffLines(before: string, after: string): UnifiedDiffRow[] {
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
export function renderDiffIntoContainer(container: HTMLElement, payload: DiffViewPayload): void {
  const doc = container.ownerDocument || document;
  if (typeof (container as any).empty === "function") {
    (container as any).empty();
  } else {
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
  }

  const wrapper = doc.createElement("div");
  wrapper.className = "hermes-diff-leaf";

  const header = doc.createElement("div");
  header.className = "hermes-diff-header";

  const titleEl = doc.createElement("div");
  titleEl.className = "hermes-diff-title";
  titleEl.textContent = payload.title;
  header.appendChild(titleEl);

  const rows = computeUnifiedDiffLines(payload.beforeText, payload.afterText);
  const addedCount = rows.filter((r) => r.kind === "add").length;
  const deletedCount = rows.filter((r) => r.kind === "del").length;

  const rightBar = doc.createElement("div");
  rightBar.className = "hermes-diff-actions";

  const statsEl = doc.createElement("span");
  const addSpan = doc.createElement("span");
  addSpan.className = "hermes-diff-stat-add";
  addSpan.textContent = `+${addedCount}`;

  const delSpan = doc.createElement("span");
  delSpan.className = "hermes-diff-stat-del";
  delSpan.textContent = `-${deletedCount}`;

  statsEl.append(addSpan, " ", delSpan);
  rightBar.appendChild(statsEl);

  if (payload.filePath && payload.onOpenFile) {
    const openBtn = doc.createElement("button");
    openBtn.type = "button";
    openBtn.textContent = "Open file";
    openBtn.className = "hermes-diff-open-btn";
    const firstChanged = rows.find((r) => r.kind !== "ctx");
    openBtn.addEventListener("click", () => {
      payload.onOpenFile?.(payload.filePath!, firstChanged?.newLine ?? firstChanged?.oldLine ?? 1);
    });
    rightBar.appendChild(openBtn);
  }

  header.appendChild(rightBar);
  wrapper.appendChild(header);

  const scrollArea = doc.createElement("div");
  scrollArea.className = "hermes-diff-scroll";

  const table = doc.createElement("table");
  table.className = "hermes-diff-table";

  const tbody = doc.createElement("tbody");
  for (const row of rows) {
    const tr = doc.createElement("tr");
    if (row.kind === "add") {
      tr.className = "hermes-diff-row-add";
    } else if (row.kind === "del") {
      tr.className = "hermes-diff-row-del";
    }

    const tdOld = doc.createElement("td");
    tdOld.className = "hermes-diff-num";
    tdOld.textContent = row.oldLine !== undefined ? String(row.oldLine) : "";

    const tdNew = doc.createElement("td");
    tdNew.className = "hermes-diff-num";
    tdNew.textContent = row.newLine !== undefined ? String(row.newLine) : "";

    const tdSign = doc.createElement("td");
    tdSign.className = `hermes-diff-sign${
      row.kind === "add"
        ? " hermes-diff-sign-add"
        : row.kind === "del"
          ? " hermes-diff-sign-del"
          : ""
    }`;
    tdSign.textContent = row.kind === "add" ? "+" : row.kind === "del" ? "-" : " ";

    const tdCode = doc.createElement("td");
    tdCode.className = "hermes-diff-code";
    tdCode.textContent = row.text;

    tr.append(tdOld, tdNew, tdSign, tdCode);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  scrollArea.appendChild(table);
  wrapper.appendChild(scrollArea);
  container.appendChild(wrapper);
}
