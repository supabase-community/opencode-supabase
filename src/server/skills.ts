import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BUNDLED_SUPABASE_SKILLS = [
  "supabase",
  "supabase-postgres-best-practices",
  "opencode-supabase-guide",
] as const;

export type BundledSupabaseSkill = (typeof BUNDLED_SUPABASE_SKILLS)[number];

type Warn = (message: string, data?: Record<string, unknown>) => unknown;

type ResolverDeps = {
  warn?: Warn;
};

type RegisterDeps = ResolverDeps & {
  skillsRoot?: string;
  exists?: (path: string) => boolean;
};

type ConfigWithSkills = object & {
  skills?: {
    paths?: unknown;
  };
};

type SkillsConfig = {
  paths?: unknown;
} & Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pluginSkillsOption(options: unknown) {
  if (!isRecord(options) || !("skills" in options)) return true;
  return (options as { skills?: unknown }).skills;
}

export function resolveEnabledSupabaseSkills(options: unknown, deps: ResolverDeps = {}) {
  const value = pluginSkillsOption(options);
  if (value === false) return [];
  if (value === true || value === undefined) return [...BUNDLED_SUPABASE_SKILLS];

  if (!isRecord(value)) {
    deps.warn?.("invalid Supabase skills option; loading bundled skills", { value });
    return [...BUNDLED_SUPABASE_SKILLS];
  }

  const known = new Set<string>(BUNDLED_SUPABASE_SKILLS);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) {
      deps.warn?.("unknown Supabase bundled skill option ignored", { skill: key });
      continue;
    }
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      deps.warn?.("invalid Supabase bundled skill option value", {
        skill: key,
        value: value[key] as unknown,
      });
    }
  }

  return BUNDLED_SUPABASE_SKILLS.filter((skill) => value[skill] !== false);
}

export function defaultSkillsRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../skills");
}

export function registerSupabaseSkillPaths(
  config: object,
  options: unknown,
  deps: RegisterDeps = {},
) {
  const configWithSkills = config as ConfigWithSkills;
  const skillsRoot = deps.skillsRoot ?? defaultSkillsRoot();
  const exists = deps.exists ?? fs.existsSync;
  const enabled = resolveEnabledSupabaseSkills(options, deps);
  let skillsConfig: SkillsConfig;

  if (configWithSkills.skills === undefined) {
    skillsConfig = {};
    configWithSkills.skills = skillsConfig;
  } else if (isRecord(configWithSkills.skills)) {
    skillsConfig = configWithSkills.skills as SkillsConfig;
  } else {
    deps.warn?.("invalid Supabase skills config; leaving unchanged", {
      value: configWithSkills.skills as unknown,
    });
    return;
  }

  if (!Array.isArray(skillsConfig.paths)) {
    if (skillsConfig.paths !== undefined) {
      deps.warn?.("invalid Supabase skills.paths value; leaving unchanged", {
        value: skillsConfig.paths as unknown,
      });
      return;
    }
    skillsConfig.paths = [];
  }

  const paths = skillsConfig.paths as string[];

  for (const skill of enabled) {
    const skillPath = path.join(skillsRoot, skill);
    if (!exists(skillPath)) {
      deps.warn?.("bundled Supabase skill directory not found", { skill, path: skillPath });
      continue;
    }

    if (!paths.includes(skillPath)) {
      paths.push(skillPath);
    }
  }
}
