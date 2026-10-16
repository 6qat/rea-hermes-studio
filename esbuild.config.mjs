import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const prod = process.argv[2] === "production";
const vaultPluginDir =
  process.env.OBSIDIAN_PLUGIN_DIR ||
  "/home/guiga/Insync/ceschiatti@gmail.com/Dropbox/Obsidian/Main_Vault/.obsidian/plugins/hermes-studio";

const nodeBuiltins = [
  "assert",
  "buffer",
  "child_process",
  "crypto",
  "events",
  "fs",
  "fs/promises",
  "http",
  "https",
  "net",
  "os",
  "path",
  "process",
  "readline",
  "stream",
  "tls",
  "url",
  "util",
  "zlib",
];

const externals = [
  "obsidian",
  "electron",
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
  ...nodeBuiltins,
  ...nodeBuiltins.map((m) => `node:${m}`),
];

function syncToVault() {
  try {
    fs.mkdirSync(vaultPluginDir, { recursive: true });
    for (const file of ["manifest.json", "main.js", "styles.css"]) {
      const src = path.resolve(process.cwd(), file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(vaultPluginDir, file));
      }
    }
    console.log(`[build] Synced plugin artifacts to ${vaultPluginDir}`);
  } catch (err) {
    console.warn(`[build] Could not sync to vault directory: ${err.message}`);
  }
}

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: externals,
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  loader: {
    ".css": "text",
    ".svg": "text",
  },
});

if (prod) {
  await context.rebuild();
  await context.dispose();
  syncToVault();
} else {
  await context.watch();
}
