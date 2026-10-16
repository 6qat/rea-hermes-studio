export class FileSystemAdapter {
  constructor(private basePath = "/vault") {}
  getBasePath(): string {
    return this.basePath;
  }
}

export class Component {
  register(_cb: () => void): void {}
  registerEvent(_ev: any): void {}
}

export class Plugin extends Component {
  app: any;
  manifest: any;
  views = new Map<string, (leaf: any) => any>();
  commands: any[] = [];
  ribbonIcons: any[] = [];
  settingTabs: any[] = [];

  constructor(app: any, manifest: any) {
    super();
    this.app = app;
    this.manifest = manifest;
  }

  registerView(type: string, factory: (leaf: any) => any): void {
    this.views.set(type, factory);
  }

  addRibbonIcon(icon: string, title: string, cb: () => void): HTMLElement {
    const el = document.createElement("div");
    this.ribbonIcons.push({ icon, title, cb, el });
    return el;
  }

  addCommand(cmd: any): any {
    this.commands.push(cmd);
    return cmd;
  }

  addSettingTab(tab: any): void {
    this.settingTabs.push(tab);
  }

  registerObsidianProtocolHandler(_action: string, _cb: any): void {}

  async loadData(): Promise<any> {
    return {};
  }

  async saveData(_data: any): Promise<void> {}
}

export class ItemView extends Component {
  leaf: any;
  app: any;
  containerEl: HTMLElement;
  contentEl: HTMLElement;

  constructor(leaf: any) {
    super();
    this.leaf = leaf;
    this.app = leaf?.app;
    this.containerEl = document.createElement("div");
    const headerEl = document.createElement("div");
    this.contentEl = document.createElement("div");
    this.containerEl.append(headerEl, this.contentEl);
  }
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl: HTMLElement = document.createElement("div");

  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
  }
}

export class Modal {
  app: any;
  contentEl: HTMLElement = document.createElement("div");
  titleEl: HTMLElement = document.createElement("div");

  constructor(app: any) {
    this.app = app;
  }

  open(): void {}
  close(): void {}
}

export class FuzzySuggestModal<T> extends Modal {
  setPlaceholder(_p: string): void {}
  getItems(): T[] {
    return [];
  }
  getItemText(_item: T): string {
    return "";
  }
  onChooseItem(_item: T, _evt: MouseEvent | KeyboardEvent): void {}
}

export class Notice {
  noticeEl: HTMLElement = document.createElement("div");
  constructor(_msg: string, _timeout?: number) {}
  hide(): void {}
}

export class Setting {
  constructor(_el: HTMLElement) {}
  setName(_n: string) {
    return this;
  }
  setDesc(_d: string) {
    return this;
  }
  addText(cb: any) {
    cb({
      setPlaceholder() {
        return this;
      },
      setValue() {
        return this;
      },
      onChange() {
        return this;
      },
    });
    return this;
  }
  addTextArea(cb: any) {
    cb({
      setPlaceholder() {
        return this;
      },
      setValue() {
        return this;
      },
      onChange() {
        return this;
      },
    });
    return this;
  }
  addDropdown(cb: any) {
    cb({
      addOption() {
        return this;
      },
      setValue() {
        return this;
      },
      onChange() {
        return this;
      },
    });
    return this;
  }
  addToggle(cb: any) {
    cb({
      setValue() {
        return this;
      },
      onChange() {
        return this;
      },
    });
    return this;
  }
  addButton(cb: any) {
    cb({
      setButtonText() {
        return this;
      },
      setCta() {
        return this;
      },
      onClick() {
        return this;
      },
    });
    return this;
  }
}

export class MarkdownView {}
export class TFile {
  path = "";
  basename = "";
  name = "";
  extension = "md";
}

export class TFolder {
  path = "";
  name = "";
  children: any[] = [];
}

export class WorkspaceLeaf {
  view: any;
  getViewState() {
    return { type: "markdown", state: { mode: "source" } };
  }
  async setViewState(_state: any) {}
  async openFile(_file: any, _opts?: any) {}
}

export function addIcon(_id: string, _svg: string): void {}
