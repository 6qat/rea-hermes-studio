import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";

const PTY_HELPER = String.raw`
import errno
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

shell = sys.argv[1]
cwd = sys.argv[2]
cols = int(sys.argv[3])
rows = int(sys.argv[4])

def set_winsize(fd, cols, rows):
    if cols < 1 or rows < 1:
        return
    packed = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, packed)

def try_write(fd, pending):
    if not pending:
        return pending
    try:
        written = os.write(fd, pending)
    except OSError as exc:
        if exc.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
            return pending
        raise
    return pending[written:]

pid, master = pty.fork()
if pid == 0:
    try:
        try:
            os.close(3)
        except OSError:
            pass
        try:
            os.chdir(cwd)
        except OSError:
            os.chdir(os.path.expanduser("~"))
        set_winsize(0, cols, rows)
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        os.execvpe(shell, [shell], env)
    except OSError:
        os._exit(127)

set_winsize(master, cols, rows)

def stop_shell(signum, _frame):
    try:
        os.killpg(pid, signal.SIGHUP)
    except OSError:
        pass
    try:
        os.killpg(pid, signal.SIGKILL)
    except OSError:
        pass
    raise SystemExit(128 + signum)

signal.signal(signal.SIGTERM, stop_shell)
signal.signal(signal.SIGHUP, stop_shell)

for watched in (sys.stdin.fileno(), master, 3):
    flags = fcntl.fcntl(watched, fcntl.F_GETFL)
    fcntl.fcntl(watched, fcntl.F_SETFL, flags | os.O_NONBLOCK)

out_flags = fcntl.fcntl(sys.stdout.fileno(), fcntl.F_GETFL)
fcntl.fcntl(sys.stdout.fileno(), fcntl.F_SETFL, out_flags | os.O_NONBLOCK)

to_shell = b""
to_out = b""
control = b""
stdin_open = True
control_open = True
shell_open = True

try:
    while shell_open or to_out or to_shell:
        readers = []
        if shell_open:
            readers.append(master)
        if stdin_open:
            readers.append(sys.stdin.fileno())
        if control_open:
            readers.append(3)
        writers = []
        if to_out:
            writers.append(sys.stdout.fileno())
        if to_shell and shell_open:
            writers.append(master)
        readable, writable, _ = select.select(readers, writers, [])
        if master in readable:
            try:
                chunk = os.read(master, 65536)
            except OSError as exc:
                if exc.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                    chunk = None
                elif exc.errno == errno.EIO:
                    chunk = b""
                else:
                    raise
            if chunk == b"":
                shell_open = False
            elif chunk:
                to_out += chunk
        if stdin_open and sys.stdin.fileno() in readable:
            try:
                chunk = os.read(sys.stdin.fileno(), 65536)
            except OSError as exc:
                if exc.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                    chunk = None
                else:
                    raise
            if chunk == b"":
                stdin_open = False
            elif chunk:
                to_shell += chunk
        if control_open and 3 in readable:
            try:
                chunk = os.read(3, 4096)
            except OSError as exc:
                if exc.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                    chunk = None
                else:
                    raise
            if chunk == b"":
                control_open = False
            elif chunk:
                control += chunk
                while b"\n" in control:
                    line, control = control.split(b"\n", 1)
                    parts = line.decode("ascii", "replace").split()
                    if len(parts) == 3 and parts[0] == "resize":
                        try:
                            next_cols = int(parts[1])
                            next_rows = int(parts[2])
                        except ValueError:
                            continue
                        set_winsize(master, next_cols, next_rows)
                        try:
                            os.kill(pid, signal.SIGWINCH)
                        except OSError:
                            pass
        if master in writable:
            to_shell = try_write(master, to_shell)
        if sys.stdout.fileno() in writable:
            to_out = try_write(sys.stdout.fileno(), to_out)
finally:
    try:
        _pid, status = os.waitpid(pid, 0)
    except ChildProcessError:
        status = 0
    if os.WIFEXITED(status):
        code = os.WEXITSTATUS(status)
    elif os.WIFSIGNALED(status):
        code = 128 + os.WTERMSIG(status)
    else:
        code = 0
    sys.exit(code)
`;

export const TERMINAL_PYTHON_MISSING =
  "python3 was not found, so Hermes Studio cannot open a shell.";

export const TERMINAL_WINDOWS_UNSUPPORTED =
  "The integrated terminal needs a POSIX pty, which is not available on Windows.";

export const TERMINAL_FLATPAK_HOST_DENIED =
  "That shell is outside Obsidian's sandbox. Allow the app to start it on the system, then restart Obsidian: flatpak override --user --talk-name=org.freedesktop.Flatpak md.obsidian.Obsidian";

export function defaultTerminalShell(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return process.env.ComSpec || "cmd.exe";
  return "/bin/sh";
}

interface PtyStream {
  write?(data: string): unknown;
  on?(event: string, listener: (chunk: Buffer | Uint8Array | string) => void): void;
}

export interface PtyChild {
  stdin: { write(data: string | Uint8Array): unknown } | null;
  stdout: PtyStream | null;
  stderr: PtyStream | null;
  stdio: Array<PtyStream | null | undefined>;
  kill(signal?: NodeJS.Signals): void;
  on(event: "exit", listener: (code: number | null) => void): void;
  on(event: "error", listener: (error: NodeJS.ErrnoException) => void): void;
}

export interface PtySpawnOptions {
  cwd: string;
  stdio: ["pipe", "pipe", "pipe", "pipe"];
}

export type PtySpawn = (
  command: string,
  args: readonly string[],
  options: PtySpawnOptions,
) => PtyChild;

export interface IntegratedTerminal {
  open(cols: number, rows: number): void;
  input(data: string): void;
  resize(cols: number, rows: number): void;
  restart(): void;
  dispose(): void;
}

