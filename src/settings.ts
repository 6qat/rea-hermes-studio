import { App, PluginSettingTab, Setting } from "obsidian";
import type HermesStudioPlugin from "./main";

export interface HermesPluginSettings {
  path: string;
  environment: Record<string, string>;
  autoStart: boolean;
  notifications: "all" | "permissions" | "off";
  trace: boolean;
  webviewState?: any;
  workspaceState?: Record<string, any>;
}

export const DEFAULT_HERMES_SETTINGS: HermesPluginSettings = {
  path: "",
  environment: {},
  autoStart: true,
  notifications: "all",
  trace: false,
  webviewState: undefined,
  workspaceState: {},
};

export function parseEnvText(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      out[key] = val;
    }
  }
  return out;
}

export function formatEnvText(env: Record<string, string>): string {
  return Object.entries(env ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

export class HermesSettingTab extends PluginSettingTab {
  plugin: HermesStudioPlugin;

  constructor(app: App, plugin: HermesStudioPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty?.() ?? (containerEl.innerHTML = "");

    const title = containerEl.ownerDocument.createElement("h2");
    title.textContent = "Hermes Studio";
    containerEl.appendChild(title);

    new Setting(containerEl)
      .setName("Hermes executable path")
      .setDesc(
        "Absolute path to the `hermes` binary. Leave empty to discover `hermes` on PATH or in `~/.local/bin/hermes`.",
      )
      .addText((text) =>
        text
          .setPlaceholder("/home/user/.local/bin/hermes")
          .setValue(this.plugin.settings.path)
          .onChange(async (value) => {
            this.plugin.settings.path = value.trim();
            await this.plugin.saveSettings("path");
          }),
      )
      .addButton((btn) =>
        btn.setButtonText("Restart Hermes").onClick(() => {
          this.plugin.executeHermesCommand("hermesStudio.restart");
        }),
      );

    new Setting(containerEl)
      .setName("Notifications")
      .setDesc(
        "Show an Obsidian notice when Hermes needs approval, finishes a background turn, or stops while you are looking away.",
      )
      .addDropdown((drop) =>
        drop
          .addOption("all", "All (approvals & finished turns)")
          .addOption("permissions", "Permissions only")
          .addOption("off", "Off")
          .setValue(this.plugin.settings.notifications)
          .onChange(async (value) => {
            this.plugin.settings.notifications = value as any;
            await this.plugin.saveSettings("notifications");
          }),
      );

    new Setting(containerEl)
      .setName("Environment variables")
      .setDesc(
        "Additional KEY=VALUE environment variables passed to `hermes acp` and CLI commands (one per line).",
      )
      .addTextArea((area) =>
        area
          .setPlaceholder("OPENAI_API_KEY=...\nANTHROPIC_API_KEY=...")
          .setValue(formatEnvText(this.plugin.settings.environment))
          .onChange(async (value) => {
            this.plugin.settings.environment = parseEnvText(value);
            await this.plugin.saveSettings("environment");
          }),
      );

    new Setting(containerEl)
      .setName("Log ACP trace")
      .setDesc(
        "Log every JSON-RPC message exchanged with `hermes acp` to the Hermes Studio log channel.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.trace).onChange(async (value) => {
          this.plugin.settings.trace = value;
          await this.plugin.saveSettings("trace");
        }),
      );

    new Setting(containerEl)
      .setName("Hermes setup & panels")
      .setDesc("Configure Hermes models in a terminal or refresh `~/.hermes` data.")
      .addButton((btn) =>
        btn
          .setButtonText("Refresh Panels")
          .onClick(() =>
            this.plugin.executeHermesCommand("hermesStudio.refreshPanels"),
          ),
      )
      .addButton((btn) =>
        btn
          .setButtonText("Show Log")
          .onClick(() =>
            this.plugin.executeHermesCommand("hermesStudio.showLog"),
          ),
      );
  }
}
