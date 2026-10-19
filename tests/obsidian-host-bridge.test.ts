import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createObsidianVscodeShim,
  type ObsidianHostBridge,
  SimpleUri,
} from "../src/host/obsidian-shim";

async function withTempVault(callback: (vaultPath: string) => void | Promise<void>) {
  const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-vault-"));
  try {
    await callback(tmpVault);
  } finally {
    fs.rmSync(tmpVault, { recursive: true, force: true });
  }
}

describe("ObsidianHostBridge with cohesive adapters", () => {
  it("initializes VS Code shim from structured adapters and resolves workspace operations", async () => {
    await withTempVault(async (tmpVault) => {
      fs.mkdirSync(path.join(tmpVault, "Notes"), { recursive: true });
      const notePath = path.join(tmpVault, "Notes", "Test.md");
      fs.writeFileSync(notePath, "# Cohesive Host Bridge\nTesting adapters.", "utf8");

      const noticesShown: string[] = [];
      const filesOpened: string[] = [];

      const bridge: ObsidianHostBridge = {
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

      const shim = createObsidianVscodeShim(bridge);

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
    });
  });

  it("supports minimal host bridge by supplying only VaultFileSystem", async () => {
    await withTempVault((tmpVault) => {
      const shim = createObsidianVscodeShim({
        fs: {
          vaultBasePath: tmpVault,
          vaultName: "MinimalVault",
        },
      });

      expect(shim.workspace.workspaceFolders[0].name).toBe("MinimalVault");
      expect(shim.window.activeTextEditor).toBeUndefined();
      expect(shim.workspace.getConfiguration().get("notifications")).toBe(true);
    });
  });

  it("supports UI-only testing without mock filesystem stubs", async () => {
    const diffCalls: any[] = [];
    const notices: string[] = [];

    const shim = createObsidianVscodeShim({
      ui: {
        showNotice: async (msg) => {
          notices.push(msg);
          return undefined;
        },
        openDiffInObsidian: async (params) => {
          diffCalls.push(params);
        },
      },
    });

    await shim.window.showInformationMessage("Notice test");
    expect(notices).toEqual(["Notice test"]);

    const left = SimpleUri.file("/left.md");
    const right = SimpleUri.file("/right.md");
    await shim.commands.executeCommand("vscode.diff", left, right, "Diff Test");
    expect(diffCalls.length).toBe(1);
    expect(diffCalls[0].title).toBe("Diff Test");
  });

  it("switches file reading between Vault, DataAdapter, and node fs fallbacks", async () => {
    await withTempVault(async (tmpVault) => {
      const testFileRel = "fallback-test.md";
      const testFileAbs = path.join(tmpVault, testFileRel);
      fs.writeFileSync(testFileAbs, "disk-fallback-content", "utf8");

      // 1. Vault fallback
      const shimVault = createObsidianVscodeShim({
        fs: {
          vaultBasePath: tmpVault,
          vaultName: "FallbackVault",
          vault: {
            getAbstractFileByPath: (p: string) => (p === testFileRel ? { path: p } : null),
            readBinary: async () => Buffer.from("vault-binary-content"),
          },
        },
      });
      const vaultBytes = await shimVault.workspace.fs.readFile(SimpleUri.file(testFileAbs));
      expect(Buffer.from(vaultBytes).toString("utf8")).toBe("vault-binary-content");

      // 2. DataAdapter fallback
      const shimAdapter = createObsidianVscodeShim({
        fs: {
          vaultBasePath: tmpVault,
          vaultName: "FallbackVault",
          adapter: {
            readBinary: async (p: string) =>
              p === testFileRel ? Buffer.from("adapter-binary-content") : null,
          },
        },
      });
      const adapterBytes = await shimAdapter.workspace.fs.readFile(SimpleUri.file(testFileAbs));
      expect(Buffer.from(adapterBytes).toString("utf8")).toBe("adapter-binary-content");

      // 3. Node fs disk fallback
      const shimDisk = createObsidianVscodeShim({
        fs: {
          vaultBasePath: tmpVault,
          vaultName: "FallbackVault",
        },
      });
      const diskBytes = await shimDisk.workspace.fs.readFile(SimpleUri.file(testFileAbs));
      expect(Buffer.from(diskBytes).toString("utf8")).toBe("disk-fallback-content");
    });
  });
});
