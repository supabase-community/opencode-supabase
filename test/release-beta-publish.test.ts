import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runBetaPublish } from "../scripts/release-beta";

function releaseFixture(source: string): string {
  const cwd = mkdtempSync(join(tmpdir(), "release-beta-publish-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ private: true, scripts: { release: "bun release.ts" } }),
  );
  writeFileSync(join(cwd, "release.ts"), source);
  return cwd;
}

test.skipIf(process.platform !== "linux")("beta publish preserves the terminal for npm authorization", () => {
  const script = Bun.which("script");
  if (!script) throw new Error("PTY regression test requires util-linux script");
  const cwd = releaseFixture(`
    console.log(JSON.stringify({
      stdin: !!process.stdin.isTTY,
      stdout: !!process.stdout.isTTY,
      stderr: !!process.stderr.isTTY,
    }));
    console.log(JSON.stringify(process.argv.slice(2)));
    console.log("browser=" + process.env.npm_config_browser);
    process.exit(process.stdin.isTTY && process.stdout.isTTY ? 0 : 42);
  `);
  try {
    const moduleUrl = new URL("../scripts/release-beta.ts", import.meta.url).href;
    const driver = `import { runBetaPublish } from ${JSON.stringify(moduleUrl)}; await runBetaPublish(${JSON.stringify(cwd)});`;
    const command = [process.execPath, "--eval", driver]
      .map((arg) => `'${arg.replaceAll("'", "'\\''")}'`)
      .join(" ");
    const result = Bun.spawnSync([script, "-qec", command, "/dev/null"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, npm_config_browser: "fixture-browser" },
    });
    const output = result.stdout.toString() + result.stderr.toString();
    expect(output).toContain('{"stdin":true,"stdout":true,"stderr":true}');
    expect(output).toContain('["--no-git-tag"]');
    expect(output).toContain("browser=fixture-browser");
    expect(result.exitCode).toBe(0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("beta publish rejects a nonzero child exit for the registry-state probe", async () => {
  const cwd = releaseFixture("process.exit(23);");
  try {
    await expect(runBetaPublish(cwd)).rejects.toThrow("publish command exited with code 23");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