export interface IntegratedTerminalOptions {
  cwd: string;
  shell?: string | (() => string);
  platform?: NodeJS.Platform;
  flatpak?: boolean;
  shellExists?: (shell: string) => boolean;
  spawn?: PtySpawn;
  onData: (data: Uint8Array) => void;
  onExit: (code: number | null) => void;
  onError: (message: string) => void;
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: PtySpawnOptions,
): PtyChild {
  return nodeSpawn(command, [...args], {
    cwd: options.cwd,
    stdio: options.stdio,
    windowsHide: true,
  }) as unknown as PtyChild;
}

function configuredShell(
  shell: string | (() => string) | undefined,
  platform: NodeJS.Platform,
): string {
  const value = typeof shell === "function" ? shell() : shell;
  const trimmed = value?.trim();
  return trimmed ? trimmed : defaultTerminalShell(platform);
}

function shellExistsOnDisk(shell: string): boolean {
  try {
    fs.accessSync(shell, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function launchSpec(
  flatpak: boolean,
  shellOnHost: boolean,
  shell: string,
  cwd: string,
  cols: number,
  rows: number,
): { command: string; args: string[] } {
  const helperArgs = ["-u", "-c", PTY_HELPER, shell, cwd, String(cols), String(rows)];
  if (!flatpak || !shellOnHost) return { command: "python3", args: helperArgs };
  return {
    command: "flatpak-spawn",
    args: [
      "--host",
      "--watch-bus",
      `--directory=${cwd}`,
      "--env=TERM=xterm-256color",
      "--forward-fd=3",
      "python3",
      ...helperArgs,
    ],
  };
}

function explainLaunchError(message: string, shellOnHost: boolean): string {
  if (!shellOnHost) return message;
  if (/flatpak|portal call failed/i.test(message)) {
    return `${message}\n${TERMINAL_FLATPAK_HOST_DENIED}`;
  }
  return message;
}

function clampDimension(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 2) return fallback;
  return Math.min(500, Math.floor(value));
}

function toBytes(chunk: Buffer | Uint8Array | string): Uint8Array {
  if (typeof chunk === "string") return new TextEncoder().encode(chunk);
  return Uint8Array.from(chunk);
}

export function createIntegratedTerminal(options: IntegratedTerminalOptions): IntegratedTerminal {
  const spawn = options.spawn ?? defaultSpawn;
  const platform = options.platform ?? process.platform;
  const flatpak = options.flatpak ?? fs.existsSync("/.flatpak-info");
  const shellExists = options.shellExists ?? shellExistsOnDisk;
  let generation = 0;
  let current: PtyChild | undefined;
  let alive = false;
  let disposed = false;
  let lastSize = { cols: 80, rows: 24 };

  function invalidate(): void {
    generation += 1;
    const previous = current;
    current = undefined;
    alive = false;
    try {
      previous?.kill("SIGTERM");
    } catch {
      // The child already exited.
    }
  }

  function start(cols: number, rows: number): void {
    lastSize = { cols, rows };
    if (platform === "win32") {
      options.onError(TERMINAL_WINDOWS_UNSUPPORTED);
      return;
    }
    const shell = configuredShell(options.shell, platform);
    const shellOnHost = flatpak && !shellExists(shell);
    const launch = launchSpec(flatpak, shellOnHost, shell, options.cwd, cols, rows);
    const token = ++generation;
    let child: PtyChild;
    try {
      child = spawn(launch.command, launch.args, {
        cwd: options.cwd,
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      });
    } catch (error) {
      options.onError(error instanceof Error ? error.message : String(error));
      return;
    }
    current = child;
    alive = true;
    let failed = false;
    let stderr = "";
    child.stdout?.on?.("data", (chunk) => {
      if (token !== generation) return;
      options.onData(toBytes(chunk));
    });
    child.stderr?.on?.("data", (chunk) => {
      if (token !== generation) return;
      stderr += new TextDecoder().decode(toBytes(chunk));
    });
    child.on("error", (error) => {
      if (token !== generation) return;
      failed = true;
      alive = false;
      const missing = launch.command === "python3" ? TERMINAL_PYTHON_MISSING : error.message;
      const message = error.code === "ENOENT" ? missing : error.message;
      options.onError(explainLaunchError(message, shellOnHost));
    });
    child.on("exit", (code) => {
      if (token !== generation) return;
      alive = false;
      current = undefined;
      if (disposed || failed) return;
      const note = stderr.trim();
      if (note) options.onError(explainLaunchError(note.slice(0, 2000), shellOnHost));
      options.onExit(code);
    });
  }

  return {
    open(cols, rows) {
      if (disposed) return;
      const size = {
        cols: clampDimension(cols, 80),
        rows: clampDimension(rows, 24),
      };
      if (alive && current) {
        this.resize(size.cols, size.rows);
        return;
      }
      start(size.cols, size.rows);
    },
    input(data) {
      if (disposed || !alive || !current?.stdin || typeof data !== "string" || data.length === 0) {
        return;
      }
      try {
        current.stdin.write(data);
      } catch {
        // The pipe closed between keystrokes.
      }
    },
    resize(cols, rows) {
      if (disposed) return;
      const size = {
        cols: clampDimension(cols, lastSize.cols),
        rows: clampDimension(rows, lastSize.rows),
      };
      lastSize = size;
      if (!alive || !current) return;
      try {
        current.stdio[3]?.write?.(`resize ${size.cols} ${size.rows}\n`);
      } catch {
        // The control pipe closed with the child.
      }
    },
    restart() {
      if (disposed) return;
      const size = lastSize;
      invalidate();
      start(size.cols, size.rows);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidate();
    },
  };
}
