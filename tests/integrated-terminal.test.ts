import { describe, expect, it } from "vitest";
import {
  createIntegratedTerminal,
  defaultTerminalShell,
  type PtyChild,
  type PtySpawn,
  TERMINAL_PYTHON_MISSING,
  TERMINAL_WINDOWS_UNSUPPORTED,
} from "../src/host/integrated-terminal";

class FakePty implements PtyChild {
  readonly stdinWrites: string[] = [];
  readonly controlWrites: string[] = [];
  killed: NodeJS.Signals | undefined;
  readonly stdin = {
    write: (data: string | Uint8Array) => {
      this.stdinWrites.push(typeof data === "string" ? data : new TextDecoder().decode(data));
    },
  };
  readonly stdout = {
    on: (event: "data", listener: (chunk: Buffer) => void) => {
      this.add(event, listener);
    },
  };
  readonly stderr = {
    on: (event: "data", listener: (chunk: Buffer) => void) => {
      this.add(`stderr:${event}`, listener);
    },
  };
  readonly stdio: PtyChild["stdio"];
  private readonly listeners = new Map<string, Array<(...args: never[]) => void>>();

  constructor(
    readonly command: string,
    readonly args: readonly string[],
    readonly options: { cwd: string },
  ) {
    this.stdio = [
      this.stdin,
      this.stdout,
      this.stderr,
      {
        write: (data: string) => {
          this.controlWrites.push(data);
        },
      },
    ];
  }

  on(event: "exit" | "error", listener: (...args: never[]) => void): void {
    this.add(event, listener);
  }

  kill(signal?: NodeJS.Signals): void {
    this.killed = signal ?? "SIGTERM";
  }

  pushStdout(chunk: Buffer): void {
    for (const listener of this.listeners.get("data") ?? []) listener(chunk as never);
  }

  emitExit(code: number | null): void {
    for (const listener of this.listeners.get("exit") ?? []) listener(code as never);
  }

  emitError(error: NodeJS.ErrnoException): void {
    for (const listener of this.listeners.get("error") ?? []) listener(error as never);
  }

  private add(event: string, listener: (...args: never[]) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }
}

function harness(overrides: { platform?: NodeJS.Platform } = {}) {
  const children: FakePty[] = [];
  const spawn: PtySpawn = (command, args, options) => {
    const child = new FakePty(command, args, options);
    children.push(child);
    return child;
  };
  const data: Uint8Array[] = [];
  const exits: Array<number | null> = [];
  const errors: string[] = [];
  const session = createIntegratedTerminal({
    cwd: "/vault",
    shell: "/bin/zsh",
    platform: overrides.platform ?? "linux",
    spawn,
    onData: (chunk) => data.push(chunk),
    onExit: (code) => exits.push(code),
    onError: (message) => errors.push(message),
  });
  return { session, children, data, exits, errors };
}

