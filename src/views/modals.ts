import { type App, FuzzySuggestModal, Modal, Notice } from "obsidian";
import { SimpleUri } from "../host/obsidian-shim";

export class HermesQuickPickModal extends FuzzySuggestModal<any> {
  private readonly itemsList: any[];
  private readonly onResolve: (value: any) => void;
  private resolved = false;

  constructor(
    app: App,
    items: any[],
    options: { placeHolder?: string; title?: string } | undefined,
    onResolve: (value: any) => void,
  ) {
    super(app);
    this.itemsList = items;
    this.onResolve = onResolve;
    if (options?.placeHolder) {
      this.setPlaceholder(options.placeHolder);
    } else if (options?.title) {
      this.setPlaceholder(options.title);
    }
  }

  getItems(): any[] {
    return this.itemsList;
  }

  getItemText(item: any): string {
    if (typeof item === "string") return item;
    return [item.label, item.description, item.detail].filter(Boolean).join(" — ");
  }

  onChooseItem(item: any): void {
    this.resolved = true;
    this.onResolve(item);
  }

  onClose(): void {
    super.onClose?.();
    setTimeout(() => {
      if (!this.resolved) {
        this.resolved = true;
        this.onResolve(undefined);
      }
    }, 50);
  }
}

export class HermesMultiPickModal extends Modal {
  private selected = new Set<number>();
  private resolved = false;
  private filterQuery = "";

  constructor(
    app: App,
    private readonly items: any[],
    private readonly options: { title?: string; placeHolder?: string } | undefined,
    private readonly onResolve: (value: any[] | undefined) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.textContent = this.options?.title ?? "Select files";
    if (typeof contentEl.empty === "function") {
      contentEl.empty();
    } else {
      while (contentEl.firstChild) {
        contentEl.removeChild(contentEl.firstChild);
      }
    }
    contentEl.className = "hermes-modal-multiselect";

    const doc = contentEl.ownerDocument;
    const searchInput = doc.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = this.options?.placeHolder ?? "Type to filter files…";
    searchInput.className = "hermes-modal-search";
    contentEl.appendChild(searchInput);

    const listEl = doc.createElement("div");
    listEl.className = "hermes-modal-list";
    contentEl.appendChild(listEl);

    const renderList = () => {
      if (typeof (listEl as any).empty === "function") {
        (listEl as any).empty();
      } else {
        while (listEl.firstChild) {
          listEl.removeChild(listEl.firstChild);
        }
      }
      const q = this.filterQuery.toLowerCase().trim();
      this.items.forEach((item, idx) => {
        const text = `${item.label ?? ""} ${item.description ?? ""}`.toLowerCase();
        if (q && !text.includes(q)) return;

        const row = doc.createElement("label");
        row.className = "hermes-modal-row";
        const cb = doc.createElement("input");
        cb.type = "checkbox";
        cb.checked = this.selected.has(idx);
        cb.addEventListener("change", () => {
          if (cb.checked) this.selected.add(idx);
          else this.selected.delete(idx);
        });

        const labelSpan = doc.createElement("span");
        labelSpan.className = "hermes-modal-row-label";
        labelSpan.textContent = item.label ?? String(item);

        const descSpan = doc.createElement("span");
        descSpan.className = "hermes-modal-row-desc";
        descSpan.textContent = item.description ?? "";

        row.append(cb, labelSpan, descSpan);
        listEl.appendChild(row);
      });
    };

    searchInput.addEventListener("input", () => {
      this.filterQuery = searchInput.value;
      renderList();
    });
    renderList();

    const footer = doc.createElement("div");
    footer.className = "hermes-modal-footer";

    const cancelBtn = doc.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => this.close());

    const okBtn = doc.createElement("button");
    okBtn.className = "mod-cta";
    okBtn.textContent = "Add selected";
    okBtn.addEventListener("click", () => {
      this.resolved = true;
      const picked = [...this.selected].map((i) => this.items[i]);
      this.onResolve(picked);
      this.close();
    });

    footer.append(cancelBtn, okBtn);
    contentEl.appendChild(footer);
    setTimeout(() => searchInput.focus(), 10);
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolved = true;
      this.onResolve(undefined);
    }
  }
}

export async function showHermesNotice(
  message: string,
  level: "info" | "warning" | "error",
  actions?: string[],
): Promise<string | undefined> {
  if (!actions || actions.length === 0) {
    new Notice(message, level === "error" ? 7000 : 4500);
    return undefined;
  }

  return new Promise((resolve) => {
    let settled = false;
    const notice = new Notice("", 10000);
    const el = notice.noticeEl;
    if (typeof (el as any).empty === "function") {
      (el as any).empty();
    } else {
      while (el.firstChild) {
        el.removeChild(el.firstChild);
      }
    }
    const doc = el.ownerDocument || document;

    const wrap = doc.createElement("div");
    wrap.className = "hermes-notice-wrap";

    const msgEl = doc.createElement("div");
    msgEl.textContent = message;
    wrap.appendChild(msgEl);

    const btnRow = doc.createElement("div");
    btnRow.className = "hermes-notice-btn-row";

    for (const action of actions) {
      const btn = doc.createElement("button");
      btn.textContent = action;
      btn.className = "mod-cta hermes-notice-btn";
      btn.addEventListener("click", () => {
        if (settled) return;
        settled = true;
        notice.hide();
        resolve(action);
      });
      btnRow.appendChild(btn);
    }

    wrap.appendChild(btnRow);
    el.appendChild(wrap);

    setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(undefined);
      }
    }, 10500);
  });
}

export function showImageFileDialog(): Promise<SimpleUri[] | undefined> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(undefined);
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".png,.jpg,.jpeg,.gif,.webp,image/png,image/jpeg,image/gif,image/webp";
    input.className = "hermes-hidden-file-input";
    document.body.appendChild(input);

    input.addEventListener("change", () => {
      const file = input.files?.[0] as any;
      input.remove();
      if (file?.path) {
        resolve([SimpleUri.file(file.path)]);
      } else {
        resolve(undefined);
      }
    });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(undefined);
    });
    input.click();
  });
}
