export type LeafPlacement = "right" | "tab";

export interface RevealOptions {
  placement?: LeafPlacement;
  bind?: (view: any) => void;
}

export interface WorkspaceLeafHost {
  reveal(viewType: string, options?: RevealOptions): Promise<void>;
}

interface WorkspaceLeafSource {
  getLeavesOfType?: (type: string) => any[];
  getRightLeaf?: (split: boolean) => any;
  getLeaf?: (kind?: any) => any;
  revealLeaf?: (leaf: any) => Promise<void> | void;
}

export function createWorkspaceLeafHost(
  getWorkspace: () => WorkspaceLeafSource | undefined,
): WorkspaceLeafHost {
  return {
    async reveal(viewType, options) {
      const workspace = getWorkspace();
      if (!workspace) return;

      let leaf = workspace.getLeavesOfType?.(viewType)?.[0];
      if (!leaf) {
        const placement = options?.placement ?? "tab";
        leaf =
          placement === "right"
            ? (workspace.getRightLeaf?.(false) ?? workspace.getLeaf?.(false))
            : workspace.getLeaf?.("tab");
        await leaf?.setViewState?.({
          type: viewType,
          active: true,
        });
      }
      if (!leaf) return;
      await workspace.revealLeaf?.(leaf);
      options?.bind?.(leaf.view);
    },
  };
}
