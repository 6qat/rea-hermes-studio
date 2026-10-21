import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface TerminalSpawnOptions {
  name: string;
  cwd?: string;
  shellPath: string;
  shellArgs?: string[];
  env?: Record<string, string | undefined>;
  onClose?: () => void;
}

const LINUX_TERMINALS: Array<{ bin: string; args: (cmd: string[]) => string[] }> = [
  { bin: "x-terminal-emulator", args: (cmd) => ["-e", ...cmd] },
  { bin: "kitty", args: (cmd) => ["--", ...cmd] },
  { bin: "alacritty", args: (cmd) => ["-e", ...cmd] },
  { bin: "wezterm", args: (cmd) => ["start", "--", ...cmd] },
  { bin: "gnome-terminal", args: (cmd) => ["--", ...cmd] },
  { bin: "konsole", args: (cmd) => ["-e", ...cmd] },
  { bin: "xfce4-terminal", args: (cmd) => ["-x", ...cmd] },
  { bin: "xterm", args: (cmd) => ["-e", ...cmd] },
];

function commandExists(bin: string): boolean {
  if (path.isAbsolute(bin)) {
    try {
      fs.accessSync(bin, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  const envPath = process.env.PATH || "";
  const parts = envPath.split(path.delimiter);
  for (const dir of parts) {
    if (!dir) continue;
    const full = path.join(dir, bin);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return true;
    } catch {}
  }
  return false;
}

export function launchExternalTerminal(opts: TerminalSpawnOptions): {
  show: () => void;
  dispose: () => void;
} {
  const fullCmd = [opts.shellPath, ...(opts.shellArgs ?? [])];
  let child: childProcess.ChildProcess | undefined;

  if (process.platform === "linux") {
    const found = LINUX_TERMINALS.find((t) => commandExists(t.bin));
    if (found) {
      child = childProcess.spawn(found.bin, found.args(fullCmd), {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env } as NodeJS.ProcessEnv,
        detached: true,
        stdio: "ignore",
      });
      child.on("exit", () => opts.onClose?.());
      child.unref();
    }
  } else if (process.platform === "darwin") {
    const escaped = fullCmd.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
    child = childProcess.spawn(
      "osascript",
      [
        "-e",
        `tell application "Terminal" to do script "${escaped.replace(/"/g, '\\"')}"`,
        "-e",
        `tell application "Terminal" to activate`,
      ],
      { cwd: opts.cwd, stdio: "ignore" },
    );
    child.on("exit", () => opts.onClose?.());
  } else if (process.platform === "win32") {
    if (commandExists("wt.exe") || commandExists("wt")) {
      child = childProcess.spawn("wt.exe", ["new-tab", ...fullCmd], {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env } as NodeJS.ProcessEnv,
        detached: true,
        stdio: "ignore",
      });
    } else {
      child = childProcess.spawn("cmd.exe", ["/c", "start", opts.name ?? "Hermes", ...fullCmd], {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env } as NodeJS.ProcessEnv,
        detached: true,
        stdio: "ignore",
      });
    }
    child.on("exit", () => opts.onClose?.());
    child.unref?.();
  }

  if (!child) {
    console.warn(`[Hermes Terminal] No suitable terminal emulator found on ${process.platform}.`);
    opts.onClose?.();
  }

  return {
    show() {},
    dispose() {
      try {
        child?.kill();
      } catch {}
    },
  };
}
