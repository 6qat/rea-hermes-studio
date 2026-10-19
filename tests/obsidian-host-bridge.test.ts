import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createObsidianVscodeShim,
  type ObsidianHostBridgeOptions,
} from "../src/host/obsidian-shim";

describe("ObsidianHostBridge with cohesive adapters", () => {
  it("initializes VS Code shim from structured adapters and resolves workspace operations", async () => {
    const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-vault-"));
    fs.mkdirSync(path.join(tmpVault, "Notes"), { recursive: true });
    const notePath = path.join(tmpVault, "Notes", "Test.md");
    fs.writeFileSync(notePath, "# Cohesive Host Bridge\nTesting adapters.", "utf8");

    const noticesShown: string[] = [];
    const filesOpened: string[] = [];

    const bridgeOptions: ObsidianHostBridgeOptions = {
      fs: {
        vaultBasePath: tmpVault,
        vaultName: "BridgeVault",
        hasGit: () => true,
        listVaultFiles: () => ["Notes/Test.md"],
      },
      settings: {
        getSettings: () => ({
          path: "",
          environment: { TEST_VAR: "1" },
          autoStart: true,
          notifications: "all",
        }),
        updateSetting: async () => {},
      },
      ui: {
        showNotice: async (msg) => {
          noticesShown.push(msg);
          return undefined;
        },
        openFileInObsidian: async (absPath) => {
          filesOpened.push(absPath);
        },
      },
      editor: {
        resolveWikiLink: (link) => (link === "Test" ? "Notes/Test.md" : undefined),
        getActiveEditorState: () => ({
          absPath: notePath,
          relPath: "Notes/Test.md",
          content: "Active note text",
          cursorLine: 5,
        }),
      },
    };

    const shim = createObsidianVscodeShim(bridgeOptions);

    // 1. Workspace folders
    expect(shim.workspace.workspaceFolders[0].name).toBe("BridgeVault");
    expect(shim.workspace.workspaceFolders[0].uri.fsPath).toBe(tmpVault);

    // 2. Git extension
    const gitExt = shim.extensions.getExtension("vscode.git");
    expect(gitExt?.isActive).toBe(true);

    // 3. URI parsing via editor adapter
    const parsedUri = shim.Uri.parse("wikilink://Test");
    expect(parsedUri.fsPath).toBe(notePath);

    // 4. File reading via fs adapter
    const fileStat = await shim.workspace.fs.stat(parsedUri);
    expect((fileStat.type & shim.FileType.File) !== 0).toBe(true);
    const contentBytes = await shim.workspace.fs.readFile(parsedUri);
    expect(Buffer.from(contentBytes).toString("utf8")).toContain("Cohesive Host Bridge");

    // 5. Active text editor via editor adapter
    const activeEditor = shim.window.activeTextEditor;
    expect(activeEditor).toBeDefined();
    expect(activeEditor?.document.fileName).toBe(notePath);
    expect(activeEditor?.selection.start.line).toBe(4);

    // 6. UI notices
    await shim.window.showInformationMessage("Hello from adapter!");
    expect(noticesShown).toContain("Hello from adapter!");

    fs.rmSync(tmpVault, { recursive: true, force: true });
  });

  it("supports minimal host bridge with default UI and editor adapters", async () => {
    const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-min-vault-"));

    const shim = createObsidianVscodeShim({
      fs: {
        vaultBasePath: tmpVault,
        vaultName: "MinimalVault",
      },
      settings: {
        getSettings: () => ({
          path: "",
          environment: {},
          autoStart: false,
          notifications: "off",
        }),
      },
    });

    expect(shim.workspace.workspaceFolders[0].name).toBe("MinimalVault");
    expect(shim.window.activeTextEditor).toBeUndefined();

    fs.rmSync(tmpVault, { recursive: true, force: true });
  });
});
