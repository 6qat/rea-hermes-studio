// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { PromptHistoryBuffer } from "../src/webview/prompt-history-buffer";
import { mountHermesWebview } from "../src/webview/webview-mount";
import { MemoryStorage } from "./mocks/memory-storage";

describe("Composer PromptHistoryBuffer integration", () => {
  it("navigates history with ArrowUp and ArrowDown, guards multiline input, and saves sent prompts", async () => {
    const hostEl = document.createElement("div");
    document.body.appendChild(hostEl);
    const shadowRoot = hostEl.attachShadow({ mode: "open" });

    const storage = new MemoryStorage();
    const promptHistory = new PromptHistoryBuffer({ storage });
    promptHistory.push("first command\nsecond line of first command");
    promptHistory.push("second command");

    const receivedByHost: any[] = [];
    let stateStore: any;

    const instance = mountHermesWebview({
      shadowRoot,
      place: "side",
      promptHistory,
      onMessageFromWebview: (msg) => {
        receivedByHost.push(msg);
      },
      getState: () => stateStore,
      setState: (s) => {
        stateStore = s;
      },
    });

    instance.postMessageToWebview({
      type: "init",
      model: {
        items: [],
        meta: {
          connection: { state: "ready" },
          busy: false,
          turn: 0,
          queued: [],
          models: [{ id: "test-model", label: "Test Model" }],
          model: "test-model",
          modes: [],
          skills: [],
          folder: "TestVault",
        },
      },
    });

    await new Promise((r) => setTimeout(r, 40));

    const textarea = shadowRoot.querySelector("textarea");
    expect(textarea).not.toBeNull();
    if (!textarea) return;

    // 1. ArrowUp on empty composer recalls latest prompt ("second command")
    textarea.focus();
    const upEvent1 = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      cancelable: true,
      bubbles: true,
    });
    textarea.dispatchEvent(upEvent1);
    expect(upEvent1.defaultPrevented).toBe(true);

    await new Promise((r) => setTimeout(r, 20));
    expect(textarea.value).toBe("second command");
    expect(textarea.selectionStart).toBe("second command".length);

    // 2. ArrowUp while browsing continues to recall older multiline prompt without getting trapped
    const upEvent2 = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      cancelable: true,
      bubbles: true,
    });
    textarea.dispatchEvent(upEvent2);
    expect(upEvent2.defaultPrevented).toBe(true);

    await new Promise((r) => setTimeout(r, 20));
    expect(textarea.value).toBe("first command\nsecond line of first command");

    // 3. ArrowDown advances forward to "second command"
    const downEvent1 = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      cancelable: true,
      bubbles: true,
    });
    textarea.dispatchEvent(downEvent1);
    expect(downEvent1.defaultPrevented).toBe(true);

    await new Promise((r) => setTimeout(r, 20));
    expect(textarea.value).toBe("second command");

    // 4. ArrowDown past newest entry restores the uncommitted draft (empty string)
    const downEvent2 = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      cancelable: true,
      bubbles: true,
    });
    textarea.dispatchEvent(downEvent2);
    expect(downEvent2.defaultPrevented).toBe(true);

    await new Promise((r) => setTimeout(r, 20));
    expect(textarea.value).toBe("");

    // 5. ArrowDown when not browsing retains native textarea behavior (not defaultPrevented)
    const downEvent3 = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      cancelable: true,
      bubbles: true,
    });
    textarea.dispatchEvent(downEvent3);
    expect(downEvent3.defaultPrevented).toBe(false);

    // 6. Caret guard: ArrowUp on line 2+ does NOT recall history when starting from new draft
    textarea.value = "line 1\nline 2";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.setSelectionRange(10, 10); // on "line 2"
    const upEventMulti = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      cancelable: true,
      bubbles: true,
    });
    textarea.dispatchEvent(upEventMulti);
    expect(upEventMulti.defaultPrevented).toBe(false);
    expect(textarea.value).toBe("line 1\nline 2");

    // 7. Editing recalled prompt cancels browsing so subsequent ArrowDown is native
    const upEventRecall = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      cancelable: true,
      bubbles: true,
    });
    textarea.setSelectionRange(0, 0); // on line 1
    textarea.dispatchEvent(upEventRecall);
    await new Promise((r) => setTimeout(r, 20));
    expect(textarea.value).toBe("second command");

    // User edits the recalled prompt
    textarea.value = "second command edited";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    expect(promptHistory.isBrowsing()).toBe(false);

    const downEventAfterEdit = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      cancelable: true,
      bubbles: true,
    });
    textarea.dispatchEvent(downEventAfterEdit);
    expect(downEventAfterEdit.defaultPrevented).toBe(false);
    expect(textarea.value).toBe("second command edited");

    // 8. Message send records prompt into promptHistory buffer and resets browsing
    textarea.value = "brand new query";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    const enterEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      cancelable: true,
      bubbles: true,
    });
    textarea.dispatchEvent(enterEvent);
    expect(enterEvent.defaultPrevented).toBe(true);

    await new Promise((r) => setTimeout(r, 20));
    expect(promptHistory.getEntries()).toContain("brand new query");
    expect(promptHistory.isBrowsing()).toBe(false);

    instance.destroy();
    hostEl.remove();
  });
});
