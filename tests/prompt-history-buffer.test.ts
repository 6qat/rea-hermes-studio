import { beforeEach, describe, expect, it } from "vitest";
import { PromptHistoryBuffer } from "../src/webview/prompt-history-buffer";
import { MemoryStorage } from "./mocks/memory-storage";

describe("PromptHistoryBuffer", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  describe("push and deduplication", () => {
    it("adds non-empty prompts and ignores empty or whitespace-only inputs", () => {
      const buffer = new PromptHistoryBuffer({ storage });
      buffer.push("");
      buffer.push("   ");
      buffer.push("\n\t  ");
      expect(buffer.getEntries()).toEqual([]);

      buffer.push("first prompt");
      expect(buffer.getEntries()).toEqual(["first prompt"]);
    });

    it("deduplicates consecutive identical entries but allows non-consecutive duplicates", () => {
      const buffer = new PromptHistoryBuffer({ storage });
      buffer.push("hello");
      buffer.push("hello");
      buffer.push("  hello  ");
      expect(buffer.getEntries()).toEqual(["hello"]);

      buffer.push("world");
      buffer.push("hello");
      expect(buffer.getEntries()).toEqual(["hello", "world", "hello"]);
    });

    it("enforces maximum capacity with FIFO eviction", () => {
      const buffer = new PromptHistoryBuffer({ storage, maxSize: 3 });
      buffer.push("one");
      buffer.push("two");
      buffer.push("three");
      expect(buffer.getEntries()).toEqual(["one", "two", "three"]);

      buffer.push("four");
      expect(buffer.getEntries()).toEqual(["two", "three", "four"]);
    });
  });

  describe("bidirectional navigation and draft preservation", () => {
    it("navigates backward with navigateUp and preserves in-progress draft", () => {
      const buffer = new PromptHistoryBuffer({ storage });
      buffer.push("first");
      buffer.push("second");
      buffer.push("third");

      expect(buffer.isBrowsing()).toBe(false);

      // Step up from active draft
      const r1 = buffer.navigateUp("my in-progress draft");
      expect(r1).toBe("third");
      expect(buffer.isBrowsing()).toBe(true);

      const r2 = buffer.navigateUp("ignored once browsing");
      expect(r2).toBe("second");

      const r3 = buffer.navigateUp("ignored once browsing");
      expect(r3).toBe("first");

      // Boundary check: cannot navigate past oldest entry
      const r4 = buffer.navigateUp("ignored once browsing");
      expect(r4).toBe("first");
    });

    it("navigates forward with navigateDown and restores uncommitted draft at bottom", () => {
      const buffer = new PromptHistoryBuffer({ storage });
      buffer.push("alpha");
      buffer.push("beta");

      // While not browsing, navigateDown returns undefined
      expect(buffer.navigateDown()).toBeUndefined();

      buffer.navigateUp("draft text"); // at 'beta'
      buffer.navigateUp("draft text"); // at 'alpha'

      expect(buffer.navigateDown()).toBe("beta");
      expect(buffer.isBrowsing()).toBe(true);

      // Returning to bottom returns uncommitted draft
      expect(buffer.navigateDown()).toBe("draft text");
      expect(buffer.isBrowsing()).toBe(false);

      // Down again does nothing
      expect(buffer.navigateDown()).toBeUndefined();
    });

    it("does not mutate historical records when recalled prompt is modified externally", () => {
      const buffer = new PromptHistoryBuffer({ storage });
      buffer.push("original prompt");

      const recalled = buffer.navigateUp("draft");
      expect(recalled).toBe("original prompt");

      // Subsequent push of modified prompt adds a new entry
      buffer.push("edited prompt");
      expect(buffer.getEntries()).toEqual(["original prompt", "edited prompt"]);
      expect(buffer.isBrowsing()).toBe(false);
    });

    it("resets browsing pointer when pushing a new entry", () => {
      const buffer = new PromptHistoryBuffer({ storage });
      buffer.push("first");
      buffer.push("second");

      buffer.navigateUp("");
      expect(buffer.isBrowsing()).toBe(true);

      buffer.push("third");
      expect(buffer.isBrowsing()).toBe(false);

      // Next navigateUp should immediately return 'third'
      expect(buffer.navigateUp("")).toBe("third");
    });
  });

  describe("persistence across reloads", () => {
    it("persists entries to storage and loads existing entries on initialization", () => {
      const buffer1 = new PromptHistoryBuffer({ storage, storageKey: "test:history" });
      buffer1.push("persisted item 1");
      buffer1.push("persisted item 2");

      const raw = storage.getItem("test:history");
      expect(raw).toBeDefined();
      expect(JSON.parse(raw!)).toEqual(["persisted item 1", "persisted item 2"]);

      // Second instance initialized from same storage
      const buffer2 = new PromptHistoryBuffer({ storage, storageKey: "test:history" });
      expect(buffer2.getEntries()).toEqual(["persisted item 1", "persisted item 2"]);
      expect(buffer2.navigateUp("")).toBe("persisted item 2");
    });

    it("handles corrupt JSON in storage gracefully by falling back to empty history", () => {
      storage.setItem("test:history", "{ not valid json [");
      const buffer = new PromptHistoryBuffer({ storage, storageKey: "test:history" });
      expect(buffer.getEntries()).toEqual([]);
      buffer.push("recovery entry");
      expect(buffer.getEntries()).toEqual(["recovery entry"]);
    });

    it("handles non-array stored data gracefully", () => {
      storage.setItem("test:history", JSON.stringify({ error: "unexpected structure" }));
      const buffer = new PromptHistoryBuffer({ storage, storageKey: "test:history" });
      expect(buffer.getEntries()).toEqual([]);
    });
  });
});
