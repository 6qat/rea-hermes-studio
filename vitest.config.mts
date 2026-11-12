import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

// The published `obsidian` package is types only. Tests run against the local stand-in.

export default defineConfig({
  resolve: {
    alias: {
      obsidian: path.join(root, "tests/mocks/obsidian.ts"),
    },
  },
  plugins: [
    {
      name: "css-as-text",
      enforce: "pre",
      load(id) {
        const file = id.split("?", 1)[0];
        if (!file?.endsWith(".css")) return null;
        return `export default ${JSON.stringify(fs.readFileSync(file, "utf8"))};`;
      },
    },
  ],
});
