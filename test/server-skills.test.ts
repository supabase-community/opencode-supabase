import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import serverModule from "../src/server/index.ts";
import {
  defaultSkillsRoot,
  registerSupabaseSkillPaths,
  resolveEnabledSupabaseSkills,
} from "../src/server/skills.ts";

describe("resolveEnabledSupabaseSkills", () => {
  test("enables all bundled skills by default", () => {
    expect(resolveEnabledSupabaseSkills(undefined)).toEqual([
      "supabase",
      "supabase-postgres-best-practices",
      "opencode-supabase-guide",
    ]);
  });

  test("disables all skills when skills is false", () => {
    expect(resolveEnabledSupabaseSkills({ skills: false })).toEqual([]);
  });

  test("keeps omitted skill keys enabled", () => {
    expect(resolveEnabledSupabaseSkills({ skills: { "supabase-postgres-best-practices": false } })).toEqual([
      "supabase",
      "opencode-supabase-guide",
    ]);
  });

  test("warns and ignores unknown skill keys", () => {
    const warnings: unknown[] = [];
    expect(resolveEnabledSupabaseSkills({ skills: { typo: false } }, { warn: (_message, data) => warnings.push(data) })).toEqual([
      "supabase",
      "supabase-postgres-best-practices",
      "opencode-supabase-guide",
    ]);
    expect(warnings).toHaveLength(1);
  });

  test("warns on non-boolean known skill values", () => {
    const warnings: unknown[] = [];
    expect(resolveEnabledSupabaseSkills({ skills: { supabase: "yes" } }, { warn: (_message, data) => warnings.push(data) })).toEqual([
      "supabase",
      "supabase-postgres-best-practices",
      "opencode-supabase-guide",
    ]);
    expect(warnings).toHaveLength(1);
  });
});

describe("registerSupabaseSkillPaths", () => {
  test("adds selected skill directories", () => {
    const config: { skills?: { paths?: string[] } } = {};
    registerSupabaseSkillPaths(config, undefined, {
      skillsRoot: "/plugin/skills",
      exists: () => true,
    });
    expect(config.skills?.paths).toEqual([
      "/plugin/skills/supabase",
      "/plugin/skills/supabase-postgres-best-practices",
      "/plugin/skills/opencode-supabase-guide",
    ]);
  });

  test("does not add duplicate paths", () => {
    const config = { skills: { paths: ["/plugin/skills/supabase"] } };
    registerSupabaseSkillPaths(config, undefined, {
      skillsRoot: "/plugin/skills",
      exists: () => true,
    });
    expect(config.skills.paths).toEqual([
      "/plugin/skills/supabase",
      "/plugin/skills/supabase-postgres-best-practices",
      "/plugin/skills/opencode-supabase-guide",
    ]);
  });

  test("preserves existing paths and urls", () => {
    const config = {
      skills: {
        paths: ["/user/skills"],
        urls: ["https://example.com/.well-known/skills/"],
      },
    };

    registerSupabaseSkillPaths(config, undefined, {
      skillsRoot: "/plugin/skills",
      exists: () => true,
    });

    expect(config.skills).toEqual({
      paths: [
        "/user/skills",
        "/plugin/skills/supabase",
        "/plugin/skills/supabase-postgres-best-practices",
        "/plugin/skills/opencode-supabase-guide",
      ],
      urls: ["https://example.com/.well-known/skills/"],
    });
  });

  test("warns and skips missing directories", () => {
    const warnings: unknown[] = [];
    const config: { skills?: { paths?: string[] } } = {};
    registerSupabaseSkillPaths(config, undefined, {
      skillsRoot: "/plugin/skills",
      exists: (path) => !path.endsWith("postgres-best-practices"),
      warn: (_message, data) => warnings.push(data),
    });
    expect(config.skills?.paths).toEqual([
      "/plugin/skills/supabase",
      "/plugin/skills/opencode-supabase-guide",
    ]);
    expect(warnings).toHaveLength(1);
  });

  test("skips non-object skills config without mutation", () => {
    const warnings: unknown[] = [];
    const config: { skills?: unknown } = { skills: false };

    registerSupabaseSkillPaths(config, undefined, {
      skillsRoot: "/plugin/skills",
      exists: () => true,
      warn: (_message, data) => warnings.push(data),
    });

    expect(config.skills).toBe(false);
    expect(warnings).toHaveLength(1);
  });

  test("skips malformed paths without mutation", () => {
    const warnings: unknown[] = [];
    const config = { skills: { paths: "nope" as unknown } };

    registerSupabaseSkillPaths(config, undefined, {
      skillsRoot: "/plugin/skills",
      exists: () => true,
      warn: (_message, data) => warnings.push(data),
    });

    expect(config.skills.paths).toBe("nope");
    expect(warnings).toHaveLength(1);
  });
});

describe("server config hook", () => {
  test("registers bundled skill paths", async () => {
    const hooks = await serverModule.server(
      {
        client: {
          app: {
            log: () => Promise.resolve(true),
          },
        },
        directory: "/workspace",
        worktree: "/workspace",
        serverUrl: new URL("http://localhost:4096"),
        project: {},
        $: {},
      } as never,
      undefined,
    );

    const config = {
      skills: {
        paths: ["/user/skills"],
        urls: ["https://example.com/.well-known/skills/"],
      },
    };

    await hooks.config?.(config as never);

    const skillsRoot = defaultSkillsRoot();
    expect(config.skills).toEqual({
      paths: [
        "/user/skills",
        path.join(skillsRoot, "supabase"),
        path.join(skillsRoot, "supabase-postgres-best-practices"),
        path.join(skillsRoot, "opencode-supabase-guide"),
      ],
      urls: ["https://example.com/.well-known/skills/"],
    });
  });
});

describe("opencode-supabase-guide skill", () => {
  test("documents strict MCP onboarding phrases", () => {
    const skillContent = readFileSync(path.join(defaultSkillsRoot(), "opencode-supabase-guide", "SKILL.md"), "utf-8");

    expect(skillContent).toContain("Say this:");
    expect(skillContent).toContain("Do not say:");
    expect(skillContent).toContain("Ask me to list your Supabase projects first.");
    expect(skillContent).toContain("Connect this project to Supabase MCP?");
    expect(skillContent).toContain("Restart OpenCode, then run `opencode mcp auth supabase`.");
    expect(skillContent).toContain("MCP auth may already be cached from an earlier setup.");
    expect(skillContent).toContain("OAuth will prompt automatically");
    expect(skillContent).toContain("Already wired");
  });
});
