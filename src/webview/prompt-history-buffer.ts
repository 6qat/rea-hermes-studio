export interface PromptHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PromptHistoryBufferOptions {
  storage?: PromptHistoryStorage;
  storageKey?: string;
  maxSize?: number;
}

const DEFAULT_STORAGE_KEY = "hermes-studio:prompt-history";
const DEFAULT_MAX_SIZE = 100;

export class PromptHistoryBuffer {
  private entries: string[] = [];
  private currentIndex = -1;
  private uncommittedDraft = "";
  private storage: PromptHistoryStorage | undefined;
  private storageKey: string;
  private maxSize: number;

  constructor(options: PromptHistoryBufferOptions = {}) {
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this.storage =
      options.storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);

    this.loadFromStorage();
  }

  push(prompt: string): void {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    // Deduplicate consecutive identical prompts
    const lastEntry = this.entries[this.entries.length - 1];
    if (lastEntry !== trimmed) {
      this.entries.push(trimmed);
      if (this.entries.length > this.maxSize) {
        this.entries = this.entries.slice(-this.maxSize);
      }
      this.saveToStorage();
    }

    this.resetBrowsing();
  }

  navigateUp(currentDraft: string): string | undefined {
    if (this.entries.length === 0) return undefined;

    // Cache the user's uncommitted draft when entering history navigation
    if (this.currentIndex === -1) {
      this.uncommittedDraft = currentDraft;
      this.currentIndex = this.entries.length - 1;
    } else if (this.currentIndex > 0) {
      this.currentIndex -= 1;
    }

    return this.entries[this.currentIndex];
  }

  navigateDown(): string | undefined {
    if (this.currentIndex === -1) return undefined;

    if (this.currentIndex < this.entries.length - 1) {
      this.currentIndex += 1;
      return this.entries[this.currentIndex];
    }

    // Returning past the newest history entry restores the uncommitted draft
    this.currentIndex = -1;
    const restored = this.uncommittedDraft;
    this.uncommittedDraft = "";
    return restored;
  }

  isBrowsing(): boolean {
    return this.currentIndex !== -1;
  }

  resetBrowsing(): void {
    this.currentIndex = -1;
    this.uncommittedDraft = "";
  }

  getEntries(): readonly string[] {
    return [...this.entries];
  }

  private loadFromStorage(): void {
    if (!this.storage) return;

    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.entries = parsed
          .filter((item): item is string => typeof item === "string")
          .slice(-this.maxSize);
      }
    } catch {
      this.entries = [];
    }
  }

  private saveToStorage(): void {
    if (!this.storage) return;

    try {
      this.storage.setItem(this.storageKey, JSON.stringify(this.entries));
    } catch {
      // Storage quota exceeded or disabled; fail gracefully
    }
  }
}
