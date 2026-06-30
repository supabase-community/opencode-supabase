/**
 * Local-dev beta prerelease publisher.
 *
 * Runs the full Changesets prerelease flow in a throwaway git worktree so the
 * main working copy is never mutated. Publishes under the npm `beta` dist-tag
 * and verifies `latest` is unchanged afterwards.
 *
 * Usage: bun run release:beta
 *
 * Guards:
 *   - refuses to run in CI
 *   - refuses to run without an interactive TTY
 *   - refuses to run if the working copy is dirty
 *   - refuses to run if npm `latest` is not a stable (non-prerelease) version
 *   - aborts if the generated version is not a `-beta.*` prerelease
 *   - requires typed confirmation before publishing
 *   - never commits, pushes, or creates git tags (--no-git-tag)
 */

import { $ } from "bun";

const CONFIRM_PHRASE = "publish beta";
const PACKAGE_NAME = "opencode-supabase";

class ReleaseBetaError extends Error {}

function abort(message: string): never {
  throw new ReleaseBetaError(message);
}

async function npmDistTags(): Promise<Record<string, string>> {
  const out = await $`npm view ${PACKAGE_NAME} dist-tags --json --silent`.text();
  return JSON.parse(out) as Record<string, string>;
}

async function gitIsClean(cwd: string): Promise<boolean> {
  const status = await $`git status --porcelain`.cwd(cwd).text();
  return status.trim() === "";
}

async function runVerify(cwd: string): Promise<void> {
  console.log("\n— lint");
  await $`bun run lint`.cwd(cwd).quiet();
  console.log("— typecheck");
  await $`bun run typecheck`.cwd(cwd).quiet();
  console.log("— test");
  await $`bun run test`.cwd(cwd).quiet();
  console.log("— verify:pack");
  await $`bun run verify:pack`.cwd(cwd).quiet();
}

