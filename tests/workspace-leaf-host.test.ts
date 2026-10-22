import { describe, expect, it, vi } from "vitest";
import { createWorkspaceLeafHost } from "../src/host/workspace-leaf-host";

function workspace() {
  const revealed: any[] = [];
  const side = { view: { kind: "side" }, setViewState: vi.fn(async () => {}) };
  const created: any[] = [];
  return {
    revealed,
    created,
    side,
    source: {
      getLeavesOfType: (type: string) => (type === "side" ? [side] : []),
      getRightLeaf: () => null,
      getLeaf: (kind: any) => {
        const leaf = {
          kind,
          view: { kind: "fresh", payload: undefined as any },
          setViewState: vi.fn(async (state: any) => {
            leaf.view = {
              kind: state.type,
              setDocPayload: (payload: any) => {
                leaf.view.payload = payload;
              },
            };
          }),
        };
        created.push(leaf);
        return leaf;
      },
      revealLeaf: async (leaf: any) => {
        revealed.push(leaf);
      },
    },
  };
}

describe("WorkspaceLeafHost", () => {
  it("reuses an existing leaf and does not create another", async () => {
    const ws = workspace();
    const host = createWorkspaceLeafHost(() => ws.source);

    await host.reveal("side", { placement: "right" });

    expect(ws.revealed).toEqual([ws.side]);
    expect(ws.created).toEqual([]);
    expect(ws.side.setViewState).not.toHaveBeenCalled();
  });

  it("creates a right leaf when none exists", async () => {
    const right = { view: { kind: "new-side" }, setViewState: vi.fn(async () => {}) };
    const ws = workspace();
    ws.source.getLeavesOfType = () => [];
    ws.source.getRightLeaf = () => right;
    const host = createWorkspaceLeafHost(() => ws.source);

    await host.reveal("side", { placement: "right" });

    expect(right.setViewState).toHaveBeenCalledWith({ type: "side", active: true });
    expect(ws.revealed).toEqual([right]);
    expect(ws.created).toEqual([]);
  });

  it("creates a tab leaf and binds the payload after reveal", async () => {
    const ws = workspace();
    const host = createWorkspaceLeafHost(() => ws.source);
    const payload = { title: "SKILL.md" };

    await host.reveal("doc", {
      placement: "tab",
      bind: (view) => view.setDocPayload(payload),
    });

    expect(ws.created).toHaveLength(1);
    expect(ws.created[0].kind).toBe("tab");
    expect(ws.revealed).toEqual([ws.created[0]]);
    expect(ws.created[0].view.payload).toEqual(payload);
  });
});
