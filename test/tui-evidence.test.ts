import { expect, test } from "bun:test";

// OpenCode caches installed plugins under
// <XDG_CACHE_HOME>/opencode/packages/<raw spec>, and the spec is
// `file:<tarball>` — the cache tree contains a `file:` directory. Both CI
// workflows upload the whole evidence directory, and upload-artifact@v4
// rejects ':' in any uploaded path, which failed every canary upload and the
// 2026-07-23 main CI diagnostics upload. The harness must prune those trees
// (and npm's cacache junk) before evidence upload, without weakening the
// upload steps themselves.
const harness = await Bun.file(
  new URL("../scripts/test-opencode-tui-package.sh", import.meta.url),
).text();

const workflows = await Promise.all(
  [
    "../.github/workflows/ci.yml",
    "../.github/workflows/opencode-compatibility-canary.yml",
  ].map(async (path) => ({
    path,
    content: await Bun.file(new URL(path, import.meta.url)).text(),
  })),
);

test("harness prunes upload-hostile host caches before evidence upload", () => {
  expect(harness).toContain(
    'rm -rf "$ARTIFACT_DIR/cache/opencode/packages" "$ARTIFACT_DIR/npm/cache" "$ARTIFACT_DIR/config/opencode/node_modules" "$ARTIFACT_DIR/work/.opencode/node_modules" "$ARTIFACT_DIR/tmp"',
  );
});

test("evidence uploads stay strict in every workflow", () => {
  for (const { path, content } of workflows) {
    expect(content, path).toContain("uses: actions/upload-artifact@v4");
    expect(content, path).toContain("if-no-files-found: error");
    expect(content, path).not.toContain("continue-on-error");
  }
});
