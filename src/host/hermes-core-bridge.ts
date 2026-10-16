import path from "node:path";
import os from "node:os";
import { createHermesExtensionModule } from "./hermes-core.js";
import type { createObsidianVscodeShim } from "./obsidian-shim";

export interface ActivateHermesCoreOptions {
  vscodeShim: ReturnType<typeof createObsidianVscodeShim>;
  extensionPath: string;
  globalStoragePath?: string;
  initialWorkspaceState?: Record<string, any>;
  onWorkspaceStateChange?: (state: Record<string, any>) => void;
  resolvePromptWikiLinks?: (promptText: string) => string[];
  getCustomEnv?: () => Record<string, string>;
}

export interface ActivatedHermesCore {
  subscriptions: Array<{ dispose?: () => any }>;
  workspaceStateData: Record<string, any>;
  deactivate: () => Promise<void>;
}

export function activateHermesCore(
  options: ActivateHermesCoreOptions,
): ActivatedHermesCore {
  const { vscodeShim, extensionPath } = options;
  const workspaceStateData: Record<string, any> = {
    ...(options.initialWorkspaceState ?? {}),
  };
  const globalStateData: Record<string, any> = {};
  const subscriptions: Array<{ dispose?: () => any }> = [];

  const createMemento = (
    store: Record<string, any>,
    onChange?: (next: Record<string, any>) => void,
  ) => ({
    get<T>(key: string, defaultValue?: T): T {
      return key in store ? (store[key] as T) : (defaultValue as T);
    },
    async update(key: string, value: any): Promise<void> {
      if (value === undefined) {
        delete store[key];
      } else {
        store[key] = value;
      }
      onChange?.({ ...store });
    },
    keys(): readonly string[] {
      return Object.keys(store);
    },
  });

  const extContext = {
    subscriptions,
    extensionUri: vscodeShim.Uri.file(extensionPath),
    extensionPath,
    globalStorageUri: vscodeShim.Uri.file(
      options.globalStoragePath ?? path.join(os.homedir(), ".hermes", "obsidian-storage"),
    ),
    workspaceState: createMemento(workspaceStateData, options.onWorkspaceStateChange),
    globalState: createMemento(globalStateData),
    extension: {
      id: "hermes-studio",
      packageJSON: {
        name: "hermes-studio",
        version: "0.6.1",
      },
    },
  };

  const mod = createHermesExtensionModule(vscodeShim, {
    resolvePromptWikiLinks: options.resolvePromptWikiLinks,
    getCustomEnv: options.getCustomEnv,
  });

  mod.activate(extContext);

  return {
    subscriptions,
    workspaceStateData,
    async deactivate() {
      try {
        await mod.deactivate?.();
      } catch {}
      for (const sub of subscriptions.splice(0)) {
        try {
          sub?.dispose?.();
        } catch {}
      }
    },
  };
}
