import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { hostRuntimeSpecifiers, runtimeModuleIdForSpecifier } from "./host-runtime-rewrite.mjs";

const transform = fileURLToPath(new URL("transform-solid.mjs", import.meta.url));

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hostRuntimeFilter = new RegExp(`^(?:${hostRuntimeSpecifiers.map(escapeRegExp).join("|")})$`);

// TSX files are compiled by `transform-solid.mjs`, whose Babel plugin rewrites
// host-runtime import specifiers to `opentui:runtime-module:*` ids in an
// import-aware way (see scripts/host-runtime-rewrite.mjs).
const solid = {
  name: "solid",
  setup(build: Bun.PluginBuilder) {
    build.onLoad({ filter: /\.tsx$/ }, ({ path }) => {
      const result = Bun.spawnSync(["node", transform, path]);
      if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
      return { contents: new TextDecoder().decode(result.stdout), loader: "js" } as const;
    });
  },
};

const hostRuntimeModules = {
  name: "opencode-host-runtime-modules",
  setup(build: Bun.PluginBuilder) {
    build.onResolve({ filter: hostRuntimeFilter }, ({ path }) => {
      return {
        path: runtimeModuleIdForSpecifier(path),
        external: true,
      };
    });
  },
};

await rm("dist", { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["src/tui/index.tsx"],
  outdir: "dist",
  naming: "tui.js",
  target: "bun",
  format: "esm",
  packages: "external",
  plugins: [solid, hostRuntimeModules],
});

if (!result.success) {
  console.error(...result.logs);
  process.exit(1);
}

await Bun.write(
  "dist/tui.d.ts",
  'declare const plugin: { id: "supabase"; tui: unknown; setup: unknown };\nexport default plugin;\n',
);