async function main() {
  if (process.env.CI) abort("refusing to run in CI; beta publishes are local-dev only");
  if (!process.stdin.isTTY) abort("refusing to run without an interactive TTY");

  const repoRoot = (await $`git rev-parse --show-toplevel`.text()).trim();

  if (!(await gitIsClean(repoRoot))) {
    abort("working copy is dirty; commit or stash before running release:beta");
  }

  // Snapshot npm state before doing anything.
  const beforeTags = await npmDistTags();
  const latestBefore = beforeTags.latest;
  if (!latestBefore || /-/.test(latestBefore)) {
    abort(`npm latest is "${latestBefore}", expected a stable version; aborting`);
  }
  console.log(`npm latest before: ${latestBefore}`);

  if (beforeTags.beta) {
    console.log(`npm beta before:   ${beforeTags.beta}`);
  }

  // Throwaway worktree off HEAD so the main working copy stays untouched.
  const tmp = (await $`mktemp -d`.text()).trim();
  console.log(`\ntemp worktree: ${tmp}`);

  let publishAttempted = false;
  try {
    await $`git worktree add --detach ${tmp} HEAD`.quiet();
    await $`bun install --frozen-lockfile`.cwd(tmp).quiet();

    console.log("\n— changeset pre enter beta");
    await $`bun run changeset pre enter beta`.cwd(tmp).quiet();

    console.log("— version-packages");
    await $`bun run version-packages`.cwd(tmp).quiet();

    const pkg = JSON.parse(await Bun.file(`${tmp}/package.json`).text()) as { version: string };
    const newVersion = pkg.version;
    console.log(`generated version: ${newVersion}`);

    if (!/-beta\.\d+$/.test(newVersion)) {
      abort(`generated version "${newVersion}" is not a -beta.* prerelease; aborting`);
    }

    await runVerify(tmp);

    console.log(`\nAbout to publish ${PACKAGE_NAME}@${newVersion} under the npm "beta" dist-tag.`);
    console.log(`Type exactly: ${CONFIRM_PHRASE}`);
    const answer = (prompt("> ") ?? "").trim();
    if (answer !== CONFIRM_PHRASE) {
      abort("confirmation mismatch; aborting before publish");
    }

    console.log("\n— publish (no git tag)");
    publishAttempted = true;
    try {
      await $`bun run release -- --no-git-tag`.cwd(tmp);
    } catch (publishErr) {
      // npm publish is irreversible; the CLI may error after the registry
      // accepted the package. Probe dist-tags before deciding next steps.
      console.error("\nrelease:beta: publish command failed; probing npm state.");
      let probed: Record<string, string>;
      try {
        probed = await npmDistTags();
      } catch (probeErr) {
        abort(
          `publish command failed and npm dist-tag probe failed; state unknown. Inspect npm manually before retrying. Underlying error: ${
            publishErr instanceof Error ? publishErr.message : String(publishErr)
          }; probe error: ${probeErr instanceof Error ? probeErr.message : String(probeErr)}`,
        );
      }
      const betaOk = probed.beta === newVersion;
      const latestOk = probed.latest === latestBefore;
      const publishErrMsg = publishErr instanceof Error ? publishErr.message : String(publishErr);
      if (betaOk && latestOk) {
        abort(
          `publish command failed but npm beta is already ${newVersion} and latest is unchanged; do NOT retry. Inspect npm and smoke test opencode-supabase@${newVersion}. Underlying error: ${publishErrMsg}`,
        );
      }
      if (betaOk && !latestOk) {
        abort(
          `publish command failed; npm beta is ${newVersion} but latest drifted to ${probed.latest}. Restore with: npm dist-tag add ${PACKAGE_NAME}@${latestBefore} latest; then smoke test opencode-supabase@${newVersion}. Underlying error: ${publishErrMsg}`,
        );
      }
      if (!betaOk && latestOk) {
        abort(
          `publish command failed; npm beta is "${probed.beta}", expected "${newVersion}". Inspect npm before retrying. Underlying error: ${publishErrMsg}`,
        );
      }
      abort(
        `publish command failed; npm beta is "${probed.beta}" (expected "${newVersion}") and latest is "${probed.latest}" (expected "${latestBefore}"). Inspect npm before retrying. Underlying error: ${publishErrMsg}`,
      );
    }

    const afterTags = await npmDistTags();
    console.log(`\nnpm latest after:  ${afterTags.latest}`);
    console.log(`npm beta after:    ${afterTags.beta}`);

    if (afterTags.latest !== latestBefore) {
      abort(
        `npm latest changed from ${latestBefore} to ${afterTags.latest}; ` +
          `restore with: npm dist-tag add ${PACKAGE_NAME}@${latestBefore} latest`,
      );
    }
    if (afterTags.beta !== newVersion) {
      abort(
        `npm beta is "${afterTags.beta}", expected "${newVersion}"; ` +
          `fix with: npm dist-tag add ${PACKAGE_NAME}@${newVersion} beta`,
      );
    }
    console.log("latest unchanged, beta points at new version. OK.");
  } finally {
    if (publishAttempted) {
      // publish already ran; surface guidance if cleanup itself fails
      try {
        await $`git worktree remove ${tmp} --force`.quiet();
      } catch {
        console.error(
          `release:beta: cleanup failed; worktree may remain at ${tmp}. Run: git worktree prune`,
        );
      }
    } else {
      try {
        await $`git worktree remove ${tmp} --force`.quiet();
      } catch {
        // worktree may already be gone or removal failed; prune below
      }
    }
    await $`git worktree prune`.quiet().catch(() => {
      console.error("release:beta: git worktree prune failed; stale worktree entries may remain.");
    });
    console.log("\ncleaned up temp worktree.");
  }
}

try {
  await main();
} catch (err) {
  if (err instanceof ReleaseBetaError) {
    console.error(`release:beta: ${err.message}`);
  } else {
    console.error("\nrelease:beta: unexpected failure:");
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exitCode = 1;
}