describe("integrated terminal session", () => {
  it("spawns the user shell and bridges stdin, stdout, and resize", () => {
    const { session, children, data } = harness();

    session.open(100, 40);

    expect(children).toHaveLength(1);
    const child = children[0];
    expect(child?.command).toBe("python3");
    expect(child?.args.slice(0, 2)).toEqual(["-u", "-c"]);
    expect(child?.args.slice(-4)).toEqual(["/bin/zsh", "/vault", "100", "40"]);
    expect(child?.options.cwd).toBe("/vault");

    child?.pushStdout(Buffer.from("ready\r\n"));
    expect(new TextDecoder().decode(data[0])).toBe("ready\r\n");

    session.input("ls\n");
    expect(child?.stdinWrites).toEqual(["ls\n"]);

    session.resize(120, 30);
    expect(child?.controlWrites).toEqual(["resize 120 30\n"]);
  });

  it("only resizes when open is called on a live session", () => {
    const { session, children } = harness();
    session.open(80, 24);
    session.open(90, 20);
    expect(children).toHaveLength(1);
    expect(children[0]?.controlWrites).toEqual(["resize 90 20\n"]);
  });

  it("dispose ends the child and ignores a later exit", () => {
    const { session, children, exits } = harness();
    session.open(80, 24);
    session.dispose();
    expect(children[0]?.killed).toBe("SIGTERM");
    children[0]?.emitExit(0);
    session.input("ls\n");
    expect(exits).toEqual([]);
    expect(children[0]?.stdinWrites).toEqual([]);
  });

  it("reports a missing python3 without pretending a pipe is a terminal", () => {
    const { session, children, exits, errors } = harness();
    session.open(80, 24);
    children[0]?.emitError(Object.assign(new Error("spawn python3 ENOENT"), { code: "ENOENT" }));
    children[0]?.emitExit(null);
    expect(errors).toEqual([TERMINAL_PYTHON_MISSING]);
    expect(exits).toEqual([]);
  });

  it("does not spawn on Windows", () => {
    const { session, children, errors } = harness({ platform: "win32" });
    session.open(80, 24);
    expect(children).toHaveLength(0);
    expect(errors).toEqual([TERMINAL_WINDOWS_UNSUPPORTED]);
  });

  it("uses the shell path from settings, and /bin/sh when that path is empty", () => {
    expect(defaultTerminalShell("linux")).toBe("/bin/sh");
    expect(defaultTerminalShell("darwin")).toBe("/bin/sh");
    expect(defaultTerminalShell("win32")).toBe(process.env.ComSpec || "cmd.exe");

    const children: FakePty[] = [];
    let configured = "";
    const session = createIntegratedTerminal({
      cwd: "/vault",
      shell: () => configured,
      spawn: (command, args, options) => {
        const child = new FakePty(command, args, options);
        children.push(child);
        return child;
      },
      onData: () => {},
      onExit: () => {},
      onError: () => {},
    });

    session.open(80, 24);
    expect(children[0]?.args.slice(-4)).toEqual(["/bin/sh", "/vault", "80", "24"]);

    configured = "/bin/zsh";
    session.restart();
    expect(children[1]?.args.slice(-4)).toEqual(["/bin/zsh", "/vault", "80", "24"]);
  });

  it("runs a shell that exists in the Flatpak sandbox directly", () => {
    const children: FakePty[] = [];
    const session = createIntegratedTerminal({
      cwd: "/vault",
      shell: "/bin/sh",
      flatpak: true,
      shellExists: () => true,
      spawn: (command, args, options) => {
        const child = new FakePty(command, args, options);
        children.push(child);
        return child;
      },
      onData: () => {},
      onExit: () => {},
      onError: () => {},
    });
    session.open(80, 24);
    expect(children[0]?.command).toBe("python3");
    expect(children[0]?.args.slice(-4)).toEqual(["/bin/sh", "/vault", "80", "24"]);
  });

  it("starts the configured shell on the host when Flatpak does not contain it", () => {
    const children: FakePty[] = [];
    const session = createIntegratedTerminal({
      cwd: "/vault",
      shell: "/usr/local/bin/my-shell",
      flatpak: true,
      shellExists: () => false,
      spawn: (command, args, options) => {
        const child = new FakePty(command, args, options);
        children.push(child);
        return child;
      },
      onData: () => {},
      onExit: () => {},
      onError: () => {},
    });

    session.open(80, 24);

    expect(children[0]?.command).toBe("flatpak-spawn");
    expect(children[0]?.args.slice(0, 5)).toEqual([
      "--host",
      "--watch-bus",
      "--directory=/vault",
      "--env=TERM=xterm-256color",
      "--forward-fd=3",
    ]);
    expect(children[0]?.args.slice(-4)).toEqual(["/usr/local/bin/my-shell", "/vault", "80", "24"]);
  });

  it("restarts by replacing the live child", () => {
    const { session, children } = harness();
    session.open(80, 24);
    session.restart();
    expect(children).toHaveLength(2);
    expect(children[0]?.killed).toBe("SIGTERM");
    expect(children[1]?.args.slice(-4)).toEqual(["/bin/zsh", "/vault", "80", "24"]);
  });
});
