import { describe, expect, it } from "vitest";
import { appendExternalSkillDirs } from "../src/host/hermes-external-skills";

const VAULT = "/vault/.agents/skills";

describe("appendExternalSkillDirs", () => {
  it("appends a block list item and leaves the surrounding YAML in place", () => {
    const yaml = [
      "# header",
      "model:",
      "  provider: anthropic",
      "",
      "skills:",
      "  # keep this comment",
      '  create_dir: ""',
      "  external_dirs:",
      "    - ~/.agents/skills",
      "  project_discovery: true",
      "",
      "terminal:",
      "  backend: local",
      "",
    ].join("\n");

    const edited = appendExternalSkillDirs(yaml, [VAULT]);

    expect(edited.ok).toBe(true);
    expect(edited.changed).toBe(true);
    expect(edited.yaml).toBe(
      [
        "# header",
        "model:",
        "  provider: anthropic",
        "",
        "skills:",
        "  # keep this comment",
        '  create_dir: ""',
        "  external_dirs:",
        "    - ~/.agents/skills",
        `    - ${VAULT}`,
        "  project_discovery: true",
        "",
        "terminal:",
        "  backend: local",
        "",
      ].join("\n"),
    );
  });

  it("turns an empty external_dirs list into a flow list without moving later keys", () => {
    const yaml = ["other: 1", "skills:", "  external_dirs: []", '  create_dir: ""', ""].join("\n");
    const edited = appendExternalSkillDirs(yaml, [VAULT]);
    expect(edited.ok).toBe(true);
    expect(edited.yaml).toBe(
      ["other: 1", "skills:", `  external_dirs: ["${VAULT}"]`, '  create_dir: ""', ""].join("\n"),
    );
  });

  it("appends to a flow list", () => {
    const yaml = ["skills:", '  external_dirs: ["~/.agents/skills"]', "theme: dark", ""].join("\n");
    const edited = appendExternalSkillDirs(yaml, [VAULT]);
    expect(edited.ok).toBe(true);
    expect(edited.yaml).toBe(
      ["skills:", `  external_dirs: ["~/.agents/skills", "${VAULT}"]`, "theme: dark", ""].join(
        "\n",
      ),
    );
  });

  it("adds a skills block when the key is missing", () => {
    const edited = appendExternalSkillDirs("model: anthropic\n", [VAULT]);
    expect(edited.ok).toBe(true);
    expect(edited.yaml).toBe(
      ["model: anthropic", "skills:", "  external_dirs:", `    - ${VAULT}`, ""].join("\n"),
    );
  });

  it("is idempotent when the path is already present", () => {
    const yaml = ["skills:", "  external_dirs:", `    - ${VAULT}`, '  create_dir: ""', ""].join(
      "\n",
    );
    const edited = appendExternalSkillDirs(yaml, [VAULT]);
    expect(edited).toEqual({ yaml, changed: false, ok: true });

    const again = appendExternalSkillDirs(edited.yaml, [VAULT]);
    expect(again.changed).toBe(false);
    expect(again.yaml).toBe(yaml);
  });

  it("treats a home-relative entry as the same path", () => {
    const yaml = "skills:\n  external_dirs:\n    - ~/vault/.agents/skills\n";
    const edited = appendExternalSkillDirs(yaml, ["/home/user/vault/.agents/skills"], {
      home: "/home/user",
    });
    expect(edited.ok).toBe(true);
    expect(edited.changed).toBe(false);
    expect(edited.yaml).toBe(yaml);
  });

  it("leaves an inline skills mapping untouched", () => {
    const yaml = "# keep\nskills: { external_dirs: [] }\nmodel: x\n";
    const edited = appendExternalSkillDirs(yaml, [VAULT]);
    expect(edited.ok).toBe(false);
    expect(edited.changed).toBe(false);
    expect(edited.yaml).toBe(yaml);
  });

  it("leaves a block scalar untouched", () => {
    const yaml = "skills:\n  external_dirs: |\n    - nope\n";
    const edited = appendExternalSkillDirs(yaml, [VAULT]);
    expect(edited.ok).toBe(false);
    expect(edited.yaml).toBe(yaml);
  });
});
